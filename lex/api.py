#!/usr/bin/env python3
"""Строит версионированный статический API опубликованного корпуса.

GitHub Pages отдаёт только файлы. Поэтому API v1 не имитирует серверные
параметры: большие наборы разбиты по годам, а каждое решение имеет свой URL.
"""
from __future__ import annotations

import hashlib
import html
import json
import shutil
from collections import defaultdict
from pathlib import Path
from guide_comparisons import guide_decisions


ROOT = Path(__file__).resolve().parent.parent
PUBLIC = 'https://ivseliv.github.io/senat/lex/'
API_VERSION = 'v1'
CONTRACT_VERSION = '1.9.0'


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(root, relative, value):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return path


def digest_files(paths):
    """Детерминированный идентификатор содержимого входных данных."""
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda value: value.as_posix()):
        digest.update(path.name.encode('utf-8'))
        digest.update(b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
        digest.update(b'\n')
    return 'sha256:' + digest.hexdigest()


def mime_type(path):
    return 'application/json; charset=utf-8' if path.suffix == '.json' else 'application/octet-stream'


def province_boundary_path(data, geography):
    """Слой границ публикуется рядом с geography.json, вне каталога API."""
    filename = geography['province_map']['file']
    if filename != 'province-boundaries-1897.json':
        raise ValueError('API: неизвестный файл границ губерний')
    return Path(data) / filename


def api_data_revision(export, data, geography):
    """Геометрия также закреплена ревизией, хотя не копируется в api/v1."""
    export, data = Path(export), Path(data)
    return digest_files([
        export / 'manifest.json', data / 'decision-analyses.json',
        data / 'analysis-search.json', data / 'guides.json',
        data / 'topic-catalog.json', data / 'analytics.json',
        data / 'concepts.json', data / 'geography.json',
        province_boundary_path(data, geography),
    ])


def province_reference_data(data, geography):
    """Покрытие справочной карты не смешивается с числом упоминаний и дел."""
    descriptor = geography['province_map']
    path = province_boundary_path(data, geography)
    raw = path.read_bytes()
    boundaries = json.loads(raw)
    if boundaries.get('type') != 'FeatureCollection' or boundaries.get('year') != descriptor['year']:
        raise ValueError('API: тип или год слоя границ не совпадает с province_map')
    feature_ids = [feature['id'] for feature in boundaries['features']]
    if len(set(feature_ids)) != len(feature_ids):
        raise ValueError('API: повторяющиеся идентификаторы геометрии губерний')
    referenced_ids = {ident for province in geography['provinces'] for ident in province['boundary_ids']}
    if not referenced_ids <= set(feature_ids):
        raise ValueError('API: губерния ссылается на отсутствующую геометрию')
    with_geometry = sum(bool(province['boundary_ids']) for province in geography['provinces'])
    return {
        'id': 'province-boundaries-1897',
        'href': PUBLIC + 'data/' + descriptor['file'],
        'media_type': 'application/geo+json', 'year': descriptor['year'],
        'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(),
        **{key: descriptor[key] for key in ('source_url', 'attribution', 'license', 'note')},
        'coverage': {
            'boundary_features': len(feature_ids),
            'corpus_provinces': len(geography['provinces']),
            'corpus_provinces_with_geometry': with_geometry,
            'corpus_provinces_without_geometry': len(geography['provinces']) - with_geometry,
            'referenced_boundary_features': len(referenced_ids),
        },
    }


def schema_document():
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': PUBLIC + 'api/v1/schema.json',
        'title': 'Статический API решений Правительствующего Сената, v1',
        'type': 'object',
        '$defs': {
            'ProvinceSource': {
                'type': 'object', 'required': ['url', 'title', 'evidence'],
                'properties': {
                    'url': {'type': 'string', 'format': 'uri'},
                    'title': {'type': 'string', 'minLength': 1},
                    'evidence': {'type': 'string', 'minLength': 1},
                },
            },
            'Province': {
                'type': 'object',
                'required': ['id', 'label', 'kind', 'within_empire', 'boundary_ids', 'sources', 'note'],
                'properties': {
                    'id': {'type': 'string', 'minLength': 1},
                    'label': {'type': 'string', 'minLength': 1},
                    'kind': {'enum': ['governorate', 'oblast', 'foreign_province']},
                    'within_empire': {'type': 'boolean'},
                    'boundary_ids': {'type': 'array', 'uniqueItems': True, 'items': {'type': 'string', 'minLength': 1}},
                    'sources': {'type': 'array', 'minItems': 1, 'items': {'$ref': '#/$defs/ProvinceSource'}},
                    'note': {'type': 'string'},
                },
                'description': 'Редакционная территориальная группа для годов томов. boundary_ids связывает её с Feature.id справочной карты; пустой список означает отсутствие геометрии, а не отсутствие упоминаний.',
            },
            'ProvinceMap': {
                'type': 'object',
                'required': ['file', 'year', 'source_url', 'attribution', 'license', 'note'],
                'properties': {
                    'file': {'const': 'province-boundaries-1897.json'}, 'year': {'const': 1897},
                    'source_url': {'type': 'string', 'format': 'uri'},
                    'attribution': {'type': 'string', 'minLength': 1},
                    'license': {'type': 'string', 'minLength': 1}, 'note': {'type': 'string'},
                },
                'description': 'Геометрия 1897 года служит исторической справкой; фильтр года тома не изменяет её границы.',
            },
            'Geography': {
                'type': 'object',
                'required': ['schema_version', 'places', 'mentions', 'roles', 'coverage', 'provinces', 'province_map'],
                'properties': {
                    'schema_version': {'const': 1},
                    'coverage': {'type': 'object', 'required': ['complete', 'decisions', 'places', 'unresolved_mentions']},
                    'roles': {'type': 'object'},
                    'provinces': {'type': 'array', 'items': {'$ref': '#/$defs/Province'}},
                    'province_map': {'$ref': '#/$defs/ProvinceMap'},
                    'places': {'type': 'array', 'items': {'type': 'object',
                        'required': ['id', 'historical_name', 'modern_name', 'lat', 'lon', 'coordinate_source', 'coordinate_revision', 'coordinate_note', 'identity_source', 'province_ids'],
                        'properties': {'id': {'type': 'string'}, 'lat': {'type': 'number', 'minimum': -90, 'maximum': 90},
                                       'lon': {'type': 'number', 'minimum': -180, 'maximum': 180},
                                       'coordinate_revision': {'type': 'integer', 'minimum': 1},
                                       'coordinate_note': {'type': 'string', 'minLength': 1},
                                       'coordinate_source': {'type': 'string', 'format': 'uri'},
                                       'identity_source': {'type': 'string', 'format': 'uri'},
                                       'province_ids': {'type': 'array', 'uniqueItems': True, 'items': {'type': 'string'}}}}},
                    'mentions': {'type': 'array', 'items': {'type': 'object',
                        'required': ['id', 'decision_id', 'place_id', 'role', 'quote', 'start', 'end', 'mention', 'mention_start', 'mention_end', 'source_sha256', 'printed_pages', 'scans', 'province_id', 'province_note', 'province_sources'],
                        'properties': {'place_id': {'type': ['string', 'null']},
                                       'province_id': {'type': ['string', 'null'], 'description': 'Территориальная принадлежность места для года тома; null означает, что она не установлена.'},
                                       'province_note': {'type': 'string'},
                                       'province_sources': {'type': 'array', 'items': {'$ref': '#/$defs/ProvinceSource'}},
                                       'role': {'enum': ['court', 'event_property', 'person_organization', 'mention_unclear']},
                                       'source_sha256': {'type': 'string', 'pattern': '^[0-9a-f]{64}$'},
                                       'start': {'type': 'integer', 'minimum': 0}, 'end': {'type': 'integer', 'minimum': 0},
                                       'mention_start': {'type': 'integer', 'minimum': 0}, 'mention_end': {'type': 'integer', 'minimum': 0},
                                       'quote': {'type': 'string', 'minLength': 1}, 'mention': {'type': 'string', 'minLength': 1},
                                       'scans': {'type': 'array', 'minItems': 1}, 'printed_pages': {'type': 'array'},
                                       'unresolved_reason': {'type': 'string', 'minLength': 1}},
                        'allOf': [{'if': {'properties': {'place_id': {'type': 'null'}}},
                                   'then': {'required': ['unresolved_reason']}}]}},
                },
            },
            'Envelope': {
                'type': 'object',
                'required': ['api_version', 'contract_version', 'data_revision', 'resource'],
                'properties': {
                    'api_version': {'const': API_VERSION},
                    'contract_version': {'type': 'string'},
                    'data_revision': {'type': 'string', 'pattern': '^sha256:[0-9a-f]{64}$'},
                    'resource': {'type': 'string'}, 'scope': {'type': 'object'},
                    'count': {'type': 'integer', 'minimum': 0}, 'items': {'type': 'array'},
                    'item': {'type': 'object'}, 'links': {'type': 'object'},
                },
            },
            'Decision': {
                'type': 'object',
                'required': ['id', 'year', 'number', 'department', 'headnote_original', 'text_original', 'url'],
                'properties': {
                    'id': {'type': 'string', 'pattern': '^\\d{4}-\\d{3}$'},
                    'year': {'type': 'integer'}, 'number': {'type': 'integer'},
                    'volume_id': {'type': 'string'},
                    'topic_ids': {'type': 'array', 'items': {'type': 'string'}},
                    'automatic_topics': {'type': 'array', 'items': {'type': 'string'}, 'description': 'Прежние автоматические метки, сохранённые для истории; текущая классификация — topics/topic_ids.'},
                    'date': {'type': ['string', 'null']}, 'date_label': {'type': ['string', 'null']},
                    'department': {'type': 'string'}, 'headnote_original': {'type': 'string'},
                    'text_original': {'type': 'string'}, 'outcome': {'type': 'string'},
                    'url': {'type': 'string', 'format': 'uri'}, 'scan_pages': {'type': 'array'},
                    'precedents': {'type': 'array', 'items': {'$ref': '#/$defs/PrecedentReference'}},
                    'cites': {'type': 'array', 'deprecated': True, 'description': 'Старые пары год/номер без департамента. Не устанавливают тождество и не пригодны для переходов; используйте precedents.'},
                },
            },
            'PrecedentReference': {
                'type': 'object',
                'required': ['id','source_id','source_sha256','department','year','number','status','target_id','start','end','quote_original','context_original','source_url','target_url'],
                'properties': {
                    'id': {'type':'string'}, 'source_id': {'type':'string'},
                    'source_sha256': {'type':'string','pattern':'^[0-9a-f]{64}$'},
                    'department': {'type':['string','null']}, 'year': {'type':'integer'}, 'number': {'type':'integer'},
                    'status': {'type':'string','enum':['linked','not_in_corpus','department_unknown','ambiguous_target']},
                    'target_id': {'type':['string','null']}, 'target_url': {'type':['string','null'],'format':'uri'},
                    'start': {'type':'integer','minimum':0}, 'end': {'type':'integer','minimum':0},
                    'quote_original': {'type':'string'}, 'context_original': {'type':'string'},
                    'source_url': {'type':'string','format':'uri'},
                },
                'allOf': [{'if': {'properties': {'status': {'const':'linked'}}},
                           'then': {'properties': {'department': {'type':'string'}, 'target_id': {'type':'string'},'target_url': {'type':'string'}}},
                           'else': {'properties': {'target_id': {'type':'null'},'target_url': {'type':'null'}}}}],
            },
            'Passage': {
                'type': 'object',
                'required': ['id', 'decision_id', 'year', 'start', 'end', 'sha256', 'text_original', 'url'],
                'properties': {
                    'id': {'type': 'string'}, 'decision_id': {'type': 'string'}, 'year': {'type': 'integer'},
                    'start': {'type': 'integer', 'minimum': 0}, 'end': {'type': 'integer', 'minimum': 0},
                    'sha256': {'type': 'string', 'pattern': '^[0-9a-f]{64}$'},
                    'text_original': {'type': 'string'}, 'scan_refs': {'type': 'array'},
                    'source_warning': {'type': ['string', 'null'], 'description': 'Предупреждение о порядке или атрибуции OCR; пояснение такого пассажа не участвует в обогащённом поиске.'},
                    'url': {'type': 'string', 'format': 'uri'},
                },
            },
            'ScanReference': {
                'type': 'object',
                'properties': {
                    'page': {'type': ['integer', 'null']},
                    'box': {'type': ['array', 'null'], 'items': {'type': 'number', 'minimum': 0, 'maximum': 1}, 'minItems': 4, 'maxItems': 4},
                    'image_url': {'type': ['string', 'null'], 'format': 'uri'},
                    'full_page_url': {'type': ['string', 'null'], 'format': 'uri'},
                },
            },
            'EditorialEvidence': {
                'type': 'object',
                'required': ['decision', 'text', 'start', 'end', 'passage_id', 'passage_ids', 'sources', 'printed_pages', 'scans'],
                'properties': {
                    'decision': {'type': 'string', 'pattern': '^\\d{4}-\\d{3}$'},
                    'text': {'type': 'string'}, 'start': {'type': 'integer', 'minimum': 0},
                    'end': {'type': 'integer', 'minimum': 0},
                    'passage_id': {'type': ['string', 'null']},
                    'passage_ids': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1},
                    'sources': {'type': 'array', 'minItems': 1},
                    'printed_pages': {'type': 'array', 'items': {'type': 'integer'}},
                    'scans': {'type': 'array', 'minItems': 1, 'description': 'Страницы цитаты; full разрешается относительно корня lex/.'},
                    'editorial_note': {'type': 'string', 'description': 'Редакционное примечание, отдельно от буквальной цитаты.'},
                    'source_warning': {'type': ['string', 'null']},
                },
            },
            'GuideComparison': {
                'type': 'object',
                'required': ['title', 'question', 'scope', 'limits', 'label', 'verification', 'cases', 'comparisons'],
                'properties': {
                    **{key: {'type': 'string'} for key in ('title', 'question', 'scope', 'limits', 'label', 'verification')},
                    'cases': {'type': 'array', 'minItems': 2, 'items': {
                        'type': 'object', 'required': ['id', 'source_sha256', 'title', 'year', 'department', 'sections'],
                        'properties': {
                            'id': {'type': 'string'}, 'source_sha256': {'type': 'string', 'pattern': '^[0-9a-f]{64}$'},
                            'sections': {'type': 'array', 'items': {'type': 'object', 'required': ['heading', 'speaker', 'summary', 'evidence'],
                                'properties': {'evidence': {'type': 'array', 'minItems': 1, 'items': {'$ref': '#/$defs/EditorialEvidence'}}}}},
                        },
                    }},
                    'comparisons': {'type': 'array', 'minItems': 1, 'items': {
                        'type': 'object', 'required': ['heading', 'summary', 'evidence'],
                        'properties': {'evidence': {'type': 'array', 'minItems': 2, 'items': {'$ref': '#/$defs/EditorialEvidence'}}},
                    }},
                },
            },
            'LegislationCitation': {
                'type':'object',
                'required':['id','decision_id','code','article','field','start','end','quote_original','source_sha256','verification_status','evidence'],
                'properties': {
                    'verification_status':{'enum':['context_verified','legacy_unverified','act_unknown']},
                    'field':{'enum':['text','headnote']},
                    'source_sha256':{'type':'string','pattern':'^[0-9a-f]{64}$'},
                    'headnote_sha256':{'type':'string','pattern':'^[0-9a-f]{64}$'},
                    'start':{'type':'integer','minimum':0}, 'end':{'type':'integer','minimum':0},
                    'evidence':{'type':'array','items':{'type':'object','required':['kind','start','end','quote_original'],
                        'properties':{'kind':{'enum':['direct','repeat','printed_index']},'quote_original':{'type':'string'}}}},
                    'occurrences':{'type':'array'},
                },
                'description':'Единица — решение и обозначение статьи. field определяет исходное поле Unicode-смещений; SHA полного текста и заголовка закреплены отдельно. Подтверждение акта не удостоверяет номер OCR или редакцию нормы.',
            },
            'HistoricalLegislationReference': {
                'allOf': [{'$ref': '#/$defs/LegislationCitation'}],
                'type': 'object',
                'required': ['historical_note', 'current_references'],
                'properties': {
                    'historical_note': {'type': 'string'},
                    'current_references': {'type': 'array', 'items': {
                        'type': 'object', 'required': ['id', 'code', 'article', 'passage_url'],
                        'properties': {
                            **{key: {'type': 'string'} for key in ('id', 'code', 'article')},
                            'passage_url': {'type': ['string', 'null'], 'format': 'uri'},
                        },
                    }, 'description': 'Текущие записи того же решения и обозначения статьи. Список может быть пустым или содержать несколько записей; passage_url является абсолютным публичным URL.'},
                },
                'description': 'Сохранённая запись прежнего указателя: ID, исходные места и прежняя атрибуция остаются доступными. Не является текущей привязкой акта и не входит в активные счётчики, фасеты или наборы статей.',
            },
            'TopicCatalog': {
                'type': 'object',
                'required': ['schema_version', 'count', 'classified', 'topic_count', 'memberships', 'topics', 'decisions', 'unclassified'],
                'properties': {
                    'schema_version': {'const': 1},
                    **{k: {'type': 'integer', 'minimum': 0} for k in ('count','classified','topic_count','memberships')},
                    'topics': {'type': 'array', 'items': {'type': 'object', 'required': ['id','title','description','decision_ids','count','by_year']}},
                    'decisions': {'type': 'object', 'additionalProperties': {
                        'type': 'object', 'required': ['id','source_sha256','year','department','title','summary','topics'],
                        'properties': {'topics': {'type': 'array', 'items': {
                            'type': 'object', 'required': ['id','evidence'],
                            'properties': {'id': {'type':'string'}, 'evidence': {'$ref': '#/$defs/EditorialEvidence'}},
                        }}},
                    }},
                    'unclassified': {'type': 'array', 'items': {'type': 'string'}},
                },
            },
        },
        'description': 'UTF-8. Смещения start/end — полуоткрытый диапазон Unicode-кодовых точек [start,end), а не UTF-16-индексы JavaScript.',
    }


