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


ROOT = Path(__file__).resolve().parent.parent
PUBLIC = 'https://ivseliv.github.io/senat/lex/'
API_VERSION = 'v1'
CONTRACT_VERSION = '1.0.0'


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


def schema_document():
    return {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        '$id': PUBLIC + 'api/v1/schema.json',
        'title': 'Статический API решений Правительствующего Сената, v1',
        'type': 'object',
        '$defs': {
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
                    'date': {'type': ['string', 'null']}, 'date_label': {'type': ['string', 'null']},
                    'department': {'type': 'string'}, 'headnote_original': {'type': 'string'},
                    'text_original': {'type': 'string'}, 'outcome': {'type': 'string'},
                    'url': {'type': 'string', 'format': 'uri'}, 'scan_pages': {'type': 'array'},
                },
            },
            'Passage': {
                'type': 'object',
                'required': ['id', 'decision_id', 'year', 'start', 'end', 'sha256', 'text_original', 'url'],
                'properties': {
                    'id': {'type': 'string'}, 'decision_id': {'type': 'string'}, 'year': {'type': 'integer'},
                    'start': {'type': 'integer', 'minimum': 0}, 'end': {'type': 'integer', 'minimum': 0},
                    'sha256': {'type': 'string', 'pattern': '^[0-9a-f]{64}$'},
                    'text_original': {'type': 'string'}, 'scan_refs': {'type': 'array'},
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
            '/participants/{year}.json': {'get': {'summary': 'Строки указателя за год', 'parameters': year_parameter, 'responses': response}},
            '/statutes/{act_id}.json': {'get': {'summary': 'Упоминания статей одного акта; act_id берётся из statutes/index.json', 'parameters': act_parameter, 'responses': response}},
            '/legislation/acts.json': {'get': {'summary': 'Исторические названия актов', 'responses': response}},
            '/legislation/citations/{act_id}.json': {'get': {'summary': 'Контексты ссылок на один акт; act_id берётся из statutes/index.json', 'parameters': act_parameter, 'responses': response}},
            '/scans/{year}.json': {'get': {'summary': 'Привязки к страницам и координатам', 'parameters': year_parameter, 'responses': response}},
            '/editorial/analyses.json': {'get': {'summary': 'Редакционные разборы', 'responses': response}},
            '/editorial/guides.json': {'get': {'summary': 'Тематические подборки', 'responses': response}},
            '/bulk.json': {'get': {'summary': 'Полные JSON/CSV-выгрузки', 'responses': response}},
        },
        'components': {'schemas': {'Envelope': {'$ref': './schema.json#/$defs/Envelope'}, 'Decision': {'$ref': './schema.json#/$defs/Decision'}, 'Passage': {'$ref': './schema.json#/$defs/Passage'}}},
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
    scan_refs = read_json(export / 'scan-passages.json')
    analyses = read_json(data / 'decision-analyses.json')
    guides = read_json(data / 'guides.json')
    analytics = read_json(data / 'analytics.json')
    glossary = read_json(data / 'concepts.json')
    export_manifest = read_json(export / 'manifest.json')
    revision = digest_files([export / 'manifest.json', data / 'decision-analyses.json', data / 'guides.json', data / 'analytics.json', data / 'concepts.json'])
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
    passages_by_year, participants_by_year, scans_by_year = defaultdict(list), defaultdict(list), defaultdict(list)
    statutes_by_code, citations_by_code = defaultdict(list), defaultdict(list)
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
        decision_index.append({key: row.get(key) for key in ('id', 'year', 'number', 'date', 'date_label', 'department', 'headnote_original', 'outcome', 'topics')}
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
    emit('legislation/acts.json', envelope('legislation-acts', items=acts))
    emit('editorial/analyses.json', envelope('editorial-analyses', item=analyses, links={'web': PUBLIC + '#/analyses'}))
    emit('editorial/guides.json', envelope('editorial-guides', item=guides, links={'web': PUBLIC + '#/guides'}))
    emit('analytics.json', envelope('analytics', item=analytics))
    emit('glossary.json', envelope('concepts', item=glossary))

    volumes = []
    for volume in meta['volumes']:
        year = volume['year']
        volumes.append({
            'year': year, 'department': volume['dept'], 'decisions': volume['decisions'], 'gaps': volume['gaps'],
            'links': {'decisions': href(f'decisions/{year}.json'), 'passages': href(f'passages/{year}.json'),
                      'participants': href(f'participants/{year}.json'), 'scan_passages': href(f'scans/{year}.json')},
        })
    counts = dict(export_manifest['counts'])
    counts['editorial_analyses'] = analyses['count']
    counts['guides'] = len(guides['guides'])
    coverage = {'volumes': volumes, 'counts': counts}
    emit('volumes.json', envelope('volumes', items=volumes))
    emit('corpus.json', envelope('corpus', item={
        **coverage,
        'orthography': 'Оригинальная дореформенная орфография OCR.',
        'passage_offsets': 'start/end — полуоткрытый Unicode-диапазон [start,end) в text_original.',
        'scan_geometry': 'box — [x0,y0,x1,y1] в долях ширины и высоты; при null используйте full_page_url.',
        'automated_fields': ['topics', 'outcome', 'procedure', 'participant_groups', 'statutes', 'ai_summary', 'ai_concepts'],
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
        for group in guide['groups']:
            for ident in group['decisions']:
                add_facet('guide', guide['id'], ident)

    facets = {}
    for kind, labels in sorted(facet_groups.items()):
        rows = []
        for label, ids in sorted(labels.items(), key=lambda pair: (pair[0].casefold(), pair[0])):
            facet_id = str(label) if kind in ('year', 'participant', 'guide') else stable_id(kind, label)
            ids = sorted(ids, key=lambda ident: (decision_by_id[ident]['year'], decision_by_id[ident]['number']))
            relative = f'indexes/{kind}/{facet_id}.json'
            emit(relative, {
                'api_version': API_VERSION, 'contract_version': CONTRACT_VERSION, 'data_revision': revision,
                'resource': 'decision-set', 'filter': {'kind': kind, 'id': facet_id, 'label': label},
                'count': len(ids), 'decision_ids': ids,
                'links': {'decisions': [href(f'decisions/{ident}.json') for ident in ids]},
            })
            rows.append({'id': facet_id, 'label': label, 'count': len(ids), 'href': href(relative)})
        facets[kind] = rows
    emit('facets.json', envelope('facets', item=facets))

    datasets = [
        {'id': 'decisions', 'description': 'Полные решения по годам и по постоянному ID.', 'href_template': href('decisions/{year}.json'), 'values': years, 'item_schema': 'Decision'},
        {'id': 'passages', 'description': 'Пассажи поиска и пояснения по годам.', 'href_template': href('passages/{year}.json'), 'values': years, 'item_schema': 'Passage'},
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
        'coverage': coverage, 'datasets': datasets,
        'documents': {'landing': PUBLIC + 'api/', 'documentation': PUBLIC + 'API.md', 'openapi': href('openapi.json'),
                      'schema': href('schema.json'), 'terms': href('terms.json'), 'bulk': href('bulk.json')},
        'files': file_records,
        'limitations': [
            'OCR, автоматические темы, исходы, нормы, социальные признаки и ИИ-пояснения требуют проверки по тексту и скану.',
            'participant_id обозначает строку печатного указателя, а не уникального человека или процессуальную роль.',
            'При отсутствии box нельзя реконструировать точный участок изображения: используйте full_page_url.',
            'passage_id зависит от OCR-смещений и стабилен только в пределах data_revision; decision_id является постоянным ключом корпуса.',
        ],
    }
    write_json(out, 'manifest.json', manifest)
    api_root.mkdir(parents=True, exist_ok=True)
    (api_root / 'index.html').write_text(landing_page(manifest), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    result = build_api()
    print('API:', result['contract_version'], ', '.join(f'{key}={value}' for key, value in result['coverage']['counts'].items()))
