"""Validated historical territorial groups, separate from the 1897 map layer."""
import hashlib
import json
import math
import re
from pathlib import Path


def sources_valid(sources):
    if not isinstance(sources, list) or not sources:
        raise ValueError('Территориальная привязка требует источника')
    for source in sources:
        if not all(isinstance(source.get(k), str) and source[k].strip() for k in ('url', 'title', 'evidence')):
            raise ValueError('Нет основания территориальной привязки')
        if not source['url'].startswith('https://'):
            raise ValueError('Недопустимый адрес источника')


def validate_boundaries(data):
    if data.get('type') != 'FeatureCollection' or data.get('year') != 1897:
        raise ValueError('Неизвестный исторический слой границ')
    features = {}
    for feature in data['features']:
        ident = feature['id']
        if ident in features or not re.fullmatch(r'gub-[0-9]+', ident):
            raise ValueError('Повтор или неподдерживаемая территория границ')
        properties = feature['properties']
        if ident != 'gub-' + properties['source_id'] or not properties['label']:
            raise ValueError('Неверная подпись границы')
        if feature['geometry']['type'] != 'MultiPolygon' or not feature['geometry']['coordinates']:
            raise ValueError('Требуется непустой MultiPolygon')
        for polygon in feature['geometry']['coordinates']:
            if not polygon:
                raise ValueError('Пустой полигон')
            for ring in polygon:
                if len(ring) < 4 or ring[0] != ring[-1]:
                    raise ValueError('Незамкнутое кольцо')
                for xy in ring:
                    if len(xy) != 2 or not all(type(v) in (int, float) and math.isfinite(v) for v in xy):
                        raise ValueError('Некорректная координата границы')
                    if not -180 <= xy[0] <= 180 or not -90 <= xy[1] <= 90:
                        raise ValueError('Граница вне диапазона WGS84')
                if any(abs(a[0] - b[0]) > 180 for a, b in zip(ring, ring[1:])):
                    raise ValueError('Граница пересекает всю карту у антимередиана')
        features[ident] = feature
    return features


def validate(source, boundaries, places):
    if source['schema_version'] != 1:
        raise ValueError('Неизвестная схема губерний')
    features = validate_boundaries(boundaries)
    provinces = {}
    for province in source['provinces']:
        ident = province['id']
        if ident in provinces or not re.fullmatch(r'[a-z]+(?:-[a-z]+)+', ident):
            raise ValueError('Повтор или неверный ID губернии')
        if not province['label'] or type(province['within_empire']) is not bool:
            raise ValueError('Неверное описание территории')
        if province['kind'] not in ('governorate', 'oblast', 'foreign_province'):
            raise ValueError('Неизвестный тип территории')
        if province['within_empire'] == (province['kind'] == 'foreign_province'):
            raise ValueError('Иностранная провинция не является губернией Империи')
        sources_valid(province['sources'])
        if len(set(province['boundary_ids'])) != len(province['boundary_ids']):
            raise ValueError('Повтор границ территории')
        for bid in province['boundary_ids']:
            if bid not in features or ident not in features[bid]['properties']['province_ids']:
                raise ValueError('Территория не согласована со слоем границ')
        provinces[ident] = province
    for feature in features.values():
        for ident in feature['properties']['province_ids']:
            if ident not in provinces or feature['id'] not in provinces[ident]['boundary_ids']:
                raise ValueError('Несогласованная обратная привязка границы')
    assignments = {}
    for record in source['assignments']:
        pid, gid, years = record['place_id'], record['province_id'], record['valid_years']
        if pid not in places or gid not in provinces:
            raise ValueError('Неизвестный город или губерния')
        if not years or len(set(years)) != len(years) or not all(type(y) is int and 1800 <= y <= 1917 for y in years):
            raise ValueError('Требуются проверенные годы томов')
        if record['valid_from'] != min(years) or record['valid_to'] != max(years):
            raise ValueError('Границы проверенного интервала не совпадают с годами')
        sources_valid(record['sources'])
        for special in record.get('special_administration', []):
            sources_valid(special['sources'])
            if not special['valid_years'] or not set(special['valid_years']) <= set(years):
                raise ValueError('Особое управление вне проверенных лет')
        for year in years:
            key = (pid, year)
            if key in assignments:
                raise ValueError('Конфликт территориальной привязки города в одном году')
            assignments[key] = record
    return provinces, assignments


def apply(lex, places, mentions):
    lex = Path(lex)
    source = json.loads((lex / 'geography-provinces-source.json').read_text())
    path = lex / 'data/province-boundaries-1897.json'
    boundaries = json.loads(path.read_text())
    provinces, assignments = validate(source, boundaries, places)
    used = set()
    for mention in mentions:
        record = assignments.get((mention['place_id'], mention['year']))
        mention.update(province_id=None, province_note='Территориальная принадлежность не установлена.', province_sources=[])
        if record:
            used.add((mention['place_id'], mention['year']))
            special = [s for s in record.get('special_administration', []) if mention['year'] in s['valid_years']]
            note = record['note']
            for entry in special:
                note += ' ' + entry['label'] + ': ' + entry['note']
            mention.update(province_id=record['province_id'], province_note=note,
                           province_sources=record['sources'] + [s for entry in special for s in entry['sources']],
                           province_year=mention['year'], province_special_administration=special)
    if used != set(assignments):
        raise ValueError('Территориальная привязка не соответствует имеющимся годам упоминаний')
    for place in places.values():
        place['province_ids'] = sorted({m['province_id'] for m in mentions if m['place_id'] == place['id'] and m['province_id']})
    return dict(provinces=list(provinces.values()), province_method=source['method'],
                province_map=dict(file=path.name, year=1897, source_url=boundaries['source_url'],
                                  attribution=boundaries['attribution'], license=boundaries['license'],
                                  license_url=boundaries['license_url'], sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                                  feature_count=len(boundaries['features']),
                                  note='Границы: 1897 год, обзорная реконструкция RIStat/IISH. Год тома не меняет этот слой. Особые городские управления не выделены отдельными полигонами.'))