def openapi_document(years, act_ids):
    response = {'200': {'description': 'JSON UTF-8', 'content': {'application/json': {'schema': {'$ref': './schema.json#/$defs/Envelope'}}}}}
    year_parameter = [{'name': 'year', 'in': 'path', 'required': True, 'schema': {'type': 'integer', 'enum': years}}]
    act_parameter = [{'name': 'act_id', 'in': 'path', 'required': True, 'schema': {'type': 'string', 'enum': act_ids}}]
    return {
        'openapi': '3.1.0',
        'info': {'title': 'Решения Правительствующего Сената — Static API', 'version': CONTRACT_VERSION,
                 'description': 'Статические JSON-файлы: доступны GET и HEAD, query-параметров и серверного поиска нет.'},
        'servers': [{'url': PUBLIC + 'api/v1'}],
        'paths': {
            '/manifest.json': {'get': {'summary': 'Точка входа и контрольные суммы', 'responses': response}},
            '/corpus.json': {'get': {'summary': 'Покрытие корпуса и ограничения', 'responses': response}},
            '/decisions/index.json': {'get': {'summary': 'Компактный указатель решений', 'responses': response}},
            '/decisions/{year}.json': {'get': {'summary': 'Полные решения за год', 'parameters': year_parameter, 'responses': response}},
            '/decisions/{id}.json': {'get': {'summary': 'Решение по постоянному ID', 'parameters': [{'name': 'id', 'in': 'path', 'required': True, 'schema': {'type': 'string', 'pattern': '^\\d{4}-\\d{3}$'}}], 'responses': response}},
            '/passages/{year}.json': {'get': {'summary': 'Пассажи и пояснения за год', 'parameters': year_parameter, 'responses': response}},
            '/precedents/{year}.json': {'get': {'summary': 'Ссылки на прежние решения с департаментом и буквальным контекстом', 'parameters': year_parameter, 'responses': response}},
            '/participants/{year}.json': {'get': {'summary': 'Строки указателя за год', 'parameters': year_parameter, 'responses': response}},
            '/statutes/{act_id}.json': {'get': {'summary': 'Упоминания статей одного акта; act_id берётся из statutes/index.json', 'parameters': act_parameter, 'responses': response}},
            '/legislation/unresolved.json': {'get': {'summary': 'Неустановленные акты: буквальный контекст и точные места', 'responses': response}},
            '/legislation/historical-references.json': {'get': {'summary': 'Сохранённые ссылки прежних версий вне текущих подсчётов', 'responses': response}},
            '/legislation/attribution.json': {'get': {'summary': 'Покрытие и единица счёта атрибуции актов', 'responses': response}},
            '/legislation/acts.json': {'get': {'summary': 'Исторические названия актов', 'responses': response}},
            '/legislation/citations/{act_id}.json': {'get': {'summary': 'Контексты ссылок на один акт; act_id берётся из statutes/index.json', 'parameters': act_parameter, 'responses': response}},
            '/scans/{year}.json': {'get': {'summary': 'Привязки к страницам и координатам', 'parameters': year_parameter, 'responses': response}},
            '/editorial/analyses.json': {'get': {'summary': 'Редакционные разборы', 'responses': response}},
            '/editorial/analysis-search.json': {'get': {'summary': 'Разделы разборов с видами, авторами и цитатами для поиска', 'responses': response}},
            '/volumes.json': {'get': {'summary': 'Реестр опубликованных томов с постоянными volume_id', 'responses': response}},
            '/editorial/guides.json': {'get': {'summary': 'Тематические подборки и сравнительные разборы', 'responses': response}},
            '/editorial/topics.json': {'get': {'summary': 'Каталог тем с подтверждёнными цитатами включениями решений', 'responses': response}},
        '/editorial/geography.json': {'get': {'summary': 'Выборочная география: населённые пункты, губернии, роли и источники',
            'description': 'item.provinces и упоминания содержат историческую территориальную атрибуцию; links.boundaryGeoJSON ведёт к отдельной справочной геометрии 1897 года. Её источник, лицензия, SHA-256 и покрытие опубликованы в manifest.reference_data.', 'responses': response}},
            '/bulk.json': {'get': {'summary': 'Полные JSON/CSV-выгрузки', 'responses': response}},
        },
        'components': {'schemas': {'Envelope': {'$ref': './schema.json#/$defs/Envelope'}, 'Decision': {'$ref': './schema.json#/$defs/Decision'}, 'Passage': {'$ref': './schema.json#/$defs/Passage'}, 'PrecedentReference': {'$ref':'./schema.json#/$defs/PrecedentReference'}}},
    }


