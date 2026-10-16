#!/usr/bin/env python3
"""Строит проверяемый указатель законодательных ссылок корпуса.

Индекс не заменяет историческое издание закона. Он связывает извлечённую
ссылку с карточкой акта, буквальным фрагментом OCR, пассажем и, если он
опубликован, сканом этого пассажа. Редакция статьи на дату решения намеренно
не выводится автоматически.
"""
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'lex' / 'data'
CATALOG = ROOT / 'lex' / 'laws.json'
PUBLIC = 'https://ivseliv.github.io/senat/lex/'


# Эти же обозначения используются извлекателем build.py. Шаблоны нужны лишь
# чтобы различить прямое название акта и унаследованную им привязку в OCR.
ACT_PATTERNS = {
    'УГС': r'уст(?:ав\w*|\.)?\s*гр(?:аж\w*|\.)?\s*суд',
    'УУС': r'уст(?:ав\w*|\.)?\s*уг(?:ол\w*|\.)?\s*суд',
    'УСУ': r'учр(?:еждени\w*|\.)?\s*суд(?:еб\w*|\.)?\s*уст',
    'УТ': r'уст(?:ав\w*|\.)?\s*торг|т\.?\s*xi\b|т\.?\s*хi\b|т\.?\s*хи\b',
    'СЗГ': r'св\.?\s*зак\.?\s*гр|т\.?\s*[xх]\s*ч\.?\s*1|[xх]\s*т\.?\s*1\s*ч|1\s*ч\.?\s*[xх]\s*т|зак\.?\s*гражд',
    'УЖД': r'общ\.?\s*уст\.?\s*(?:росс\.?\s*)?ж(?:ел)?\.?\s*д|уст\.?\s*жел',
    'ГКП': r'гр\.?\s*код|гражд\.?\s*код',
    'УН': r'улож\.?\s*о\s*нак|уст\.?\s*о\s*нак',
    'ПОЛ': r'полож\.?\s*(?:19\s*окт|о\s*введ)',
}


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def passage_url(decision, passage, code, article):
    """Точная ссылка, которая после закрытия карточки возвращает к той же норме."""
    from urllib.parse import urlencode
    query = urlencode({
        'mode': 'laws', 'c': code, 'q': article,
        'at': passage['start'], 'end': passage['end'],
    })
    return f'#/d/{decision}?{query}'


def decision_url(decision):
    return f'#/d/{decision}'


def article_number(article):
    return article.replace('ст.', '').strip()


def number_pattern(number):
    """Разрешает пробелы и три варианта тире, но не меняет номер статьи."""
    value = re.escape(number)
    value = value.replace(r'\ ', r'\s*')
    value = value.replace(r'\–', r'[—–-]')
    value = value.replace(r'\—', r'[—–-]')
    value = value.replace(r'\-', r'[—–-]')
    return value


def article_matches(text, article):
    number = number_pattern(article_number(article))
    patterns = [
        re.compile(r'(?<!\d)ст(?:ст)?\.?\s*' + number + r'(?![\d¹²³⁰-⁹])', re.I),
        re.compile(r'(?<!\d)' + number + r'\s*ст\.?(?![а-яё])', re.I),
    ]
    return [match for pattern in patterns for match in pattern.finditer(text)]


def nearest_named_act(text, position, code):
    rx = re.compile(ACT_PATTERNS[code], re.I)
    window_start, window_end = max(0, position - 120), min(len(text), position + 120)
    return bool(rx.search(text[window_start:window_end]))


def choose_match(text, matches, code):
    if not matches:
        return None, False
    scored = []
    for match in matches:
        direct = nearest_named_act(text, match.start(), code)
        # При равенстве предпочтителен самый ранний текстовый источник.
        scored.append((0 if direct else 1, match.start(), match, direct))
    _, _, match, direct = min(scored, key=lambda item: item[:2])
    return match, direct


