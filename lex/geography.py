#!/usr/bin/env python3
"""Проверяемый редакционный слой географии; исходные тексты не изменяются."""
import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

from decision_analyses import evidence_record
from province_geography import apply as apply_provinces

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = 'https://ivseliv.github.io/senat/lex/'
ROLES = {'court': 'Судебное учреждение',
         'event_property': 'Место событий или имущества',
         'person_organization': 'Лицо или организация',
         'mention_unclear': 'Прочее упоминание'}


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def validate_place(place):
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', place['id']):
        raise ValueError('Неверный ID населённого пункта')
    for key, bound in [('lat', 90), ('lon', 180)]:
        value = place.get(key)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or abs(value) > bound:
            raise ValueError('Недопустимая координата: ' + place['id'])
    for key in ('historical_name', 'modern_name', 'coordinate_source', 'coordinate_note', 'identity_source'):
        if not isinstance(place.get(key), str) or not place[key].strip():
            raise ValueError('Нет географического основания: ' + key)
    for key in ('coordinate_source', 'identity_source'):
        if not place[key].startswith('https://'):
            raise ValueError('Требуется открытая ссылка на источник координат/идентификации')
    revision = place.get('coordinate_revision')
    url = urlparse(place['coordinate_source'])
    if type(revision) is not int or revision <= 0 or url.hostname != 'www.wikidata.org' or parse_qs(url.query).get('oldid') != [str(revision)]:
        raise ValueError('Координаты должны ссылаться на закреплённую редакцию Wikidata')
    if not isinstance(place.get('aliases'), list) or not all(isinstance(a, str) for a in place['aliases']):
        raise ValueError('Алиасы должны быть массивом строк')


def validate_mention(spec, text, places):
    ident = spec['id']
    if spec.get('source_sha256') != hashlib.sha256(text.encode()).hexdigest():
        raise ValueError(ident + ': изменился исходный текст')
    if spec['role'] not in ROLES:
        raise ValueError(ident + ': неизвестная роль')
    a, b, c, d = (spec[key] for key in ('start', 'end', 'mention_start', 'mention_end'))
    if not all(type(n) is int for n in (a, b, c, d)) or not 0 <= a <= c < d <= b <= len(text):
        raise ValueError(ident + ': неверные Unicode-смещения')
    if text[a:b] != spec['quote'] or text[c:d] != spec['mention']:
        raise ValueError(ident + ': цитата или название расходятся с источником')
    if spec['place_id'] is None:
        if not spec.get('unresolved_reason'):
            raise ValueError(ident + ': нет причины неопределённости')
    elif spec['place_id'] not in places:
        raise ValueError(ident + ': неизвестный населённый пункт')


def build(root=ROOT):
    lex = Path(root) / 'lex'
    source = read(lex / 'geography-source.json')
    if source['schema_version'] != 1:
        raise ValueError('Неизвестная схема географии')
    meta = read(lex / 'data/meta.json')
    docs = {d['id']: d for d in meta['decisions']}
    texts, passages, scans = {}, {}, {}
    for year in sorted({d['vol'] for d in docs.values()}):
        own = [d for d in docs.values() if d['vol'] == year]
        values = read(lex / f'data/text-{year}.json')
        if len(own) != len(values):
            raise ValueError('Число текстов не совпадает с решениями')
        texts.update((d['id'], t) for d, t in zip(own, values))
        passages[year] = read(lex / f'data/passages-{year}.json')['passages']
        scans[year] = read(lex / f'data/scans-{year}.json')
    places = {}
    for place in source['places']:
        validate_place(place)
        if place['id'] in places:
            raise ValueError('Повтор населённого пункта')
        places[place['id']] = place
    mentions, ids = [], set()
    for spec in source['mentions']:
        if spec['id'] in ids:
            raise ValueError('Повтор географического упоминания')
        ids.add(spec['id'])
        text, doc = texts[spec['decision_id']], docs[spec['decision_id']]
        validate_mention(spec, text, places)
        evidence = evidence_record(text, spec['quote'],
                                   [p for p in passages[doc['vol']] if p['decision'] == doc['id']], scans[doc['vol']])
        if evidence['start'] != spec['start'] or evidence['end'] != spec['end']:
            raise ValueError('Неоднозначная позиция цитаты')
        query = urlencode(dict(mode='places', geo=spec['id'], at=spec['start'], end=spec['end']))
        mentions.append(dict(spec, year=doc['vol'], **{k: v for k, v in evidence.items() if k not in ('text', 'start', 'end')},
                             url=PUBLIC + '#/d/' + doc['id'] + '?' + query))
    used = {m['place_id'] for m in mentions if m['place_id']}
    if used != set(places):
        raise ValueError('Справочник содержит точки без подтверждённых цитат')
    provincial = apply_provinces(lex, places, mentions)
    chosen = {m['decision_id'] for m in mentions}
    coverage = dict(total_decisions=len(docs), decisions=len(chosen), mentions=len(mentions),
                    places=len(places), mapped_mentions=sum(m['place_id'] is not None for m in mentions),
                    unresolved_mentions=sum(m['place_id'] is None for m in mentions),
                    by_year={str(y): dict(total=sum(d['vol'] == y for d in docs.values()),
                                         decisions=len({m['decision_id'] for m in mentions if m['year'] == y}),
                                         mentions=sum(m['year'] == y for m in mentions)) for y in sorted(scans)},
                    by_role=dict(Counter(m['role'] for m in mentions)), complete=False,
                    note='Выборочная редакционная разметка. Отсутствие точки не означает отсутствия места в решении. Число дел на карте не измеряет географию всей судебной практики.')
    coverage.update(provinces=len(provincial['provinces']),
                    province_mentions=sum(m['province_id'] is not None for m in mentions),
                    unresolved_province_mentions=sum(m['province_id'] is None for m in mentions))
    return dict(schema_version=1, roles=ROLES, label='География решений', method=source['method'],
                offset_encoding='Unicode code points in UTF-8-decoded source text', coverage=coverage,
                **provincial,
                places=sorted(places.values(), key=lambda p: p['historical_name']),
                mentions=sorted(mentions, key=lambda m: (m['decision_id'], m['mention_start'], m['id'])))


def geojson(data):
    features = []
    for place in data['places']:
        mentions = [m for m in data['mentions'] if m['place_id'] == place['id']]
        properties = {k: v for k, v in place.items() if k not in ('lat', 'lon')}
        properties.update(decision_ids=sorted({m['decision_id'] for m in mentions}),
                          mention_ids=[m['id'] for m in mentions], url=PUBLIC + '#/places?p=' + place['id'])
        features.append(dict(type='Feature', id=place['id'], properties=properties,
                             geometry=dict(type='Point', coordinates=[place['lon'], place['lat']])))
    return dict(type='FeatureCollection', coverage=data['coverage'], features=features)


def write(root=ROOT):
    data = build(root)
    folder = Path(root) / 'lex/data'
    for name, obj in [('geography.json', data), ('geography.geojson', geojson(data))]:
        (folder / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    return data


if __name__ == '__main__':
    print(json.dumps(write()['coverage'], ensure_ascii=False))
