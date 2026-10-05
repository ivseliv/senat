#!/usr/bin/env python3
"""Готовит воспроизводимый JSON/CSV-экспорт опубликованного корпуса.

Читает только уже собранные lex/data/*.json и пишет lex/export/.  Файлы
предназначены для повторного анализа без разбора клиентского индекса сайта.
"""
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'lex' / 'data'
OUT = ROOT / 'lex' / 'export'
PUBLIC = 'https://ivseliv.github.io/senat/lex/'


def read(name):
    return json.loads((DATA / name).read_text(encoding='utf-8'))


def url(path):
    return PUBLIC + path.lstrip('/')


def decision_url(decision_id):
    return PUBLIC + '#/d/' + decision_id


def passage_url(passage):
    # Режим passage открывает карточку на исходном смещении, без подстановки
    # поискового запроса и без выдачи смыслового поиска.
    return PUBLIC + f'#/d/{passage["decision"]}?mode=passage&at={passage["start"]}&end={passage["end"]}'


def compact(value):
    if value is None:
        return ''
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def write_json(name, value):
    path = OUT / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return path


def write_csv(name, rows, fields):
    path = OUT / name
    with path.open('w', encoding='utf-8', newline='') as f:
        out = csv.DictWriter(f, fieldnames=fields, lineterminator='\n')
        out.writeheader()
        for row in rows:
            out.writerow({field: compact(row.get(field)) for field in fields})
    return path


def scan_ref(ref):
    """Оставляет геометрию и публичные адреса, отбрасывая внутренние пути."""
    data = {key: ref[key] for key in ('file', 'page', 'kind', 'box', 'coverage', 'width', 'height', 'pdf_page', 'ocr_sha256') if key in ref}
    for key, output in (('image', 'image_url'), ('full', 'full_page_url')):
        if ref.get(key):
            data[output] = url(ref[key])
    return data


