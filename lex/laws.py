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
    left = max(text.rfind('\n\n', 0, start) + 2, start - limit // 2)
    right_break = text.find('\n\n', end)
    right = len(text) if right_break < 0 else right_break
    right = min(right, end + limit // 2)
    return text[left:right].strip()


def build_law_index(root=ROOT):
    root = Path(root)
    data = root / 'lex' / 'data'
    catalog = read_json(root / 'lex' / 'laws.json')
    acts = {act['code']: dict(act) for act in catalog['acts']}
    meta = read_json(data / 'meta.json')
    passages_by_decision, scans_by_year = collections.defaultdict(list), {}
    for volume in meta['volumes']:
        year = volume['year']
        passages = read_json(data / f'passages-{year}.json')['passages']
        for passage in passages:
            passages_by_decision[passage['decision']].append(passage)
        scans_by_year[year] = read_json(data / f'scans-{year}.json')

    citations, unlocated, missing_catalog = [], 0, set()
    for volume in meta['volumes']:
        year = volume['year']
        docs = [d for d in meta['decisions'] if d['vol'] == year]
        texts = read_json(data / f'text-{year}.json')
        for doc, text in zip(docs, texts):
            for statute in sorted(doc.get('statutes', {})):
                code, _, article = statute.partition(' ')
                if code == '?':
                    continue
                if code not in acts:
                    missing_catalog.add(code)
                    continue
                match, direct = choose_match(text, article_matches(text, article), code)
                if not match:
                    unlocated += 1
                    continue
                passage = next((p for p in passages_by_decision[doc['id']]
                                if p['start'] <= match.start() < p['end']), None)
                scan_refs = scans_by_year[year]['passages'].get(passage['id'], []) if passage else []
                citations.append({
                    'id': f'{doc["id"]}:{code}:{article_number(article)}:{match.start()}',
                    'statute': statute, 'code': code, 'article': article,
                    'decision_id': doc['id'], 'year': year, 'decision_number': doc['num'],
                    'start': match.start(), 'end': match.end(),
                    'quote_original': match.group(0), 'context_original': context(text, match.start(), match.end()),
                    'association': 'прямое название акта рядом с номером' if direct else 'акт определён по контексту решения',
                    'citation_status': 'номер статьи извлечён из OCR; сверяйте со сканом',
                    'decision_url': decision_url(doc['id']),
                    'passage_id': passage['id'] if passage else None,
                    'passage_url': passage_url(doc['id'], passage, code, article) if passage else None,
                    'scan_available': bool(scan_refs),
                })

    if missing_catalog:
        raise ValueError('Нет карточки акта: ' + ', '.join(sorted(missing_catalog)))
    by_code = collections.defaultdict(list)
    for citation in citations:
        by_code[citation['code']].append(citation)
    output_acts = []
    for code, act in acts.items():
        rows = by_code.get(code, [])
        articles = collections.Counter(row['article'] for row in rows)
        output_acts.append({
            **act,
            'citations': len(rows),
            'decisions': len({row['decision_id'] for row in rows}),
            'articles': [{'article': article, 'citations': count,
                          'decisions': len({row['decision_id'] for row in rows if row['article'] == article})}
                         for article, count in sorted(articles.items(), key=lambda item: (-item[1], item[0]))],
        })
    output = {
        'version': 1,
        'sources': catalog['sources'],
        'acts': output_acts,
        'citations': sorted(citations, key=lambda row: (row['code'], row['article'], row['year'], row['decision_number'], row['start'])),
        'unknown_act_mentions': sum(1 for doc in meta['decisions'] for statute in doc.get('statutes', {}) if statute.startswith('? ')),
        'unlocated_known_mentions': unlocated,
        'note': 'Карточки актов сверены по библиографическим и цифровым источникам. Номер статьи и историческую редакцию следует сверять с оригинальным сканом и изданием.',
    }
    (data / 'laws.json').write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return output


if __name__ == '__main__':
    result = build_law_index()
    print('указатель законодательства:', len(result['acts']), 'актов,', len(result['citations']), 'цитат')
