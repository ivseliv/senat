"""Пассажи с точными смещениями и проверяемой привязкой к страницам OCR."""
import bisect
import collections
import hashlib
import json
import re
from pathlib import Path

MIXED = re.compile(r'(?=\w*[а-яѣіѳѵъ])(?=\w*[a-zA-Z])\w+', re.I)
LAT2CYR = str.maketrans('aeopcxyABCEHKMOPTX', 'аеорсхуАВСЕНКМОРТХ')
NOTE = re.compile(r'(нет печатного текста|Страница пустая|на скане нет|оборотная сторона|штрихкод|библиотечные пометки)', re.I)


def _field_index(fields):
    """Тот же BM25-индекс для первоначальной сборки и обновления аннотаций."""
    post, lengths = {}, []
    for i, ss in enumerate(fields):
        lengths.append(len(ss))
        for token, count in collections.Counter(ss).items():
            post.setdefault(token, []).extend([i, count])
    return dict(n=len(fields), avgdl=sum(lengths)/max(1, len(fields)),
                len=lengths, post=post, hpost={})


def validated_annotation(pid, ann, text, digest):
    """Возвращает актуальную аннотацию либо None для старого SHA.

    Совпавший SHA сам по себе недостаточен: цитата проверяется по буквальному
    срезу опубликованного текста. Ошибку в актуальном ответе нельзя тихо скрыть.
    """
    if not isinstance(ann, dict):
        raise ValueError(f'{pid}: некорректная аннотация')
    if ann.get('sha256') != digest:
        return None
    quote, summary, concepts = (ann.get(k) for k in ('evidence', 'summary', 'concepts'))
    if not isinstance(quote, str) or not quote.strip() or quote not in text:
        raise ValueError(f'{pid}: цитата обогащения отсутствует в пассаже')
    if (not isinstance(summary, str) or not summary.strip() or
            not isinstance(concepts, list) or
            any(not isinstance(c, str) or not c.strip() for c in concepts)):
        raise ValueError(f'{pid}: некорректная аннотация')
    result = dict(summary=summary, concepts=concepts, evidence=quote)
    if 'source_warning' in ann:
        warning = ann['source_warning']
        if not isinstance(warning, str) or not warning.strip():
            raise ValueError(f'{pid}: некорректное предупреждение об источнике')
        result['source_warning'] = warning
    return result


def _published_corpus(root):
    """Читает только опубликованные данные, не восстанавливая страницы OCR."""
    data = Path(root)/'lex/data'
    meta = json.loads((data/'meta.json').read_text(encoding='utf-8'))['decisions']
    docs, texts = {}, {}
    for year in sorted({d['vol'] for d in meta}):
        volume_docs = [d for d in meta if d['vol'] == year]
        volume_texts = json.loads((data/f'text-{year}.json').read_text(encoding='utf-8'))
        if len(volume_docs) != len(volume_texts):
            raise ValueError(f'{year}: число опубликованных текстов не совпадает с метаданными')
        for doc, text in zip(volume_docs, volume_texts):
            if doc['id'] in docs or not isinstance(text, str):
                raise ValueError(f'{doc["id"]}: неоднозначный опубликованный текст')
            docs[doc['id']], texts[doc['id']] = doc, text
    volumes, corpus = [], {}
    for path in sorted(data.glob('passages-*.json')):
        obj = json.loads(path.read_text(encoding='utf-8'))
        year = int(path.stem.removeprefix('passages-'))
        for p in obj['passages']:
            pid = p['id']
            doc = docs.get(p['decision'])
            if doc is None or doc['vol'] != year or p['doc'] != doc['i']:
                raise ValueError(f'{pid}: пассаж не соответствует метаданным решения')
            start, end = p['start'], p['end']
            text = texts[p['decision']]
            if (type(start) is not int or type(end) is not int or
                    not 0 <= start < end <= len(text) or
                    pid != f'{p["decision"]}:{start}-{end}' or pid in corpus):
                raise ValueError(f'{pid}: неверные или повторные границы пассажа')
            source = text[start:end]
            if hashlib.sha256(source.encode('utf-8')).hexdigest() != p['sha256']:
                raise ValueError(f'{pid}: SHA-256 не совпадает с опубликованным текстом')
            corpus[pid] = dict(id=pid, sha256=p['sha256'], text=source,
                               headnote=doc.get('headnote', ''))
        volumes.append((year, path, obj))
    return volumes, corpus


