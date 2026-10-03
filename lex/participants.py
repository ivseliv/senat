"""Проверяемые записи печатных указателей, без вывода биографий или ролей."""
import hashlib
import json
import re
from pathlib import Path


LEADER = re.compile(r'\s*(?:\.\s*){2,}')
NUMBERED_LINE = re.compile(r'^(.*?)(?:\s+)(\d+(?:\s*(?:,|\.|и)\s*\d+)*)\.?$')
LETTER = re.compile(r'^[А-ЯЁІѲ]\.$')


def parse_printed_index(index, source_texts):
    """Разобрать строчный алфавитный указатель, не подменяя OCR нормализацией.

    В 1904 одна запись разорвана колонтитулом в OCR. Обе строки остаются
    источниками единой записи, а номера решений объединяются.
    """
    year = index['year']
    entries, pending = [], None
    ignored = ('[[', 'АЛФАВИТ', 'Алфавит', 'лицъ,', 'за 190', 'ПО ',
               'по Граждан', 'Означеніе', 'нумера', '1*')
    for file, text in source_texts.items():
        for line_no, raw in enumerate(text.splitlines(), start=1):
            line = raw.strip()
            if line.startswith('Предложенія'):
                break
            if (not line or line.startswith(ignored) or LETTER.fullmatch(line)
                    or line.endswith(':')):
                continue
            compact = LEADER.sub(' ', line).strip()
            found = NUMBERED_LINE.fullmatch(compact)
            if not found:
                # Единственный перенос в указателе 1904: строка обрывается
                # после запятой, продолжение начинает следующую страницу.
                if year == 1904 and line.startswith('Управленіе жел. дор.') and line.endswith(','):
                    nums = [int(n) for n in re.findall(r'\d+', line)]
                    pending = dict(label='Управленіе желѣзныхъ дорогъ', section='',
                                   decisions=nums, sources=[dict(file=file, text=line, line_no=line_no)])
                continue
            label, refs = found.groups()
            label = label.strip(' .')
            decisions = [int(n) for n in re.findall(r'\d+', refs)]
            if pending and year == 1904 and line.startswith('Управленіе желѣзныхъ дорогъ'):
                pending['decisions'].extend(decisions)
                pending['sources'].append(dict(file=file, text=line, line_no=line_no))
                entries.append(pending)
                pending = None
                continue
            section = ''
            if ':' in label:
                prefix, value = label.split(':', 1)
                if prefix in ('Банки', 'Желѣзныя дороги', 'Казенныя палаты',
                              'Общества', 'Крестьянскія общества', 'Крестьянск. общ.'):
                    section, label = prefix, value.strip()
            entries.append(dict(label=label, section=section, decisions=decisions,
                                sources=[dict(file=file, text=line, line_no=line_no)]))
    if pending:
        raise ValueError(f'{year}: оборванная запись указателя')
    seen = set()
    result = []
    for entry in entries:
        source_key = '\0'.join(f"{s['file']}:{s['line_no']}:{s['text']}" for s in entry['sources'])
        entry_id = f"{year}-{hashlib.sha256(source_key.encode()).hexdigest()[:12]}"
        if entry_id in seen:
            raise ValueError(f'{year}: повторная строка указателя')
        seen.add(entry_id)
        result.append(dict(id=entry_id, year=year, label=entry['label'], section=entry['section'],
                           decisions=[f'{year}-{number:03d}' for number in entry['decisions']],
                           sources=[dict(file=s['file'], text=s['text']) for s in entry['sources']]))
    return result


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
            if source.get('image') and not (root / 'lex' / source['image']).is_file():
                raise ValueError(f'{file}: нет изображения указателя')
            source_texts[file] = raw.decode('utf-8')
        source_entries = (parse_printed_index(index, source_texts)
                          if index.get('format') == 'printed-index-v1' else index['entries'])
        for entry in source_entries:
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
