#!/usr/bin/env python3
"""Ссылки на прежние решения: департамент, год, номер и буквальное основание.

Департамент не выводится из темы, тома автора или единственности номера в
корпусе. Без обозначения в ссылке переход к решению не создаётся.
"""
import collections
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlencode

CIVIL = 'Гражданский кассационный департамент'
CRIMINAL = 'Уголовный кассационный департамент'
ASSEMBLY = 'Общее собрание'
TRANSLATE = str.maketrans('ѣѢіІѳѲѵѴ', 'еЕиИфФиИ')
YEAR = re.compile(r'(?<!\d)(?P<year>18\d{2}|19\d{2})\s*г(?:ода|од[а-я]*|\.)?[,\s]*(?:за\s+)?№\s*№?\s*(?P<number>\d+)')
NEXT_NUMBER = re.compile(r'\s*(?:,\s*(?:и\s*)?|и\s*)(?:№\s*)?(\d+)')
HEAD = re.compile(r'(?<![а-я])(?:реш(?:ен[а-я]*|\.)|опред(?:елен[а-я]*|\.))')
STATUTORY = re.compile(r'собр[а-я]*\.?\s*узак|сборн[а-я]*\.?\s*узак')
DEPARTMENTS = [
    (ASSEMBLY, re.compile(r'(?<![а-я])общ(?:[а-я]*|\.)\s+собр(?:[а-я]*|\.)')),
    (CIVIL, re.compile(r'(?<![а-я])(?:граждан[а-я]*|гражд[а-я]*\.?|гр\.?|г\.)\s*(?:кассац[а-я]*\.?|касс?\.?|к\.)(?:\s*(?:деп[а-я]*\.?|д[—–-]т[а-я]*|д\.))?')),
    (CRIMINAL, re.compile(r'(?<![а-я])(?:уголов[а-я]*|уг\.?|у\.)\s*(?:кассац[а-я]*\.?|касс?\.?|к\.)?\s*(?:деп[а-я]*\.?|д[—–-]т[а-я]*|д\.)')),
]


def normalized(text):
    value = text.translate(TRANSLATE).lower()
    if len(value) != len(text):
        raise ValueError('Нормализация ссылки изменила Unicode-смещения')
    return value


def department_marks(text):
    marks = []
    for department, pattern in DEPARTMENTS:
        for match in pattern.finditer(text):
            # Общее собрание общества/кредиторов — не учреждение Сената.
            if department == ASSEMBLY and re.match(r'\s+(?:заимодав|кредитор|акционер|пайщик|участник|общества)', text[match.end():]):
                continue
            marks.append(dict(department=department, start=match.start(), end=match.end()))
    return sorted(marks, key=lambda m: (m['start'], m['end']))


def list_bridge(text):
    """Наследование разрешено только внутри перечня ссылок, без повествования."""
    if len(text) > 160 or '\n\n' in text or any(c in text for c in '()'):
        return False
    for mark in reversed(department_marks(text)):
        text = text[:mark['start']] + ' ' + text[mark['end']:]
    words = re.findall(r'[а-я0-9]+', text)
    return all(w in {'и', 'а', 'также', 'за', 'по', 'реш', 'решения', 'решении', 'г', 'года'} for w in words)