def published_corpus(root):
    """Проверенные срезы для экспорта/импорта без доступа к исходным OCR-листам."""
    return list(_published_corpus(root)[1].values())


def refresh_published_enrichment(root, stems):
    """Обновляет ai и обогащённый индекс по существующим границам пассажей.

    Сначала проверяет *все* тома и актуальные ответы; до окончания проверки
    ничего не записывает. Не пересобирает original, страницы, источники, SHA
    или границы и не утверждает новую проверку OCR. Старые ответы остаются в
    enrichment как история, но не попадают в поиск. Повторный запуск идемпотентен.
    """
    root = Path(root)
    volumes, corpus = _published_corpus(root)
    concepts_path = root/'lex/data/concepts.json'
    concepts = json.loads(concepts_path.read_text(encoding='utf-8'))
    manifests = {v['year']: v for v in concepts['volumes']}
    if len(manifests) != len(concepts['volumes']) or set(manifests) != {y for y, _, _ in volumes}:
        raise ValueError('Список томов concepts.json не совпадает с опубликованными пассажами')
    records = {}
    for path in sorted((root/'lex/enrichment').glob('*.json')):
        imported = json.loads(path.read_text(encoding='utf-8')).get('passages', {})
        if not isinstance(imported, dict) or records.keys() & imported.keys():
            raise ValueError(f'{path}: неверные или повторные id аннотаций')
        records.update(imported)
    valid, stale, unknown = {}, 0, 0
    for pid, ann in records.items():
        if pid not in corpus:
            unknown += 1
            continue
        p = corpus[pid]
        checked = validated_annotation(pid, ann, p['text'], p['sha256'])
        if checked is None:
            stale += 1
        else:
            valid[pid] = checked
    output, coverage = {}, []
    for year, path, obj in volumes:
        manifest = manifests[year]
        if manifest['file'] != path.name or manifest['passages'] != len(obj['passages']):
            raise ValueError(f'{year}: покрытие concepts.json не совпадает с пассажами')
        fields = []
        for p in obj['passages']:
            p.pop('ai', None)
            if p['id'] in valid:
                p['ai'] = valid[p['id']]
            ai = p.get('ai', {})
            # Повреждённый порядок колонок нельзя превращать в юридический
            # поисковый тезис. Предупреждение доступно читателю через ai.
            fields.append([] if ai.get('source_warning') else
                          stems(' '.join([ai.get('summary', ''), *ai.get('concepts', [])])))
        obj['enriched'] = _field_index(fields)
        manifest['enriched'] = sum('ai' in p for p in obj['passages'])
        manifest['source_warnings'] = sum(bool(p.get('ai', {}).get('source_warning')) for p in obj['passages'])
        manifest['enrichment_searchable'] = manifest['enriched'] - manifest['source_warnings']
        coverage.append(dict(year=year, passages=len(obj['passages']), enriched=manifest['enriched']))
        output[path] = obj
    output[concepts_path] = concepts
    # Сериализация всех результатов также предшествует любой записи.
    pending = {}
    for path, obj in output.items():
        before = path.read_bytes()
        after = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        if before.endswith(b'\n'):
            after += b'\n'
        if before != after:
            pending[path] = after
    for path, content in pending.items():
        path.write_bytes(content)
    return dict(valid=len(valid), stale=stale, unknown=unknown,
                ignored=stale+unknown, volumes=coverage,
                changed_files=[path.name for path in pending])