def context(text, start, end, limit=280):
    paragraph = text.rfind('\n\n', 0, start)
    left = max(paragraph + 2 if paragraph >= 0 else 0, start - limit // 2)
    right_break = text.find('\n\n', end)
    right = len(text) if right_break < 0 else right_break
    right = min(right, end + limit // 2)
    return text[left:right].strip()


def location_info(text, start, end, passages, manifest):
    """Все страницы буквальной цитаты, а не первая страница решения."""
    overlaps = [p for p in passages if p['start'] < end and p['end'] > start]
    containing = next((p for p in overlaps if p['start'] <= start and end <= p['end']), None)
    sources = {}
    for p in overlaps:
        for source in p.get('sources', []):
            a, b = max(start, source['start']), min(end, source['end'])
            if a < b:
                key = (source['file'], source['page'])
                if key in sources:
                    sources[key]['start'] = min(a, sources[key]['start'])
                    sources[key]['end'] = max(b, sources[key]['end'])
                else:
                    sources[key] = dict(source, start=a, end=b)
    sources = sorted(sources.values(), key=lambda s: (s['start'], s['file']))
    scans = [dict(manifest['pages'][f], kind='page') for f in dict.fromkeys(s['file'] for s in sources)
             if f in manifest['pages']]
    warnings=list(dict.fromkeys(p['ai']['source_warning'] for p in overlaps if p.get('ai',{}).get('source_warning')))
    return dict(source_warning=' '.join(warnings) or None,passage_id=containing['id'] if containing else (overlaps[0]['id'] if overlaps else None),
                sources=sources, printed_pages=list(dict.fromkeys(s['page'] for s in sources if s['page'] is not None)),
                scans=scans, scan_available=bool(scans))


def build_law_index(root=ROOT):
    from law_attribution import apply_attributions, check_quote, sha, texts_by_id
    from urllib.parse import urlencode
    root = Path(root); data = root/'lex/data'
    source = apply_attributions(root)
    catalog = read_json(root/'lex/laws.json')
    acts = {a['code']: dict(a) for a in catalog['acts']}
    meta = read_json(data/'meta.json'); texts = texts_by_id(root, meta)
    docs = {d['id']: d for d in meta['decisions']}
    passages_by_decision, scans_by_year = collections.defaultdict(list), {}
    for volume in meta['volumes']:
        year = volume['year']
        for p in read_json(data/f'passages-{year}.json')['passages']:
            passages_by_decision[p['decision']].append(p)
        scans_by_year[year] = read_json(data/f'scans-{year}.json')
    verified = collections.defaultdict(list)
    new_keys, corrected = set(), []
    methods = collections.Counter()
    for row in source['resolutions']:
        ident = row['decision_id']; article = row['from_statute'].partition(' ')[2]
        if row['from_statute'].startswith('? '):
            new_keys.add((ident, row['from_statute']))
        elif any(t['code'] != row['from_statute'].split(' ')[0] for t in row['targets']):
            corrected.append({'decision_id':ident,'from_statute':row['from_statute'],
                              'to_statutes':[t['code']+' '+article for t in row['targets']]})
        for target in row['targets']:
            for occurrence in target['occurrences']:
                verified[ident, target['code']+' '+article].append(occurrence)
                if row['from_statute'].startswith('? '):
                    methods[occurrence['method']] += 1
    def make_row(doc, statute, occurrence, status):
        text = texts[doc['id']]; code, _, article = statute.partition(' ')
        start, end = occurrence['start'], occurrence['end']; field = occurrence.get('field', 'text')
        original = text if field == 'text' else doc['headnote']
        check_quote(original, occurrence)
        ident = f'{doc["id"]}:{code}:{article_number(article)}:{field}:{start}'
        url = decision_url(doc['id']) + '?' + urlencode({'mode':'laws','c':code,'q':article,'law':ident,'at':start,'end':end})
        location = location_info(text,start,end,passages_by_decision[doc['id']],scans_by_year[doc['vol']]) if field=='text' else dict(passage_id=None,sources=[],printed_pages=[],scans=[],scan_available=False,source_warning=None)
        association = {'direct':'акт прямо назван при этой ссылке',
                       'printed_index':'печатный указатель законов и контекст решения',
                       'repeat':'повторная ссылка с явным указанием на тот же акт'}.get(occurrence.get('method'), 'прежняя автоматическая привязка; отдельно не подтверждена')
        return dict(id=ident,statute=statute,code=code,article=article,decision_id=doc['id'],year=doc['vol'],decision_number=doc['num'],
                    field=field,start=start,end=end,quote_original=original[start:end],context_original=context(original,start,end),
                    association=association,verification_status=status,source_sha256=sha(text),headnote_sha256=sha(doc['headnote']),
                    number_status='ocr_unverified',
                    citation_status='Акт установлен по опубликованному OCR; редакция и правильность номера по скану отдельно не подтверждены.' if status=='context_verified' else 'Историческая автоматическая привязка; акт требует проверки по контексту.',
                    decision_url=decision_url(doc['id']),passage_url=url,**location,
                    evidence=occurrence.get('evidence', []))
    citations, unlocated = [], 0
    for doc in meta['decisions']:
        text = texts[doc['id']]
        for statute in sorted(doc['statutes']):
            code, _, article = statute.partition(' ')
            if code=='?': continue
            if code not in acts: raise ValueError('Нет карточки акта: '+code)
            occurrences = verified.get((doc['id'],statute),[])
            if occurrences:
                occurrence = min(occurrences,key=lambda o:(o['field']!='text',o['method']!='direct',o['start']))
                row = make_row(doc,statute,occurrence,'context_verified')
                row['occurrences'] = occurrences
                notes=[o.get('attribution_note') for o in occurrences if o.get('attribution_note')]
                if notes: row['attribution_note']=' '.join(dict.fromkeys(notes))
            else:
                match, direct = choose_match(text,article_matches(text,article),code)
                if not match:
                    unlocated += 1; continue
                row = make_row(doc,statute,dict(field='text',start=match.start(),end=match.end(),quote_original=match.group(0)), 'legacy_unverified')
                row['occurrences'] = []
            citations.append(row)
    unresolved = []
    for item in source['unresolved']:
        doc = docs[item['decision_id']]
        if item['statute'] not in doc['statutes']: raise ValueError('Неопределённая ссылка исчезла')
        occurrences = item['occurrences']
        for o in occurrences:
            check_quote(texts[doc['id']] if o['field']=='text' else doc['headnote'],o)
        occurrence = min(occurrences,key=lambda o:(o['field']!='text',o['start']))
        row = make_row(doc,item['statute'],occurrence,'act_unknown')
        row.update(association='акт не установлен: опубликованного контекста и однозначных оснований недостаточно',
                   citation_status='Не включается в указатель конкретного акта.',mentions=item['mentions'],occurrences=occurrences)
        unresolved.append(row)
    unknown_count = sum(k.startswith('? ') for d in meta['decisions'] for k in d['statutes'])
    if unknown_count != len(unresolved): raise ValueError('Не все неопределённые ссылки показаны')
    by_code = collections.defaultdict(list)
    for c in citations: by_code[c['code']].append(c)
    output_acts = []
    for code,act in acts.items():
        rows=by_code[code]; articles=collections.Counter(r['article'] for r in rows)
        output_acts.append(dict(act,citations=len(rows),decisions=len({r['decision_id'] for r in rows}),
            articles=[dict(article=a,citations=n,decisions=len({r['decision_id'] for r in rows if r['article']==a}))
                      for a,n in sorted(articles.items(),key=lambda x:(-x[1],x[0]))]))
    baseline_unknown = sum(k.startswith('? ') for d in source['decisions'].values() for k in d['statutes'])
    summary = dict(unit='уникальная пара «решение + извлечённое обозначение статьи»',baseline_unknown=baseline_unknown,
                   resolved_unknown=len(new_keys),remaining_unknown=unknown_count,corrected_known=len(corrected),
                   confirmed_citations=sum(c['verification_status']=='context_verified' for c in citations),
                   legacy_unverified_citations=sum(c['verification_status']=='legacy_unverified' for c in citations),
                   remaining_legacy_occurrences=sum(r['mentions'] for r in unresolved),new_resolution_occurrences_by_method=dict(methods),
                   by_year={str(v['year']):dict(resolved=sum(ident.startswith(str(v['year'])) for ident,k in new_keys),
                                               unresolved=sum(r['year']==v['year'] for r in unresolved)) for v in meta['volumes']})
    output = dict(version=2,sources=catalog['sources'],acts=output_acts,
        citations=sorted(citations,key=lambda r:(r['code'],r['article'],r['year'],r['decision_number'],r['start'])),
        unresolved=unresolved,attribution_summary=summary,corrected_legacy_assignments=corrected,
        unknown_act_mentions=unknown_count,unlocated_known_mentions=unlocated,
        note='Единица счёта — решение и обозначение статьи, а не число цитат. Основания новых привязок сохранены буквально; прежние непроверенные привязки отмечены отдельно. Историческая редакция статьи не устанавливается, номер в OCR может содержать ошибку.')
    (data/'laws.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return output


if __name__=='__main__':
    result=build_law_index()
    print(json.dumps(result['attribution_summary'],ensure_ascii=False))