def extract(text, own_year):
    """Возвращает упоминания с точными смещениями в оригинале, без разрешения ID."""
    t = normalized(text)
    heads = list(HEAD.finditer(t))
    marks = department_marks(t)
    groups = []
    for match in YEAR.finditer(t):
        year = int(match['year'])
        if not 1860 <= year <= own_year + 1:
            continue
        boundary = t.rfind('\n\n', 0, match.start())
        pstart = boundary + 2 if boundary >= 0 else 0
        left = max(0, pstart, match.start() - 380)
        before_heads = [h for h in heads if left <= h.start() < match.start()]
        previous = groups[-1] if groups else None
        chain = bool(previous and list_bridge(t[previous['end']:match.start()]))
        if not before_heads and not chain:
            continue
        head = before_heads[-1] if before_heads else None
        hstart = head.start() if head else previous['start']
        # Номер Собрания узаконений не становится номером решения.
        if STATUTORY.search(t[hstart:match.start()]):
            continue
        numbers = [int(match['number'])]
        end = match.end()
        while following := NEXT_NUMBER.match(t, end):
            # «1878 №162 и 1886 г. №32»: 1886 — следующий год, не номер.
            if re.match(r'\s*г(?:\.|од[а-я]*|\b)', t[following.end():]):
                break
            active_parenthesis=t.rfind('(', pstart, match.start()) > t.rfind(')', pstart, match.start())
            if (t[following.end():].startswith(')') and not active_parenthesis) or re.match(r'\s*(?:руб|коп|р\.|ст\.)', t[following.end():]):
                break
            numbers.append(int(following[1])); end = following.end()
        department, mark, association = None, None, None
        # Обозначение между последней ссылкой и годом принадлежит новой
        # части перечня. До заголовка его принимаем только при тесной связи.
        candidates = [m for m in marks if left <= m['start'] < match.start()]
        if previous:
            candidates = [m for m in candidates if m['start'] >= previous['end']]
        if candidates:
            candidate = candidates[-1]
            gap = t[candidate['end']:hstart] if candidate['end'] <= hstart else ''
            close_prefix=bool(re.fullmatch(r'[\s,;:(.]*(?:(?:въ?|именно|такъ?|сборн[а-я]*|сб|за|его|также)[\s,;:(.]*)*', gap))
            qualified_prefix=bool(re.search(r'сенат|департамент', gap))
            crossing=bool(re.search(r'№|\bчто\b|наход[а-я]*|признал[а-я]*|указал[а-я]*|постановил[а-я]*', gap))
            if candidate['start'] >= hstart or (len(gap) <= 230 and not crossing and (close_prefix or qualified_prefix)):
                department, mark, association = candidate['department'], candidate, 'explicit'
                hstart = min(hstart, candidate['start'])
        if department is None and chain:
            department, mark = previous['department'], previous['mark']
            association = 'list' if department else None
            if mark:
                hstart = min(hstart, mark['start'])
        group = dict(year=year, numbers=list(dict.fromkeys(numbers)), start=hstart, end=end,
                     year_start=match.start(), department=department, mark=mark, association=association,
                     chain=chain)
        groups.append(group)

    # «1902 №36, 1903 №34 и 1904 №21 по общ. собранию»: обозначение после
    # перечня относится и к его предыдущим неатрибутированным элементам.
    for i, group in enumerate(groups):
        right = min(len(t), group['end'] + 110)
        next_start = groups[i + 1]['year_start'] if i + 1 < len(groups) else len(t)
        trailing = [m for m in marks if group['end'] <= m['start'] < min(right, next_start)]
        if not trailing:
            continue
        mark = trailing[0]
        gap = t[group['end']:mark['start']]
        if not re.fullmatch(r'[\s,]*(?:по\s+)?', gap):
            continue
        j = i
        while j >= 0:
            row = groups[j]
            if row['department'] and row['department'] != mark['department']:
                break
            if row['association'] == 'explicit':
                break
            row.update(department=mark['department'], mark=mark, association='trailing', end=max(row['end'], mark['end']))
            if not row['chain']:
                break
            j -= 1
    result = []
    for group in groups:
        for number in group['numbers']:
            row = {k: group[k] for k in ('year', 'start', 'end', 'department', 'association')}
            mark = group['mark']
            if mark:
                row['start'] = min(row['start'], mark['start'])
                row['end'] = max(row['end'], mark['end'])
            row.update(number=number, department_start=mark['start'] if mark else None,
                       department_end=mark['end'] if mark else None, citation_start=group['year_start'])
            result.append(row)
    return result


def resolve(reference, targets):
    """Только полное совпадение учреждения, года и номера даёт ссылку."""
    if reference['department'] is None:
        return None, 'department_unknown'
    matches = targets.get((reference['department'], reference['year'], reference['number']), [])
    if len(matches) == 1:
        return matches[0]['id'], 'linked'
    return None, 'ambiguous_target' if matches else 'not_in_corpus'