def landing_page(manifest):
    counts = manifest['coverage']['counts']
    version = html.escape(manifest['contract_version'])
    revision = html.escape(manifest['data_revision'])
    return '\n'.join([
        '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>API корпуса решений Сената</title>',
        '<style>body{max-width:850px;margin:40px auto;padding:0 18px;font:17px/1.55 system-ui,sans-serif;color:#242424}code,pre{background:#f3f3f1;border-radius:5px;padding:2px 5px}pre{padding:14px;overflow:auto}a{color:#1261a0}.note{border-left:4px solid #b56a27;padding:10px 14px;background:#fff8ef}table{border-collapse:collapse}td,th{padding:6px 12px;border-bottom:1px solid #ddd;text-align:left}</style>',
        '<h1>Статический API корпуса решений Сената</h1>',
        f'<p>Версия контракта <code>{version}</code>. Это набор проверяемых JSON-файлов без ключа, сервера и платных сервисов.</p>',
        '<p><a href="../#/api">Страница API в интерфейсе</a> · <a href="v1/manifest.json">манифест v1</a> · <a href="v1/openapi.json">OpenAPI 3.1</a> · <a href="v1/schema.json">JSON Schema</a> · <a href="../API.md">документация</a></p>',
        f'<table><tr><th>Решений</th><th>Пассажей</th><th>Указатель</th></tr><tr><td>{counts["decisions"]}</td><td>{counts["passages"]}</td><td>{counts["participants"]}</td></tr></table>',
        f'<h2>Быстрый старт</h2><pre>curl -L {PUBLIC}api/v1/manifest.json\ncurl -L {PUBLIC}api/v1/decisions/1904.json</pre>',
        f'<p>Например, <a href="v1/decisions/1904-042.json">решение 1904-042</a>. Для проверки снимка сохраняйте <code>data_revision</code>: <code>{revision}</code>.</p>',
        '<p class="note">Это статический API: <code>?year=1904</code> не выполняется на сервере. Берите годовой файл или полную выгрузку и фильтруйте у себя.</p>',
        '<h2>Ограничения</h2><p>Тексты — OCR в дореформенной орфографии. Темы, исходы, нормы, социальные признаки и ИИ-пояснения требуют сверки с первоисточником и сканом. Смещения пассажей — Unicode-диапазоны <code>[start,end)</code>, не индексы UTF-16.</p>',
        '<p>Условия использования и рекомендуемое цитирование: <a href="v1/terms.json">terms.json</a>. Лицензия на данные и изображения специально не подразумевается.</p></html>',
    ]) + '\n'


