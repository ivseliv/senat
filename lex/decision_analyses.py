#!/usr/bin/env python3
"""Редакционные разборы с закреплённой версией источника и точными цитатами.

Смещения измеряются в Unicode code points декодированного UTF-8, не в байтах
или UTF-16. Цитаты задаются целиком: границы не угадываются по точкам в
инициалах, названиях учреждений и номерах статей.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEX = ROOT / 'lex'
DATA = LEX / 'data'
SOURCE = LEX / 'decision-analyses-source.json'
OUT = DATA / 'decision-analyses.json'


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def load_texts(meta):
    result = {}
    for volume in meta['volumes']:
        year = volume['year']
        docs = [d for d in meta['decisions'] if d['vol'] == year]
        texts = read(DATA / f'text-{year}.json')
        if len(docs) != len(texts):
            raise ValueError(f'{year}: число решений и текстов различается')
        result.update((d['id'], text) for d, text in zip(docs, texts))
    return result


def evidence_record(text, quote, own_passages, manifest):
    if not isinstance(quote, str) or not quote.strip():
        raise ValueError('Пустая цитата')
    found = [m.start() for m in re.finditer(re.escape(quote), text)]
    if len(found) != 1:
        raise ValueError(f'Цитата должна встречаться ровно один раз: {quote[:100]!r}; найдено {len(found)}')
    start, end = found[0], found[0] + len(quote)
    overlaps = [p for p in own_passages if p['start'] < end and p['end'] > start]
    containing = next((p for p in overlaps if p['start'] <= start and end <= p['end']), None)
    # Пассажи перекрываются. Собираем страницы только фактической цитаты,
    # а не все страницы ближайшего пассажа и не первую страницу решения.
    sources = {}
    for passage in overlaps:
        for source in passage['sources']:
            a, b = max(start, source['start']), min(end, source['end'])
            if a < b:
                key = (source['file'], source['page'], source['page_method'])
                if key in sources:
                    sources[key]['start'] = min(sources[key]['start'], a)
                    sources[key]['end'] = max(sources[key]['end'], b)
                else:
                    sources[key] = dict(source, start=a, end=b)
    sources = sorted(sources.values(), key=lambda s: (s['start'], s['file']))
    if not sources:
        raise ValueError('Цитата не имеет привязки к исходным листам')
    cursor = start
    for source in sources:
        if text[cursor:source['start']].strip():
            raise ValueError('Часть цитаты не имеет привязки к исходным листам')
        cursor = max(cursor, source['end'])
    if text[cursor:end].strip():
        raise ValueError('Часть цитаты не имеет привязки к исходным листам')
    refs = []
    for file in dict.fromkeys(s['file'] for s in sources):
        if file not in manifest['pages']:
            raise ValueError(f'Нет страницы скана {file}')
        refs.append(dict(manifest['pages'][file], kind='page'))
    warnings = list(dict.fromkeys(p['ai']['source_warning'] for p in overlaps
                                  if p.get('ai', {}).get('source_warning')))
    return dict(text=text[start:end], start=start, end=end,
                passage_id=containing['id'] if containing else None,
                passage_ids=[p['id'] for p in overlaps], sources=sources,
                printed_pages=list(dict.fromkeys(s['page'] for s in sources if s['page'] is not None)),
                scan=refs[0], scans=refs, source_warning=' '.join(warnings) or None)


def build():
    source = read(SOURCE)
    if source['schema_version'] != 2:
        raise ValueError('Требуются полные цитаты и закреплённый SHA источника (schema_version=2)')
    meta = read(DATA / 'meta.json')
    docs = {d['id']: d for d in meta['decisions']}
    texts = load_texts(meta)
    passages, scans = {}, {}
    for year in {d['vol'] for d in meta['decisions']}:
        passages[year] = read(DATA / f'passages-{year}.json')['passages']
        scans[year] = read(DATA / f'scans-{year}.json')
    output = dict(schema_version=2, label=source['label'], method=source['method'],
                  offset_encoding='Unicode code points in UTF-8-decoded source text', decisions={}, selection=[])
    for spec in source['decisions']:
        ident = spec['id']
        if ident in output['decisions']:
            raise ValueError(f'{ident}: повтор разбора')
        doc, text = docs[ident], texts[ident]
        digest = hashlib.sha256(text.encode('utf-8')).hexdigest()
        if spec['source_sha256'] != digest:
            raise ValueError(f'{ident}: текст изменился; требуется повторная содержательная вычитка')
        own = [p for p in passages[doc['vol']] if p['decision'] == ident]
        items = []
        if len(spec['sections']) != 7:
            raise ValueError(f'{ident}: требуется семь разделов')
        for section in spec['sections']:
            if not all(section.get(k, '').strip() for k in ('heading', 'speaker', 'summary')):
                raise ValueError(f'{ident}: неполный тезис')
            if not section.get('evidence'):
                raise ValueError(f'{ident}: тезис без цитаты')
            evidence = [evidence_record(text, e['quote'], own, scans[doc['vol']]) for e in section['evidence']]
            items.append({**{k: section[k] for k in ('heading', 'speaker', 'summary')},
                          'verification': 'context_read', 'evidence': evidence})
        output['decisions'][ident] = dict(id=ident, year=doc['vol'], department=doc['dept'],
            source_sha256=digest, selection=spec['selection'], status={
                'automatic': 'Закреплённый SHA-256, уникальные полные цитаты, Unicode-смещения и страницы цитаты',
                'editorial': 'Полный текст прочитан по контексту; разбор подготовлен с помощью ИИ',
                'image': 'Использована опубликованная привязка к сканам; новая сплошная сверка изображений не проводилась'}, sections=items)
        output['selection'].append(dict(id=ident, reason=spec['selection']))
    output['count'] = len(output['decisions'])
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    obj = build()
    encoded = json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if not OUT.is_file() or OUT.read_text(encoding='utf-8') != encoded:
            raise SystemExit('decision-analyses.json устарел: запустите decision_analyses.py')
    else:
        OUT.write_text(encoded, encoding='utf-8')
    print(f'Разборы: {obj["count"]}; цитаты, версия текста и привязки проверены.')


if __name__ == '__main__':
    main()
