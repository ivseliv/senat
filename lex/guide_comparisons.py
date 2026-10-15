#!/usr/bin/env python3
"""Сравнительные разборы: закреплённые тексты и страницы каждой цитаты."""
import argparse
import hashlib
import json
from pathlib import Path

from decision_analyses import evidence_record, load_texts, read

LEX = Path(__file__).resolve().parent
SOURCE = LEX / 'guide-comparisons-source.json'
GUIDES = LEX / 'guides-source.json'
DATA = LEX / 'data'
OUT = DATA / 'guides.json'


def guide_decisions(guide):
    """Все дела темы, включая новые дела сравнительного разбора."""
    return list(dict.fromkeys(
        [ident for group in guide['groups'] for ident in group['decisions']] +
        [case['id'] for case in guide.get('comparison', {}).get('cases', [])]))


def required(obj, fields):
    for field in fields:
        if not isinstance(obj.get(field), str) or not obj[field].strip():
            raise ValueError(f'Не заполнено поле {field}')


def build():
    guides, source = read(GUIDES), read(SOURCE)
    if source['schema_version'] != 1:
        raise ValueError('Неизвестная схема сравнительных разборов')
    guides['schema_version'] = 2
    by_guide = {g['id']: g for g in guides['guides']}
    if len(by_guide) != len(guides['guides']):
        raise ValueError('Повтор темы')
    meta = read(DATA / 'meta.json')
    docs = {d['id']: d for d in meta['decisions']}
    texts = load_texts(meta)
    passages, scans = {}, {}
    for year in {d['vol'] for d in docs.values()}:
        passages[year] = read(DATA / f'passages-{year}.json')['passages']
        scans[year] = read(DATA / f'scans-{year}.json')
    seen = set()
    for spec in source['comparisons']:
        gid = spec['guide_id']
        if gid not in by_guide or gid in seen:
            raise ValueError(f'{gid}: неизвестная или повторная тема')
        seen.add(gid)
        required(spec, ('title', 'question', 'scope', 'limits'))
        ids = [case['id'] for case in spec['cases']]
        if len(ids) < 2 or len(ids) != len(set(ids)):
            raise ValueError(f'{gid}: нужны разные решения для сравнения')
        for case in spec['cases']:
            ident = case['id']
            if ident not in docs:
                raise ValueError(f'{ident}: решение отсутствует')
            if hashlib.sha256(texts[ident].encode('utf-8')).hexdigest() != case['source_sha256']:
                raise ValueError(f'{ident}: текст изменился; требуется повторная содержательная вычитка')

        def evidence(ident, item):
            doc = docs[ident]
            own = [p for p in passages[doc['vol']] if p['decision'] == ident]
            result = dict(evidence_record(texts[ident], item['quote'], own, scans[doc['vol']]), decision=ident)
            if 'note' in item:
                required(item, ('note',))
                result['editorial_note'] = item['note']
            return result

        cases = []
        for case in spec['cases']:
            ident, sections = case['id'], []
            required(case, ('title',))
            if len(case['sections']) < 3:
                raise ValueError(f'{ident}: не раскрыты обстоятельства, рассуждение и результат')
            for section in case['sections']:
                required(section, ('heading', 'speaker', 'summary'))
                if not section.get('evidence'):
                    raise ValueError(f'{ident}: тезис без цитаты')
                sections.append(dict(section, evidence=[evidence(ident, e) for e in section['evidence']]))
            cases.append(dict(case, year=docs[ident]['vol'], department=docs[ident]['dept'], sections=sections))
        comparisons = []
        if not spec['comparisons']:
            raise ValueError(f'{gid}: нет сопоставления')
        for comparison in spec['comparisons']:
            required(comparison, ('heading', 'summary'))
            used = {e['decision'] for e in comparison.get('evidence', [])}
            if len(used) < 2 or not used.issubset(ids):
                raise ValueError(f'{gid}: сопоставление требует цитат разных выбранных дел')
            comparisons.append(dict(comparison, evidence=[evidence(e['decision'], e) for e in comparison['evidence']]))
        by_guide[gid]['comparison'] = dict(
            title=spec['title'], question=spec['question'], scope=spec['scope'], limits=spec['limits'],
            label='Сравнительный разбор, подготовленный с помощью ИИ',
            verification='context_read', cases=cases, comparisons=comparisons)
    guides['comparison_count'] = len(seen)
    guides['offset_encoding'] = 'Unicode code points in UTF-8-decoded source text'
    return guides


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    obj = build()
    encoded = json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if not OUT.is_file() or OUT.read_text(encoding='utf-8') != encoded:
            raise SystemExit('guides.json устарел: запустите guide_comparisons.py')
    else:
        OUT.write_text(encoded, encoding='utf-8')
    print(f'Сравнительные разборы: {obj["comparison_count"]}; SHA, цитаты и страницы проверены.')


if __name__ == '__main__':
    main()