def source_pages(directory, raw):
    """Повторяет assemble.py, сохраняя диапазоны каждого листа; сверяет весь том.

    Номера берём из колонтитула или согласующихся соседних колонтитулов,
    никогда не выводим из номера PDF.
    При расхождении сборок не угадываем смещения и останавливаем сборку.
    """
    directory = Path(directory)
    mapped = directory / 'page-map.json'
    if mapped.exists():
        data = json.loads(mapped.read_text(encoding='utf-8'))
        if data.get('version') != 1 or data.get('layout') != 'single-pages':
            raise ValueError(f'{directory}: неизвестный формат карты страниц')
        if data.get('volume_sha256') != hashlib.sha256(raw.encode()).hexdigest():
            raise ValueError(f'{directory}: карта относится к другой версии volume.txt')
        result, previous = [], 0
        for item in data.get('entries', []):
            required = {'file', 'start', 'end', 'printed_page', 'sha256'}
            if not required <= item.keys() or not isinstance(item['start'], int) or not isinstance(item['end'], int):
                raise ValueError(f'{directory}: неполная запись карты страниц')
            file = directory / item['file']
            if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError(f'{directory}: изменён или отсутствует OCR-лист {item["file"]}')
            if not 0 <= item['start'] < item['end'] <= len(raw) or item['start'] < previous:
                raise ValueError(f'{directory}: нарушен порядок диапазонов карты страниц')
            previous = item['end']
            result.append(dict(start=item['start'], end=item['end'], page=item['printed_page'],
                               file=item['file'], page_method=item.get('page_method', 'verified')))
        if not result:
            raise ValueError(f'{directory}: пустая карта страниц')
        return result
    out, carry = [], False
    files = sorted(Path(directory).glob('p*.txt'))
    headers = {}
    for file in files:
        h = re.search(r'^\[\[К:(.*?)\]\]', file.read_text(encoding='utf-8'), re.M)
        pg = (re.search(r'[—–-]\s*(\d+)\s*[—–-]', h[1]) or re.search(r'^\s*(\d+)\s*[—–-]', h[1])) if h else None
        headers[file.name] = (int(pg[1]) if pg else None, 'header' if pg else 'unknown')
    # Восстанавливаем пропущенный номер только если оба соседних колонтитула
    # подтверждают непрерывную последовательность. Метод сохранён в выдаче.
    for i,file in enumerate(files):
        if headers[file.name][0] is not None:
            continue
        before = next((j for j in range(i-1,-1,-1) if headers[files[j].name][1] == 'header'), None)
        after = next((j for j in range(i+1,len(files)) if headers[files[j].name][1] == 'header'), None)
        if before is not None and after is not None:
            lo,hi = headers[files[before].name][0],headers[files[after].name][0]
            if hi-lo == after-before:
                headers[file.name] = (lo+i-before,'neighbors')
    for file in files:
        t = file.read_text(encoding='utf-8')
        t = MIXED.sub(lambda m: m.group(0).translate(LAT2CYR), t)
        if t.strip().startswith('[[ПУСТО]]') or (len(t.strip()) < 500 and NOTE.search(t)):
            continue
        page, method = headers[file.name]
        t = re.sub(r'^\[\[К:.*?\]\]\s*\n?', '', t, flags=re.M)
        t, _, foot = t.partition('[[СНОСКИ]]')
        t = t.strip()
        if not t:
            continue
        def para(s):
            return [s, [(0, len(s), page, file.name, method)]]
        if out and carry:
            first, _, rest = t.partition('\n\n')
            first = first.strip()
            offset = len(out[-1][0]) + 1
            out[-1][0] += ' ' + first
            out[-1][1].append((offset, offset + len(first), page, file.name, method))
            t = rest.strip()
        out.extend(para(p.strip()) for p in t.split('\n\n') if p.strip())
        carry = bool(out) and not re.search(r'[.!?:;»)]$', out[-1][0])
        if foot.strip():
            out.append(para(foot.strip()))
    if not out:
        return []
    assembled = '\n\n'.join(p[0] for p in out)
    if assembled != raw.strip():
        raise ValueError(f'{directory}: OCR-страницы не совпадают с volume.txt; пересоберите том через assemble.py')
    spans, offset = [], len(raw) - len(raw.lstrip())
    for text, parts in out:
        spans.extend(dict(start=offset+a, end=offset+b, page=pg, file=fn, page_method=method) for a,b,pg,fn,method in parts)
        offset += len(text) + 2
    return spans


def windows(text, target=230, maximum=300, overlap=35):
    """Предпочитает абзацы и предложения, длинные абзацы делит по словам."""
    words = list(re.finditer(r'\S+', text))
    ends = [m.end() for m in words]
    boundaries = set()
    for m in re.finditer(r'\n\n|[.!?;»]\s+(?=[А-ЯЁѢІ])', text):
        boundaries.add(bisect.bisect_right(ends, m.start()+1))
    start = 0
    while start < len(words):
        if len(words)-start <= maximum:
            end = len(words)
        else:
            choices = [n for n in boundaries if start+150 <= n <= start+maximum]
            end = min(choices, key=lambda n: (abs(n-start-target), n)) if choices else start+target
        yield words[start].start(), words[end-1].end(), end-start
        if end == len(words):
            break
        start = max(start+1, end-overlap)