def build_export(root=ROOT):
    """Записывает экспорт и возвращает его манифест для тестов и сборки."""
    global ROOT, DATA, OUT
    ROOT = Path(root)
    DATA, OUT = ROOT / 'lex' / 'data', ROOT / 'lex' / 'export'
    OUT.mkdir(parents=True, exist_ok=True)

    meta = read('meta.json')
    decisions = meta['decisions']
    decision_by_id = {d['id']: d for d in decisions}
    text_by_id = {}
    passage_by_id, scans_by_year = {}, {}
    for volume in meta['volumes']:
        year = volume['year']
        docs = [d for d in decisions if d['vol'] == year]
        texts = read(f'text-{year}.json')
        if len(docs) != len(texts):
            raise ValueError(f'{year}: решения и тексты не совпадают')
        text_by_id.update({d['id']: text for d, text in zip(docs, texts)})
        passages = read(f'passages-{year}.json')['passages']
        passage_by_id.update({p['id']: p for p in passages})
        scans_by_year[year] = read(f'scans-{year}.json')

    decision_rows = []
    for d in decisions:
        scans = scans_by_year[d['vol']]
        refs = [scan_ref(scans['pages'][file]) for file in scans['decisions'].get(d['id'], [])]
        decision_rows.append({
            'id': d['id'], 'year': d['vol'], 'number': d['num'], 'date': d.get('date'),
            'date_label': d.get('date_label'), 'department': d['dept'], 'headnote_original': d['headnote'],
            'text_original': text_by_id[d['id']], 'presiding': d.get('presiding'),
            'reporter': d.get('reporter'), 'prosecutor': d.get('prosecutor'), 'outcome': d['outcome'],
            'procedure': d.get('procedure', []), 'topics': d.get('topics', []), 'participant_groups': d.get('groups', {}),
            'statutes': d.get('statutes', {}), 'cites': d.get('cites', []), 'participant_ids': d.get('participant_ids', []),
            'url': decision_url(d['id']), 'scan_pages': refs,
        })
    decision_fields = ['id', 'year', 'number', 'date', 'date_label', 'department', 'headnote_original', 'text_original',
                       'presiding', 'reporter', 'prosecutor', 'outcome', 'procedure', 'topics', 'participant_groups',
                       'statutes', 'cites', 'participant_ids', 'url', 'scan_pages']

    passage_rows, scan_rows = [], []
    for passage in sorted(passage_by_id.values(), key=lambda p: (p['doc'], p['start'])):
        decision = decision_by_id[passage['decision']]
        manifest = scans_by_year[decision['vol']]
        refs = [scan_ref(ref) for ref in manifest['passages'].get(passage['id'], [])]
        row = {
            'id': passage['id'], 'decision_id': passage['decision'], 'year': decision['vol'], 'decision_number': decision['num'],
            'start': passage['start'], 'end': passage['end'], 'words': passage['words'], 'pages': passage.get('pages', []),
            'sources': passage.get('sources', []), 'sha256': passage['sha256'],
            'text_original': text_by_id[passage['decision']][passage['start']:passage['end']],
            'ai_summary': passage.get('ai', {}).get('summary'), 'ai_concepts': passage.get('ai', {}).get('concepts', []),
            'ai_evidence_original': passage.get('ai', {}).get('evidence'), 'url': passage_url(passage), 'scan_refs': refs,
        }
        passage_rows.append(row)
        for ref in refs:
            scan_rows.append({'passage_id': passage['id'], 'decision_id': passage['decision'], 'year': decision['vol'],
                              'decision_number': decision['num'], 'passage_url': row['url'], **ref})
    passage_fields = ['id', 'decision_id', 'year', 'decision_number', 'start', 'end', 'words', 'pages', 'sources', 'sha256',
                      'text_original', 'ai_summary', 'ai_concepts', 'ai_evidence_original', 'url', 'scan_refs']
    scan_fields = ['passage_id', 'decision_id', 'year', 'decision_number', 'passage_url', 'file', 'page', 'kind', 'box',
                   'coverage', 'width', 'height', 'pdf_page', 'ocr_sha256', 'image_url', 'full_page_url']

    participant_rows = []
    for entry in meta.get('participants', []):
        sources = []
        for source in entry.get('sources', []):
            ref = dict(source)
            if source.get('image'):
                ref['full'] = source['image']
            sources.append(scan_ref(ref))
        participant_rows.append({**entry, 'decision_urls': [decision_url(d) for d in entry['decisions']], 'sources': sources})
    participant_fields = ['id', 'year', 'label', 'section', 'decisions', 'decision_urls', 'sources']

    statute_rows = []
    for d in decisions:
        for statute, mentions in sorted(d.get('statutes', {}).items()):
            code, _, article = statute.partition(' ')
            statute_rows.append({'statute': statute, 'code': code, 'article': article, 'mentions': mentions,
                                 'decision_id': d['id'], 'year': d['vol'], 'decision_number': d['num'],
                                 'decision_url': decision_url(d['id'])})
    statute_fields = ['statute', 'code', 'article', 'mentions', 'decision_id', 'year', 'decision_number', 'decision_url']

    laws = read('laws.json')
    law_act_rows = []
    for act in laws['acts']:
        law_act_rows.append({key: act.get(key) for key in ('code', 'title', 'short_title', 'aliases', 'source_ids', 'edition_note', 'citations', 'decisions', 'articles')})
    law_act_fields = ['code', 'title', 'short_title', 'aliases', 'source_ids', 'edition_note', 'citations', 'decisions', 'articles']
    law_citation_rows = [{**row,
                          'decision_url': url(row['decision_url']),
                          'passage_url': url(row['passage_url']) if row.get('passage_url') else None}
                         for row in laws['citations']]
    law_citation_fields = ['id', 'statute', 'code', 'article', 'decision_id', 'year', 'decision_number', 'start', 'end',
                           'quote_original', 'context_original', 'association', 'citation_status', 'decision_url',
                           'passage_id', 'passage_url', 'scan_available']

    files = []
    for name, value, fields in (
        ('decisions', decision_rows, decision_fields), ('passages', passage_rows, passage_fields),
        ('participants', participant_rows, participant_fields), ('statutes', statute_rows, statute_fields),
        ('legislation-acts', law_act_rows, law_act_fields), ('legislation-citations', law_citation_rows, law_citation_fields),
        ('scan-passages', scan_rows, scan_fields),
    ):
        files.extend([write_json(name + '.json', value), write_csv(name + '.csv', value, fields)])
    readme = OUT / 'README.md'
    readme.write_text("""# Экспорт корпуса решений Сената

Файлы созданы из опубликованных данных сайта и содержат только три доступных тома: 1897, 1904 и 1905 годы. JSON сохраняет вложенную структуру; CSV повторяет те же поля, а массивы и объекты записаны компактным JSON в ячейках UTF-8.

| Файл | Содержание |
|---|---|
| `decisions` | 335 решений: исходный текст, метаданные, темы, исход, статьи, участники и страницы сканов. |
| `passages` | Пассажи для понятийного поиска: Unicode-смещения в исходном тексте, текст, SHA-256, страницы, пояснения ИИ и ссылки. |
| `participants` | Строки печатных указателей, а не нормализованные люди или процессуальные роли. |
| `statutes` | Одна строка на «решение — упомянутая статья»; акт определяется автоматически и требует сверки с источником. |
| `legislation-acts` | Исторические названия и источники карточек актов, используемых в разделе «Законодательство». |
| `legislation-citations` | Буквальная ссылка OCR, контекст, пассаж, решение и признак доступного скана для привязанных актов. |
| `scan-passages` | Привязка пассажа к странице и, когда она надёжна, координатам `box` в долях ширины/высоты: `[x0,y0,x1,y1]`. |

`url`, `decision_url`, `passage_url`, `image_url` и `full_page_url` — стабильные публичные ссылки. Режим `mode=passage` открывает решение непосредственно на указанном Unicode-диапазоне. При отсутствии `box` точная геометрия не подтверждена: используйте `full_page_url` и не интерпретируйте отсутствие координат как отсутствие текста.

Текст получен автоматическим распознаванием; числа, статьи и фамилии нужно сверять с изображением. Поля `ai_*` — отдельные модельные пояснения по буквальной цитате, не юридические выводы и не часть первоисточника. Темы, исход, нормы и социальные группы тоже определяются автоматически. Полное описание ограничений — в [README сайта](../README.md).
""", encoding='utf-8')
    files.append(readme)
    manifest = {
        'version': 1, 'base_url': PUBLIC, 'volumes': meta['volumes'],
        'counts': {'decisions': len(decision_rows), 'passages': len(passage_rows), 'participants': len(participant_rows),
                   'statute_mentions': len(statute_rows), 'legislation_acts': len(law_act_rows),
                   'legislation_citations': len(law_citation_rows), 'scan_passage_refs': len(scan_rows)},
        'files': [{'name': file.name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size} for file in files],
        'notes': 'Сборка детерминирована из lex/data; даты выгрузки намеренно не записываются.',
    }
    write_json('manifest.json', manifest)
    return manifest


if __name__ == '__main__':
    result = build_export()
    print('экспорт:', ', '.join(f'{key}={value}' for key, value in result['counts'].items()))
