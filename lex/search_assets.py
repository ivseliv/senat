"""Пересборка только производных индексов по проверенным публичным текстам.

Не требует PDF или OCR-листов. Сохраняет исходники, диапазоны, цитаты и SHA;
проверяет весь корпус прежде, чем записать новый индекс.
"""
import collections
import hashlib
import json
from pathlib import Path

from ocr_search import build_search_assets, known_words_for
from passages import _field_index


def refresh_search_assets(root, stems, modernize, stem):
    data = Path(root) / 'lex/data'
    meta = json.loads((data / 'meta.json').read_text(encoding='utf-8'))
    docs = meta['decisions']
    if [d['i'] for d in docs] != list(range(len(docs))):
        raise ValueError('Нарушен порядок решений в поисковом индексе')
    texts = {}
    for volume in meta['volumes']:
        own = [d for d in docs if d['vol'] == volume['year']]
        bodies = json.loads((data / volume['file']).read_text(encoding='utf-8'))
        if len(own) != len(bodies):
            raise ValueError('Число текстов не совпадает с реестром решений')
        for doc, body in zip(own, bodies):
            if doc['id'] in texts or not isinstance(body, str):
                raise ValueError('Повтор или недопустимый текст: ' + doc['id'])
            texts[doc['id']] = body
    heads = [d['headnote'] for d in docs]
    bodies = [texts[d['id']] for d in docs]
    known = known_words_for(heads + bodies, modernize)
    index = _field_index([stems(head + '\n' + body) for head, body in zip(heads, bodies)])
    for i, head in enumerate(heads):
        for word, count in collections.Counter(stems(head)).items():
            index['hpost'].setdefault(word, []).extend([i, count])
    index.update(build_search_assets(bodies, stems, modernize, stem, heads=heads, known_words=known))
    pending = {data / 'index.json': index}
    total = 0
    for path in sorted(data.glob('passages-*.json')):
        obj = json.loads(path.read_text(encoding='utf-8'))
        slices = []
        for p in obj['passages']:
            text = texts[p['decision']]
            if not 0 <= p['start'] < p['end'] <= len(text):
                raise ValueError('Неверные границы: ' + p['id'])
            source = text[p['start']:p['end']]
            if hashlib.sha256(source.encode('utf-8')).hexdigest() != p['sha256']:
                raise ValueError('Изменился источник: ' + p['id'])
            slices.append(source)
        original = _field_index([stems(s) for s in slices])
        original.update(build_search_assets(slices, stems, modernize, stem, known_words=known))
        obj['original'] = original
        pending[path] = obj
        total += len(slices)
    encoded = {path: json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
               for path, obj in pending.items()}
    for path, blob in encoded.items():
        if not path.exists() or path.read_bytes() != blob:
            path.write_bytes(blob)
    return dict(decisions=len(docs), passages=total, words=len(known))