def stable_id(prefix, value):
    """ASCII-идентификатор фасета; подпись хранится отдельно и может меняться."""
    return prefix + '-' + hashlib.sha256(value.encode('utf-8')).hexdigest()[:12]


def build_api(root=ROOT):
    """Собирает api/v1 из опубликованных данных и возвращает его manifest."""
    root = Path(root)
    lex, data, export = root / 'lex', root / 'lex' / 'data', root / 'lex' / 'export'
    api_root, out = lex / 'api', lex / 'api' / API_VERSION
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    meta = read_json(data / 'meta.json')
    decisions = read_json(export / 'decisions.json')
    passages = read_json(export / 'passages.json')
    participants = read_json(export / 'participants.json')
    statutes = read_json(export / 'statutes.json')
    acts = read_json(export / 'legislation-acts.json')
    citations = read_json(export / 'legislation-citations.json')
    unresolved = read_json(export / 'legislation-unresolved.json')
    historical_references = read_json(export / 'legislation-historical-references.json')
    law_index = read_json(data / 'laws.json')
    scan_refs = read_json(export / 'scan-passages.json')
    precedents = read_json(export / 'precedents.json')
    analyses = read_json(data / 'decision-analyses.json')
    analysis_search = read_json(data / 'analysis-search.json')
    guides = read_json(data / 'guides.json')
    catalog = read_json(data / 'topic-catalog.json')
    geography = read_json(data / 'geography.json')
    analytics = read_json(data / 'analytics.json')
    glossary = read_json(data / 'concepts.json')
    export_manifest = read_json(export / 'manifest.json')
    reference_data = [province_reference_data(data, geography)]
    revision = api_data_revision(export, data, geography)
    years = [volume['year'] for volume in meta['volumes']]
    codes = [act['code'] for act in acts]

    def href(relative):
        return PUBLIC + 'api/' + API_VERSION + '/' + relative

    def envelope(resource, *, scope=None, items=None, item=None, links=None):
        result = {'api_version': API_VERSION, 'contract_version': CONTRACT_VERSION, 'data_revision': revision, 'resource': resource}
        if scope:
            result['scope'] = scope
        if items is not None:
            result['count'] = len(items)
            result['items'] = items
        if item is not None:
            result['item'] = item
        if links:
            result['links'] = links
        return result

    output_files = []
    def emit(relative, value):
        path = write_json(out, relative, value)
        output_files.append(path)
        return path

    decision_by_id = {row['id']: row for row in decisions}
    if len(decision_by_id) != len(decisions):
        raise ValueError('API: повторяющиеся идентификаторы решений')
    passages_by_year, participants_by_year, scans_by_year = defaultdict(list), defaultdict(list), defaultdict(list)
    statutes_by_code, citations_by_code = defaultdict(list), defaultdict(list)
    precedents_by_year = defaultdict(list)
    for row in precedents:
        precedents_by_year[row['source_year']].append(row)
    for row in passages:
        passages_by_year[row['year']].append(row)
    for row in participants:
        participants_by_year[row['year']].append(row)
    for row in scan_refs:
        scans_by_year[row['year']].append(row)
    for row in statutes:
        statutes_by_code[row['code']].append(row)
    for row in citations:
        citations_by_code[row['code']].append(row)

    passage_ids = defaultdict(list)
    for row in passages:
        passage_ids[row['decision_id']].append(row['id'])
    for ident in passage_ids:
        passage_ids[ident].sort(key=lambda value: int(value.rsplit(':', 1)[1].split('-', 1)[0]))

    decision_index = []
    for row in decisions:
        decision_index.append({key: row.get(key) for key in ('id', 'year', 'volume_id', 'number', 'date', 'date_label', 'department', 'headnote_original', 'outcome', 'topics', 'topic_ids')}
                              | {'href': href(f'decisions/{row["id"]}.json'), 'web_url': row['url']})
    decision_index.sort(key=lambda row: (row['year'], row['number']))
    emit('decisions/index.json', envelope('decision-index', items=decision_index))
    for year in years:
        records = [row for row in decisions if row['year'] == year]
        emit(f'decisions/{year}.json', envelope('decisions', scope={'year': year}, items=records,
             links={'index': href('decisions/index.json')}))
    for ident, row in decision_by_id.items():
        detail = dict(row)
        detail['api_url'] = href(f'decisions/{ident}.json')
        detail['text_sha256'] = hashlib.sha256(row['text_original'].encode('utf-8')).hexdigest()
        detail['passage_ids'] = passage_ids[ident]
        detail['passages_url'] = href(f'passages/{row["year"]}.json')
        emit(f'decisions/{ident}.json', envelope('decision', scope={'id': ident, 'year': row['year']}, item=detail,
             links={'web': row['url']}))

    for year in years:
        emit(f'passages/{year}.json', envelope('passages', scope={'year': year}, items=passages_by_year[year],
             links={'decisions': href(f'decisions/{year}.json')}))
        emit(f'precedents/{year}.json', envelope('precedents', scope={'year':year}, items=precedents_by_year[year]))
        emit(f'participants/{year}.json', envelope('participants', scope={'year': year}, items=participants_by_year[year]))
        emit(f'scans/{year}.json', envelope('scan-passages', scope={'year': year}, items=scans_by_year[year],
             links={'passages': href(f'passages/{year}.json')}))

    statute_index = []
    for code in codes:
        code_id = stable_id('act', code)
        statute_index.append({'id': code_id, 'code': code, 'mentions': len(statutes_by_code[code]), 'href': href(f'statutes/{code_id}.json')})
        emit(f'statutes/{code_id}.json', envelope('statutes', scope={'code': code, 'id': code_id}, items=statutes_by_code[code]))
        emit(f'legislation/citations/{code_id}.json', envelope('legislation-citations', scope={'code': code, 'id': code_id}, items=citations_by_code[code]))
    unknown_codes = sorted(set(statutes_by_code) - set(codes))
    for code in unknown_codes:
        code_id = stable_id('act', code)
        statute_index.append({'id': code_id, 'code': code, 'mentions': len(statutes_by_code[code]), 'href': href(f'statutes/{code_id}.json')})
        emit(f'statutes/{code_id}.json', envelope('statutes', scope={'code': code, 'id': code_id}, items=statutes_by_code[code]))
    emit('statutes/index.json', envelope('statute-index', items=sorted(statute_index, key=lambda row: row['code'])))
    emit('legislation/unresolved.json', envelope('legislation-unresolved', items=unresolved))
    emit('legislation/historical-references.json', envelope('legislation-historical-references', items=historical_references))
    emit('legislation/attribution.json', envelope('legislation-attribution', item=law_index['attribution_summary']))
    emit('legislation/acts.json', envelope('legislation-acts', items=acts))
    emit('editorial/analyses.json', envelope('editorial-analyses', item=analyses, links={'web': PUBLIC + '#/analyses'}))
    emit('editorial/analysis-search.json', envelope('analysis-search', item=analysis_search, links={'web': PUBLIC + '#/analyses'}))
    emit('editorial/guides.json', envelope('editorial-guides', item=guides, links={'web': PUBLIC + '#/guides'}))
    emit('editorial/topics.json', envelope('topic-catalog', item=catalog, links={'web': PUBLIC + '#/guides'}))
    emit('editorial/geography.json', envelope('geography', item=geography, links={
        'web': PUBLIC + '#/places', 'geojson': PUBLIC + 'data/geography.geojson',
        'boundaryGeoJSON': reference_data[0]['href'],
        'boundarySource': reference_data[0]['source_url'],
    }))
    emit('analytics.json', envelope('analytics', item=analytics))
    emit('glossary.json', envelope('concepts', item=glossary))

    volumes = []
    for volume in meta['volumes']:
        year = volume['year']
        volumes.append({
            'volume_id': volume['volume_id'], 'department_id': volume['department_id'],
            'edition': volume['edition'], 'decision_id_prefix': volume['decision_id_prefix'],
            'year': year, 'department': volume['dept'], 'decisions': volume['decisions'], 'gaps': volume['gaps'],
            'links': {'decisions': href(f'decisions/{year}.json'), 'passages': href(f'passages/{year}.json'),
                      'participants': href(f'participants/{year}.json'), 'scan_passages': href(f'scans/{year}.json')},
        })
    counts = dict(export_manifest['counts'])
    counts['editorial_analyses'] = analyses['count']
    counts['geography_places'] = geography['coverage']['places']
    counts['geography_decisions'] = geography['coverage']['decisions']
    counts['geography_provinces'] = len(geography['provinces'])
    counts['geography_province_mentions'] = sum(mention['province_id'] is not None for mention in geography['mentions'])
    counts['geography_province_unresolved_mentions'] = sum(mention['province_id'] is None for mention in geography['mentions'])
    counts['passage_source_warnings'] = sum(bool(p.get('source_warning')) for p in passages)
    counts['guides'] = len(guides['guides'])
    counts['guide_comparisons'] = guides.get('comparison_count', 0)
    counts['guide_comparison_decisions'] = len({c['id'] for g in guides['guides'] for c in g.get('comparison', {}).get('cases', [])})
    counts['catalog_topics'] = catalog['topic_count']
    counts['catalog_decisions'] = catalog['count']
    counts['catalog_classified'] = catalog['classified']
    counts['catalog_memberships'] = catalog['memberships']
    coverage = {'volumes': volumes, 'counts': counts}
    emit('volumes.json', envelope('volumes', items=volumes))
    emit('corpus.json', envelope('corpus', item={
        **coverage,
        'reference_data': reference_data,
        'orthography': 'Оригинальная дореформенная орфография OCR.',
        'passage_offsets': 'start/end — полуоткрытый Unicode-диапазон [start,end) в text_original.',
        'scan_geometry': 'box — [x0,y0,x1,y1] в долях ширины и высоты; при null используйте full_page_url.',
        'automated_fields': ['automatic_topics', 'outcome', 'procedure', 'participant_groups', 'statutes', 'ai_summary', 'ai_concepts'],
        'topics': 'topics и topic_ids используют единый редакционный каталог с цитатами; прежние автоматические метки сохранены в automatic_topics. Полнота юридической квалификации не гарантируется.',
        'analysis_search': 'Редакционные разделы различают вопрос, доводы, предшествующее рассмотрение, рассуждение, постановление и пределы. Вид раздела не превращает редакционный пересказ в текст Сената; проверяйте evidence и полный источник.',
        'precedents': 'Переход устанавливается только по департаменту, году и номеру; неопределённые ссылки сохранены с контекстом без target_id. Старые пары cites не пригодны для переходов.',
        'historical_legislation_references': 'legislation/historical-references.json сохраняет записи предыдущих версий с прежними ID и местами. Они исключены из текущих ссылок и фасетов; отдельный счётчик legislation_historical_references считает только сохранённые записи.',
        'source_warning': 'Непустая строка у пассажа сообщает об установленном дефекте порядка или атрибуции OCR. Его пояснение не индексируется в обогащённом поиске; исходный текст сохранён.',
        'guide_comparisons': 'Редакционные сопоставления выбранных дел: закреплённые SHA полных текстов и буквальные цитаты со страницами. Не являются независимой юридической экспертизой или доказательством развития практики.',
        'geography': 'Выборочные упоминания мест сгруппированы по территориальной принадлежности для года тома; особое управление поясняется отдельно. Роль court не означает место событий или территорию юрисдикции. Справочные границы относятся к 1897 году и не меняются с фильтром года; отсутствие геометрии не означает отсутствие упоминаний.',
    }))
    emit('bulk.json', envelope('bulk-downloads', item={
        'description': 'Полные JSON/CSV-выгрузки; имена, контрольные суммы и размеры определяет export/manifest.json.',
        'manifest': PUBLIC + 'export/manifest.json', 'readme': PUBLIC + 'export/README.md',
        'files': [{**entry, 'href': PUBLIC + 'export/' + entry['name']} for entry in export_manifest['files']],
    }))
    emit('terms.json', envelope('terms', item={
        'access': 'Файлы публикуются без ключа для чтения и исследовательского использования.',
        'license': None,
        'rights_notice': 'Репозиторий не заявляет лицензию на тексты, OCR, метаданные или изображения. Перед повторным распространением и коммерческим использованием проверьте права на каждый вид материала.',
        'reference_data': [{'id': row['id'], **{key: row[key] for key in ('source_url', 'license', 'attribution')}} for row in reference_data],
        'citation': f'Решения Правительствующего Сената, Static API v1, data_revision {revision}; URL ресурса; дата обращения.',
        'compatibility': 'В v1 добавляются только новые поля и файлы. Несовместимый контракт будет опубликован в новом пути /api/v2/.',
    }))
    emit('schema.json', schema_document())
    emit('openapi.json', openapi_document(years, [row['id'] for row in statute_index]))

    facet_groups = defaultdict(lambda: defaultdict(set))
    def add_facet(kind, label, decision_id):
        if label not in (None, ''):
            facet_groups[kind][str(label)].add(decision_id)
    for row in decisions:
        ident = row['id']
        add_facet('year', row['year'], ident)
        add_facet('outcome', row.get('outcome'), ident)
        for field, kind in (('topics', 'topic'), ('procedure', 'procedure')):
            for label in row.get(field, []):
                add_facet(kind, label, ident)
        for code in row.get('statutes', {}):
            add_facet('act', code.split(' ', 1)[0], ident)
            add_facet('article', code, ident)
        for field, kind in (('presiding', 'presiding'), ('reporter', 'reporter'), ('prosecutor', 'prosecutor')):
            add_facet(kind, row.get(field), ident)
    for row in participants:
        for ident in row['decisions']:
            add_facet('participant', row['id'], ident)
    for guide in guides['guides']:
        for ident in guide_decisions(guide):
            add_facet('guide', guide['id'], ident)
    for topic in catalog['topics']:
        for ident in topic['decision_ids']:
            add_facet('catalog-topic', topic['id'], ident)
    # Сохраняем прежние URL фильтров тем с текущим редакционным составом.
    from topic_navigation import LEGACY_TOPICS
    topics_by_id = {topic['id']: topic for topic in catalog['topics']}
    for old_title, topic_id in LEGACY_TOPICS.items():
        facet_groups['topic'][old_title].update(topics_by_id[topic_id]['decision_ids'])

    # Historical facet URLs remain valid after correcting an act association.
    # Empty sets are explicit; their former, incorrect memberships are not kept.
    attribution_base=read_json(lex/'law-attributions-source.json')
    for baseline in attribution_base['decisions'].values():
        for statute in baseline['statutes']:
            facet_groups['article'][statute]
            facet_groups['act'][statute.split(' ',1)[0]]

    facets = {}
    for kind, labels in sorted(facet_groups.items()):
        rows = []
        for label, ids in sorted(labels.items(), key=lambda pair: (pair[0].casefold(), pair[0])):
            facet_id = str(label) if kind in ('year', 'participant', 'guide', 'catalog-topic') else stable_id(kind, label)
            ids = sorted(ids, key=lambda ident: (decision_by_id[ident]['year'], decision_by_id[ident]['number']))
            relative = f'indexes/{kind}/{facet_id}.json'
            emit(relative, {
                'api_version': API_VERSION, 'contract_version': CONTRACT_VERSION, 'data_revision': revision,
                'resource': 'decision-set', 'filter': {'kind': kind, 'id': facet_id, 'label': label},
                'count': len(ids), 'decision_ids': ids,
                'links': {'decisions': [href(f'decisions/{ident}.json') for ident in ids]},
                **({'status':'no_current_matches','note':'Прежний URL фасета сохранён; после сверки актов текущих совпадений нет.'} if not ids else {}),
            })
            rows.append({'id': facet_id, 'label': label, 'count': len(ids), 'href': href(relative)})
        facets[kind] = rows
    emit('facets.json', envelope('facets', item=facets))

    datasets = [
        {'id':'volume-registry','description':'Постоянные ID опубликованных томов, департаменты и издания; старые ID решений сохранены.','href':href('volumes.json')},
        {'id':'analysis-search','description':'Разделы редакционных разборов: вид, автор, современное пояснение и буквальные цитаты со смещениями.','href':href('editorial/analysis-search.json')},
        {'id':'geography','description':'Выборочные упоминания населённых пунктов с ролями, цитатами, координатами и территориальной атрибуцией; отдельный справочный слой границ 1897 года.','href':href('editorial/geography.json'),'item_schema':'Geography'},
        {'id':'legislation-unresolved','description':'Ссылки без установленного акта: контекст, Unicode-смещения, SHA источника.','href':href('legislation/unresolved.json'),'item_schema':'LegislationCitation'},
        {'id':'legislation-historical-references','description':'Записи прежних версий с исходными ID, местами и пометкой historical_note; вне текущих подсчётов.','href':href('legislation/historical-references.json'),'item_schema':'HistoricalLegislationReference'},
        {'id':'legislation-attribution','description':'Результат сверки актов, единица счёта и остаток неопределённых ссылок.','href':href('legislation/attribution.json')},
        {'id': 'topic-catalog', 'description': 'Редакционный каталог всех решений с современными пояснениями и цитатами тематических включений.', 'href': href('editorial/topics.json'), 'item_schema': 'TopicCatalog'},
        {'id': 'decisions', 'description': 'Полные решения по годам и по постоянному ID.', 'href_template': href('decisions/{year}.json'), 'values': years, 'item_schema': 'Decision'},
        {'id': 'passages', 'description': 'Пассажи поиска и пояснения по годам.', 'href_template': href('passages/{year}.json'), 'values': years, 'item_schema': 'Passage'},
        {'id':'precedents','description':'Ссылки на прежние решения с подтверждающей цитатой и статусом привязки.','href_template':href('precedents/{year}.json'),'values':years,'item_schema':'PrecedentReference'},
        {'id': 'participants', 'description': 'Строки печатного указателя, а не нормализованные люди.', 'href_template': href('participants/{year}.json'), 'values': years},
        {'id': 'scans', 'description': 'Связи пассажей со страницами и координатами.', 'href_template': href('scans/{year}.json'), 'values': years, 'item_schema': 'ScanReference'},
        {'id': 'statutes', 'description': 'Упоминания статей, раздельно по историческому акту.', 'href_template': href('statutes/{act_id}.json'), 'values': [row['id'] for row in statute_index]},
        {'id': 'indexes', 'description': 'Материализованные фильтры по годам, темам, исходам, процедуре, актам, статьям, участникам, должностным лицам и тематическим подборкам.', 'href': href('facets.json')},
    ]
    file_records = []
    for path in sorted(output_files, key=lambda value: value.relative_to(out).as_posix()):
        relative = path.relative_to(out).as_posix()
        file_records.append({'path': relative, 'href': href(relative), 'bytes': path.stat().st_size,
                             'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'media_type': mime_type(path)})
    manifest = {
        'api_version': API_VERSION, 'contract_version': CONTRACT_VERSION, 'data_revision': revision,
        'base_url': PUBLIC + 'api/' + API_VERSION + '/',
        'method': 'Статический API: GET/HEAD файлов JSON UTF-8; ключ, авторизация и серверные query-параметры отсутствуют.',
        'compatibility': 'В v1 новые поля и файлы добавляются без удаления существующих. Несовместимые изменения получают новый путь /api/v2/.',
        'coverage': coverage, 'datasets': datasets, 'reference_data': reference_data,
        'documents': {'landing': PUBLIC + 'api/', 'documentation': PUBLIC + 'API.md', 'openapi': href('openapi.json'),
                      'schema': href('schema.json'), 'terms': href('terms.json'), 'bulk': href('bulk.json')},
        'files': file_records,
        'limitations': [
            'OCR, автоматические темы, исходы, нормы, социальные признаки и ИИ-пояснения требуют проверки по тексту и скану.',
            'participant_id обозначает строку печатного указателя, а не уникального человека или процессуальную роль.',
            'При отсутствии box нельзя реконструировать точный участок изображения: используйте full_page_url.',
            'passage_id зависит от OCR-смещений и стабилен только в пределах data_revision; decision_id является постоянным ключом корпуса.',
            'Старое поле cites содержит неполные пары год/номер. Для связей используйте precedents: department + year + number и status=linked.',
            'Географическое покрытие выборочное. Губерния упоминания не устанавливает место событий; справочная карта 1897 года не представляет границы на каждый год тома.',
        ],
    }
    write_json(out, 'manifest.json', manifest)
    api_root.mkdir(parents=True, exist_ok=True)
    (api_root / 'index.html').write_text(landing_page(manifest), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    result = build_api()
    print('API:', result['contract_version'], ', '.join(f'{key}={value}' for key, value in result['coverage']['counts'].items()))
