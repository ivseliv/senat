#!/usr/bin/env python3
"""Идентичность издания отдельно от года; прежние публичные ID сохраняются.

Сборщики пока хранят файлы по году. Поэтому apply_registry отклоняет два
публикуемых тома одного года до миграции всех зависимых ключей.
"""
import copy
import json
import re
from pathlib import Path

REGISTRY = Path(__file__).with_name('volume-registry.json')
SAFE_ID = re.compile(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*\Z')


def identifier(value, label='volume_id'):
    if not isinstance(value, str) or len(value) > 80 or not SAFE_ID.fullmatch(value):
        raise ValueError(f'{label}: требуется постоянный ASCII ID из букв, цифр и дефисов')
    return value


def volume_record(raw):
    if not isinstance(raw, dict):
        raise ValueError('Том должен быть объектом')
    row = copy.deepcopy(raw)
    identifier(row.get('volume_id'))
    identifier(row.get('department_id'), 'department_id')
    if type(row.get('year')) is not int or not 1700 <= row['year'] <= 2100:
        raise ValueError('Год тома должен быть целым числом от 1700 до 2100')
    for key in ('department', 'edition'):
        if not isinstance(row.get(key), str) or not row[key].strip() or len(row[key]) > 300 or '\0' in row[key]:
            raise ValueError(f'{key}: требуется непустое название')
    if row.get('status') not in ('published', 'staged'):
        raise ValueError('Статус тома: published или staged')
    prefix = row.get('decision_id_prefix', row['volume_id'])
    if row.get('legacy_year_key') is not None:
        if row['legacy_year_key'] != row['year'] or prefix != str(row['year']):
            raise ValueError('Прежний ключ должен совпадать с годом и префиксом решений')
    elif prefix != row['volume_id']:
        raise ValueError('Новый префикс решений должен совпадать с volume_id')
    row['decision_id_prefix'] = prefix
    return row


def load_registry(path=REGISTRY):
    raw = json.loads(Path(path).read_text(encoding='utf-8'))
    if raw.get('schema_version') != 1 or not isinstance(raw.get('volumes'), list):
        raise ValueError('Неизвестная схема реестра томов')
    rows = [volume_record(row) for row in raw['volumes']]
    for name, keys in [('volume_id', [v['volume_id'] for v in rows]),
                       ('префикс решений', [v['decision_id_prefix'] for v in rows]),
                       ('издание', [(v['year'], v['department_id'], v['edition']) for v in rows])]:
        if len(keys) != len(set(keys)):
            raise ValueError(f'Коллизия реестра: повторяется {name}')
    return {'schema_version': 1, 'volumes': rows}


def decision_id(volume, number):
    if type(number) is not int or not 1 <= number <= 999:
        raise ValueError('Номер решения должен быть от 1 до 999; расширение требует миграции контракта')
    return f'{volume_record(volume)["decision_id_prefix"]}-{number:03d}'


def apply_registry(meta, registry=None):
    """Дополнить метаданные; неоднозначность останавливает сборку до записи."""
    registry = registry or load_registry()
    rows = registry['volumes']
    result = copy.deepcopy(meta)
    years = [v['year'] for v in result['volumes']]
    if len(set(years)) != len(years):
        raise ValueError('Два тома одного года: сборщики файлов по году ещё не мигрированы на volume_id')
    registered = {}
    for volume in result['volumes']:
        matches = [r for r in rows if r['year'] == volume['year'] and r['department'] == volume['dept']
                   and (not volume.get('volume_id') or r['volume_id'] == volume['volume_id'])]
        if len(matches) != 1 or matches[0]['status'] != 'published':
            raise ValueError(f'{volume["year"]}: требуется однозначно одобренная запись published в реестре томов')
        row = matches[0]
        volume.update(volume_id=row['volume_id'], department_id=row['department_id'], edition=row['edition'],
                      decision_id_prefix=row['decision_id_prefix'])
        registered[volume['year']] = row
    seen = set()
    for doc in result['decisions']:
        row = registered.get(doc['vol'])
        if not row or doc['dept'] != row['department'] or doc['id'] != decision_id(row, doc['num']):
            raise ValueError(f'{doc.get("id")}: решение не согласовано с реестром томов')
        if doc['id'] in seen:
            raise ValueError(f'Коллизия ID решения: {doc["id"]}')
        seen.add(doc['id'])
        doc['volume_id'] = row['volume_id']
    result['volume_registry_version'] = 1
    return result


def intake_constraints(candidate, registry=None):
    """Перечислить условия до публикации; регистрация сама её не разрешает."""
    candidate = volume_record(candidate)
    rows = (registry or load_registry())['volumes']
    same = next((r for r in rows if r['volume_id'] == candidate['volume_id']), None)
    if same and any(same[k] != candidate[k] for k in ('year', 'department_id', 'department', 'edition')):
        raise ValueError('volume_id уже принадлежит другому изданию; выберите новый постоянный ID')
    duplicate = next((r for r in rows if r['volume_id'] != candidate['volume_id'] and
                      (r['year'], r['department_id'], r['edition']) ==
                      (candidate['year'], candidate['department_id'], candidate['edition'])), None)
    if duplicate:
        raise ValueError(f'Это издание уже зарегистрировано как {duplicate["volume_id"]}')
    blockers = []
    if any(r['year'] == candidate['year'] and r['volume_id'] != candidate['volume_id'] for r in rows):
        blockers.append('В реестре уже есть другой том этого года. До публикации требуется миграция всех сборщиков и URL с year на volume_id.')
    blockers.append('PDF принят только для проверки: нужны проверенные границы решений, OCR/текст, карта листов и контроль цитат; затем явное одобрение публикации.')
    return blockers
