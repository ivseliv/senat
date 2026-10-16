#!/usr/bin/env python3
"""Редакционный каталог всех решений, отдельно от автоматических тегов поиска."""
import argparse
import hashlib
import json
import re
from pathlib import Path

from decision_analyses import evidence_record, load_texts, read
from guide_comparisons import required

LEX = Path(__file__).resolve().parent
DATA = LEX / 'data'
SOURCE = LEX / 'topic-catalog-source.json'
OUT = DATA / 'topic-catalog.json'


def build():
    source = read(SOURCE)
    if source['schema_version'] != 1:
        raise ValueError('Неизвестная схема каталога')
    meta, guides = read(DATA / 'meta.json'), read(DATA / 'guides.json')
    docs = {d['id']: d for d in meta['decisions']}
    texts = load_texts(meta)
    known_guides = {g['id'] for g in guides['guides'] if g.get('comparison')}
    topics = {}
    for spec in source['topics']:
        required(spec, ('id', 'title', 'description'))
        ident = spec['id']
        if not re.fullmatch(r'[a-z][a-z0-9-]*', ident) or ident in topics or ident in ('all','unclassified'):
            raise ValueError(f'{ident}: неверный или повторный ID темы')
        if spec.get('comparison_guide') and spec['comparison_guide'] not in known_guides:
            raise ValueError(f'{ident}: не найден сравнительный разбор')
        topics[ident] = dict(spec, decision_ids=[])
    aliases = source.get('route_aliases', {})
    if any(k in topics or v not in topics for k, v in aliases.items()):
        raise ValueError('Неверный псевдоним темы')
    passages, scans = {}, {}
    for year in {d['vol'] for d in docs.values()}:
        passages[year] = read(DATA / f'passages-{year}.json')['passages']
        scans[year] = read(DATA / f'scans-{year}.json')
    cases = {}
    for spec in source['decisions']:
        ident = spec['id']
        if ident in cases or ident not in docs:
            raise ValueError(f'{ident}: повторное или отсутствующее решение')
        required(spec, ('title', 'summary', 'source_sha256'))
        text, doc = texts[ident], docs[ident]
        if hashlib.sha256(text.encode('utf-8')).hexdigest() != spec['source_sha256']:
            raise ValueError(f'{ident}: текст изменился; нужна повторная проверка тематической разметки')
        own = [p for p in passages[doc['vol']] if p['decision'] == ident]
        memberships = []
        for item in spec['topics']:
            topic = item['id']
            if topic not in topics or topic in [t['id'] for t in memberships]:
                raise ValueError(f'{ident}: неизвестная или повторная тема {topic}')
            ev = evidence_record(text, item['quote'], own, scans[doc['vol']])
            if 'note' in item:
                required(item, ('note',))
                ev['editorial_note'] = item['note']
            # Явное включение по ненадёжному месту не маскируется готовой аннотацией.
            # Если исправить источник нельзя, сохраняем предупреждение у цитаты.
            memberships.append(dict(id=topic, evidence=dict(ev, decision=ident)))
            topics[topic]['decision_ids'].append(ident)
        if not memberships:
            required(spec, ('review_note',))
        cases[ident] = dict(id=ident, year=doc['vol'], department=doc['dept'],
            source_sha256=spec['source_sha256'], title=spec['title'], summary=spec['summary'],
            topics=memberships, review_note=spec.get('review_note'))
    missing = set(docs) - set(cases)
    if missing:
        raise ValueError(f'Каталог неполон: нет {len(missing)} решений; {sorted(missing)[:5]}')
    order = lambda ident: (docs[ident]['vol'], docs[ident]['num'])
    for topic in topics.values():
        topic['decision_ids'].sort(key=order)
        topic['count'] = len(topic['decision_ids'])
        topic['by_year'] = {str(v['year']): sum(docs[i]['vol'] == v['year'] for i in topic['decision_ids']) for v in meta['volumes']}
    unresolved = sorted((i for i, c in cases.items() if not c['topics']), key=order)
    return dict(schema_version=1, label='Тематическая разметка, подготовленная с помощью ИИ',
        method='Темы выбраны по заголовку, изложению и аннотациям пассажей; спорные места уточнялись по полному тексту. Каждое включение подтверждается буквальной цитатой. Это редакционная навигация, не сплошная юридическая экспертиза.',
        scope='Все опубликованные решения корпуса. Одно дело может входить в несколько тем; наличие цитаты не гарантирует исчерпывающей тематической разметки.',
        offset_encoding='Unicode code points in UTF-8-decoded source text',
        count=len(cases), classified=len(cases)-len(unresolved),
        topic_count=sum(bool(t['count']) for t in topics.values()),
        memberships=sum(len(c['topics']) for c in cases.values()),
        topics=list(topics.values()), route_aliases=aliases,
        unclassified=unresolved, decisions=cases)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    obj = build()
    encoded = json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if not OUT.is_file() or OUT.read_text(encoding='utf-8') != encoded:
            raise SystemExit('topic-catalog.json устарел: пересоберите каталог')
    else:
        OUT.write_text(encoded, encoding='utf-8')
    print(f'Каталог: {obj["topic_count"]} тем, {obj["classified"]}/{obj["count"]} решений; {obj["memberships"]} включений.')


if __name__ == '__main__':
    main()