def citation_analytics(references):
    groups = collections.defaultdict(list)
    for ref in references:
        if ref['department'] is None:
            continue  # Без учреждения это ещё не тождественный прецедент.
        groups[(ref['department'], ref['year'], ref['number'], ref['target_id'], ref['status'])].append(ref)
    rows = [dict(department=k[0], year=k[1], number=k[2], target_id=k[3], status=k[4],
                 decisions=len({r['source_id'] for r in refs}), mentions=len(refs)) for k, refs in groups.items()]
    return sorted(rows, key=lambda r: (-r['decisions'], r['department'] or '', r['year'], r['number']))[:40]


def build_precedents(root):
    data = Path(root) / 'lex' / 'data'
    meta = json.loads((data / 'meta.json').read_text())
    ids = [doc['id'] for doc in meta['decisions']]
    if len(ids) != len(set(ids)):
        raise ValueError('Постоянный ID решения не уникален; безопасный переход невозможен')
    targets = collections.defaultdict(list)
    for doc in meta['decisions']:
        targets[(doc['dept'], doc['vol'], doc['num'])].append(doc)
    references = []
    for volume in meta['volumes']:
        year = volume['year']
        docs = [d for d in meta['decisions'] if d['vol'] == year]
        texts = json.loads((data / f'text-{year}.json').read_text())
        if len(docs) != len(texts):
            raise ValueError(f'{year}: решения не совпадают с текстами')
        passages = json.loads((data / f'passages-{year}.json').read_text())['passages']
        scans = json.loads((data / f'scans-{year}.json').read_text())
        for doc, text in zip(docs, texts):
            digest = hashlib.sha256(text.encode()).hexdigest()
            own_passages = [p for p in passages if p['decision'] == doc['id']]
            for ref in extract(text, year):
                target, status = resolve(ref, targets)
                start, end = ref['start'], ref['end']
                p = next((p for p in own_passages if p['start'] <= start and p['end'] >= end), None)
                sources = {s['file']: s for passage in own_passages for s in passage['sources'] if s['end'] > start and s['start'] < end}
                pages = sorted({s['page'] for s in sources.values() if s['page'] is not None})
                boundary = text.rfind('\n\n', 0, start)
                cstart = max(boundary + 2 if boundary >= 0 else 0, start - 180)
                cend = min(len(text), end + 220)
                next_break = text.find('\n\n', end)
                if next_break >= 0:
                    cend = min(cend, next_break)
                ident=f'{doc["id"]}:{ref["year"]}:{ref["number"]}:{ref["citation_start"]}'
                query = urlencode(dict(mode='precedent', ref=ident, at=start, end=end))
                references.append(dict(id=ident, source_id=doc['id'],
                    source_year=year, source_department=doc['dept'], source_sha256=digest,
                    **ref, status=status, target_id=target, quote_original=text[start:end],
                    target_url=f'#/d/{target}' if target else None,
                    department_evidence=text[ref['department_start']:ref['department_end']] if ref['department'] else None,
                    context_start=cstart, context_end=cend, context_original=text[cstart:cend],
                    passage_id=p['id'] if p else None, pages=pages, sources=list(sources.values()),
                    source_url=f'#/d/{doc["id"]}?{query}',
                    scan_available=bool(p and scans['passages'].get(p['id']))))
    ids = [r['id'] for r in references]
    if len(ids) != len(set(ids)):
        raise ValueError('Повтор идентификатора прецедентной ссылки')
    output = dict(version=1, references=references, counts=dict(collections.Counter(r['status'] for r in references)),
                  note='Департамент определяется по обозначению в оригинальной ссылке или её перечне. Год и номер без департамента не устанавливают тождество. Наличие ссылки не означает согласия Сената с процитированным доводом.')
    (data / 'precedents.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'))+'\n')
    analytics_path = data / 'analytics.json'
    analytics = json.loads(analytics_path.read_text())
    # Старое поле оставлено для совместимости; индекс-переход в нём удалён.
    analytics['cited'] = [[y, n, count, None] for y, n, count, _ in analytics.get('cited', [])]
    analytics['cited_decisions'] = citation_analytics(references)
    analytics['precedent_counts'] = output['counts']
    analytics_path.write_text(json.dumps(analytics, ensure_ascii=False, separators=(',', ':')))
    return output
