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


def source_pages(directory, raw):
    """Повторяет assemble.py, сохраняя диапазоны каждого листа; сверяет весь том.

    Номера берём из колонтитула или согласующихся соседних колонтитулов,
    никогда не выводим из номера PDF.
    При расхождении сборок не угадываем смещения и останавливаем сборку.
    """
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
        raw = (root/f'ocr/{year}/volume.txt').read_text(encoding='utf-8')
        spans = source_pages(root/f'ocr/{year}', raw)
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
                if ann and ann.get('sha256') == digest:
                    # Цитата обязательна: устаревшие/чужие аннотации не индексируем.
                    if not ann.get('evidence') or ann['evidence'] not in text[start:end]:
                        raise ValueError(f'{pid}: цитата обогащения отсутствует в пассаже')
                    item['ai'] = {k: ann[k] for k in ('summary','concepts','evidence')}
                items.append(item)
                text_fields.append(stems(text[start:end]))
                sequences.append([stem(w) for w in re.findall(r'[а-я0-9]+', modernize(text[start:end]).lower().replace('ё','е'))])
                enrichment_fields.append(stems(' '.join([item.get('ai',{}).get('summary',''), *item.get('ai',{}).get('concepts',[])])))
        def index(fields):
            post, lengths = {}, []
            for i, ss in enumerate(fields):
                lengths.append(len(ss))
                for s, n in collections.Counter(ss).items():
                    post.setdefault(s, []).extend([i,n])
            return dict(n=len(fields), avgdl=sum(lengths)/max(1,len(fields)), len=lengths, post=post, hpost={})
        vocabulary = sorted(set(w for seq in sequences for w in seq))
        word_ids = {w:i for i,w in enumerate(vocabulary)}
        original = index(text_fields)
        original['vocabulary'] = vocabulary
        original['sequence'] = [[word_ids[w] for w in seq] for seq in sequences]
        obj = dict(passages=items, original=original, enriched=index(enrichment_fields))
        name = f'passages-{year}.json'
        output[name] = obj
        manifests.append(dict(year=int(year), file=name, passages=len(items), enriched=sum('ai' in p for p in items),
                              pages_known=sum(bool(p['pages']) for p in items)))
    # Выбранный режим хранится явно; оценка может запускать все варианты.
    config = json.loads((root/'lex/search-config.json').read_text(encoding='utf-8'))
    output['concepts.json'] = dict(version=1, method=config['method'], glossary=glossary, volumes=manifests)
    for name,obj in output.items():
        (root/'lex/data'/name).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    for v in manifests:
        print(f'  пассажи {v["year"]}: {v["passages"]}, страницы {v["pages_known"]}, обогащены {v["enriched"]}')
