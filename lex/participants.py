"""Проверяемые записи печатных указателей, без вывода биографий или ролей."""
import hashlib
import json
import re
from pathlib import Path


def load_participants(root, docs):
    root = Path(root)
    known = {d['id']: d for d in docs}
    entries, seen = [], set()
    for path in sorted((root / 'lex/participants').glob('*.json')):
        index = json.loads(path.read_text())
        year = index['year']
        # Отдельная рабочая выборка томов может не включать этот указатель.
        if not any(d['vol'] == year for d in docs):
            continue
        source_texts = {}
        for file, source in index['sources'].items():
            raw = (root / 'ocr' / str(year) / file).read_bytes()
            if hashlib.sha256(raw).hexdigest() != source['ocr_sha256']:
                raise ValueError(f'{file}: указатель устарел; требуется сверка по скану')
            if not (root / 'lex' / source['image']).is_file():
                raise ValueError(f'{file}: нет изображения указателя')
            source_texts[file] = raw.decode('utf-8')
        for entry in index['entries']:
            if entry['id'] in seen or entry['year'] != year:
                raise ValueError(f'{entry["id"]}: повторная запись или неверный том')
            if not entry['label'].strip() or not entry['decisions'] or not entry['sources']:
                raise ValueError(f'{entry["id"]}: неполная запись указателя')
            for decision in entry['decisions']:
                if decision not in known or known[decision]['vol'] != year:
                    raise ValueError(f'{entry["id"]}: неизвестное решение {decision}')
            for source in entry['sources']:
                if not source['text'] or source['text'] not in source_texts.get(source['file'], ''):
                    raise ValueError(f'{entry["id"]}: нет буквальной строки источника')
            # Убираем только пробелы/типографскую пунктуацию, сохраняя буквы имени.
            letters = lambda text: re.sub(r'[\W_]+', '', text.casefold())
            literal = ''.join(s['text'] for s in entry['sources'])
            if letters(entry['label']) not in letters(literal):
                raise ValueError(f'{entry["id"]}: название отсутствует в строках источника')
            seen.add(entry['id'])
            # На клиенте нужны названия, номера и ссылки на страницы, не сырой OCR.
            entries.append({**{k: entry[k] for k in ('id', 'year', 'label', 'section', 'decisions')},
                            'sources': [{**index['sources'][s['file']], 'file': s['file']}
                                        for s in entry['sources']]})
    by_decision = {}
    for entry in entries:
        for decision in set(entry['decisions']):
            by_decision.setdefault(decision, []).append(entry['id'])
    for d in docs:
        if d['id'] in by_decision:
            d['participant_ids'] = by_decision[d['id']]
    return entries
