#!/usr/bin/env python3
"""Проверяемая редакционная надстройка над прежним извлечением статей.

Не классифицирует статьи по их номеру. Замороженные решения хранят SHA текста,
исходный счётчик и буквальные основания каждого переноса. Сборка не принимает
устаревшие смещения и не наращивает счётчики при повторном запуске.
"""
import collections
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = 'law-attributions-source.json'


def sha(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def statute_digest(statutes):
    return sha(json.dumps(statutes, ensure_ascii=False, sort_keys=True, separators=(',', ':')))


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def texts_by_id(root, meta):
    out = {}
    for volume in meta['volumes']:
        docs = [d for d in meta['decisions'] if d['vol'] == volume['year']]
        texts = read(root/'lex/data'/f'text-{volume["year"]}.json')
        if len(docs) != len(texts):
            raise ValueError('Число текстов не совпадает с метаданными')
        out.update(zip([d['id'] for d in docs], texts))
    return out


def check_quote(text, item):
    start, end = item['start'], item['end']
    if not isinstance(start, int) or not isinstance(end, int) or not 0 <= start < end <= len(text):
        raise ValueError('Неверный диапазон законодательной ссылки')
    if text[start:end] != item['quote_original']:
        raise ValueError('Буквальная законодательная цитата изменилась')


def check_proof(root, fields, proof, code):
    if proof['act_code'] != code:
        raise ValueError('Основание относится к другому акту')
    if proof['kind'] in ('direct', 'repeat'):
        if proof['field'] not in fields:
            raise ValueError('Неизвестное поле основания')
        check_quote(fields[proof['field']], proof)
    elif proof['kind'] == 'printed_index':
        relative = Path(proof['path'])
        if relative.parts[:1] != ('legislation-indexes',) or '..' in relative.parts or relative.suffix != '.txt':
            raise ValueError('Неизвестный источник печатного указателя')
        index = (Path(root)/'lex'/relative).read_text(encoding='utf-8')
        if sha(index) != proof['source_sha256']:
            raise ValueError('Печатный указатель изменился')
        check_quote(index, proof)
        check_quote(index, proof['heading'])
        edition = proof.get('edition_continuation')
        if edition:
            check_quote(index, dict(edition, quote_original=edition.get('quote_original', edition.get('quote'))))
    else:
        raise ValueError('Неизвестный способ привязки')


def apply_attributions(root=ROOT):
    root = Path(root)
    source = read(root/'lex'/SOURCE)
    if source.get('schema_version') != 1:
        raise ValueError('Неизвестная версия законодательной сверки')
    meta = read(root/'lex/data/meta.json')
    texts = texts_by_id(root, meta)
    acts = {a['code'] for a in read(root/'lex/laws.json')['acts']}
    by_doc = collections.defaultdict(list)
    for row in source['resolutions']:
        by_doc[row['decision_id']].append(row)
    if set(source['decisions']) != set(texts):
        raise ValueError('Набор решений законодательной сверки изменился')
    seen = set()
    for doc in meta['decisions']:
        ident = doc['id']; base = source['decisions'][ident]
        if sha(texts[ident]) != base['text_sha256'] or sha(doc['headnote']) != base['headnote_sha256']:
            raise ValueError('Устаревшая законодательная сверка: ' + ident)
        projected = collections.Counter(base['statutes'])
        for row in by_doc[ident]:
            key = (ident, row['from_statute'])
            if key in seen:
                raise ValueError('Повтор законодательной привязки')
            seen.add(key)
            if base['statutes'].get(row['from_statute']) != row['mentions']:
                raise ValueError('Исходный счётчик законодательной ссылки изменился')
            if sum(t['mentions'] for t in row['targets']) != row['mentions']:
                raise ValueError('Перенос теряет исходные упоминания')
            projected[row['from_statute']] -= row['mentions']
            for target in row['targets']:
                if target['code'] not in acts or len(target['occurrences']) != target['mentions']:
                    raise ValueError('Неполное основание привязки к акту')
                for occurrence in target['occurrences']:
                    field = occurrence['field']
                    if field not in ('text', 'headnote'):
                        raise ValueError('Неизвестное поле источника')
                    check_quote(texts[ident] if field == 'text' else doc['headnote'], occurrence)
                    if not occurrence['evidence']:
                        raise ValueError('Нет основания привязки')
                    for proof in occurrence['evidence']:
                        check_proof(root, {'text':texts[ident], 'headnote':doc['headnote']}, proof, target['code'])
                _, _, article = row['from_statute'].partition(' ')
                projected[f'{target["code"]} {article}'] += target['mentions']
        projected = {key:count for key,count in projected.items() if count}
        if any(count < 0 for count in projected.values()) or sum(projected.values()) != sum(base['statutes'].values()):
            raise ValueError('Перенос изменил суммарное число извлечённых упоминаний')
        previous = source.get('previous_projection_sha256', {}).get(ident, [])
        if doc['statutes'] not in (base['statutes'], projected) and statute_digest(doc['statutes']) not in previous:
            raise ValueError('Несогласованные метаданные законодательной сверки: ' + ident)
        doc['statutes'] = projected
    if set(by_doc) - set(texts):
        raise ValueError('Привязка к отсутствующему решению')
    unresolved = source.get('unresolved',[])
    expected={(d['id'],key):count for d in meta['decisions'] for key,count in d['statutes'].items() if key.startswith('? ')}
    actual={(r['decision_id'],r['statute']):r['mentions'] for r in unresolved}
    if actual != expected or len(unresolved) != len(actual):
        raise ValueError('Неполный или дублированный список неопределённых ссылок')
    docs={d['id']:d for d in meta['decisions']}
    for row in unresolved:
        if len(row['occurrences']) != row['mentions']:
            raise ValueError('Неполный список мест неопределённой ссылки')
        for occurrence in row['occurrences']:
            if occurrence['field'] not in ('text','headnote'):
                raise ValueError('Неизвестное поле неопределённой ссылки')
            text=texts[row['decision_id']] if occurrence['field']=='text' else docs[row['decision_id']]['headnote']
            check_quote(text,occurrence)
    (root/'lex/data/meta.json').write_text(json.dumps(meta, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    analytics_path = root/'lex/data/analytics.json'
    analytics = read(analytics_path)
    counts = collections.Counter(s for d in meta['decisions'] for s in d['statutes'])
    analytics['statutes'] = [[s, n] for s, n in counts.most_common(200) if not s.startswith('?')][:60]
    analytics['statute_codes'] = dict(collections.Counter(s.split(' ', 1)[0] for d in meta['decisions'] for s in d['statutes']))
    analytics['codes'] = {a['code']: a['short_title'] for a in read(root/'lex/laws.json')['acts']}
    analytics_path.write_text(json.dumps(analytics, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    return source