def build_passages(root, docs, texts, stems, modernize, stem):
    """Данные по томам загружаются лениво. В индексе нет копии первоисточника."""
    root = Path(root)
    glossary = json.loads((root/'lex/glossary.json').read_text(encoding='utf-8'))
    records = {}
    for f in sorted((root/'lex/enrichment').glob('*.json')):
        records.update(json.loads(f.read_text(encoding='utf-8')).get('passages', {}))
    output, manifests = {}, []
    for year, volume_texts in texts.items():
        source_dir = root/f'ocr/{year}'
        # Некоторые источники поступают единым текстом FineReader без
        # проверяемых OCR-листов. Обычный поиск по ним допустим, но для
        # понятийной выдачи нельзя выдумывать страницы и точные фрагменты.
        if not list(source_dir.glob('p*.txt')):
            print(f'  пассажи {year}: не собраны (нет проверяемых OCR-листов)')
            continue
        raw = (source_dir/'volume.txt').read_text(encoding='utf-8')
        spans = source_pages(source_dir, raw)
        vd = [d for d in docs if str(d['vol']) == year]
        items, text_fields, enrichment_fields, sequences = [], [], [], []
        for d, text in zip(vd, volume_texts):
            origin = raw.find(text)
            if origin < 0 or raw.find(text, origin+1) >= 0:
                raise ValueError(f'{d["id"]}: текст решения не имеет однозначного смещения в томе')
            for start, end, count in windows(text):
                pid = f'{d["id"]}:{start}-{end}'
                digest = hashlib.sha256(text[start:end].encode()).hexdigest()
                sources = [dict(page=p['page'], page_method=p['page_method'], file=p['file'], start=max(start,p['start']-origin), end=min(end,p['end']-origin))
                           for p in spans if p['end'] > origin+start and p['start'] < origin+end]
                pages = list(dict.fromkeys(p['page'] for p in sources if p['page'] is not None))
                item = dict(id=pid, decision=d['id'], doc=d['i'], start=start, end=end, words=count,
                            pages=pages, sources=sources, sha256=digest)
                ann = records.get(pid)
                if ann is not None:
                    checked = validated_annotation(pid, ann, text[start:end], digest)
                    if checked is not None:
                        item['ai'] = checked
                items.append(item)
                text_fields.append(stems(text[start:end]))
                sequences.append([stem(w) for w in re.findall(r'[а-я0-9]+', modernize(text[start:end]).lower().replace('ё','е'))])
                ai = item.get('ai', {})
                enrichment_fields.append([] if ai.get('source_warning') else
                                         stems(' '.join([ai.get('summary', ''), *ai.get('concepts', [])])))
        vocabulary = sorted(set(w for seq in sequences for w in seq))
        word_ids = {w:i for i,w in enumerate(vocabulary)}
        original = _field_index(text_fields)
        original['vocabulary'] = vocabulary
        original['sequence'] = [[word_ids[w] for w in seq] for seq in sequences]
        obj = dict(passages=items, original=original, enriched=_field_index(enrichment_fields))
        name = f'passages-{year}.json'
        output[name] = obj
        manifests.append(dict(year=int(year), file=name, passages=len(items), enriched=sum('ai' in p for p in items),
                              source_warnings=sum(bool(p.get('ai', {}).get('source_warning')) for p in items),
                              enrichment_searchable=sum('ai' in p and not p['ai'].get('source_warning') for p in items),
                              pages_known=sum(bool(p['pages']) for p in items)))
    # Выбранный режим хранится явно; оценка может запускать все варианты.
    config = json.loads((root/'lex/search-config.json').read_text(encoding='utf-8'))
    output['concepts.json'] = dict(version=1, method=config['method'], glossary=glossary, volumes=manifests)
    for name,obj in output.items():
        (root/'lex/data'/name).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    for v in manifests:
        print(f'  пассажи {v["year"]}: {v["passages"]}, страницы {v["pages_known"]}, обогащены {v["enriched"]}')
