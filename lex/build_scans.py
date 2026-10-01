#!/usr/bin/env python3
"""Привязка пассажей к локальным сканам. Ни сети, ни вызовов модели.

python3 lex/build_scans.py --source-root /путь/к/локальному/senat --cache work/scan-cache
Экспорт с одной книжной страницей на PDF-страницу: --years 1897 --leaf-pdf 1897=/путь/1897.pdf
Координаты принимаются только при строгом выравнивании текста с ABBYY.
Если выравнивание не подтверждено, сохраняется только полная страница.
"""
import argparse
import collections
import difflib
import hashlib
import json
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
NS = {'x': 'http://www.w3.org/1999/xhtml'}
TRANS = str.maketrans({'ѣ':'е', 'і':'и', 'ѳ':'ф', 'ѵ':'и', 'ё':'е'})


def norm(s):
    return re.sub(r'[^а-я0-9]', '', s.lower().translate(TRANS))


def alignment(ocr, words):
    """Индекс символов OCR → символы ABBYY с известными координатами."""
    target, ids = '', []
    for i, w in enumerate(words):
        s = norm(w['text'])
        target += s
        ids.extend([i] * len(s))
    mapping = {}
    for a, b, n in difflib.SequenceMatcher(None, ocr, target, autojunk=False).get_matching_blocks():
        mapping.update((a + k, b + k) for k in range(n))
    return mapping, ids


def crop_box(piece, ocr, words, mapping, ids, width, height):
    """Не локализуем короткий/повторный/плохо совпавший текст по догадке."""
    s = norm(piece)
    if len(s) < 80:
        return None
    start = ocr.find(s)
    if start < 0 or ocr.find(s, start + 1) >= 0:
        return None
    points = [(i, mapping[i]) for i in range(start, start + len(s)) if i in mapping]
    coverage = len(points) / len(s)
    edge = min(30, len(s) // 4)
    if coverage < .90 or sum(i in mapping for i in range(start, start + edge)) / edge < .85 or sum(i in mapping for i in range(start + len(s) - edge, start + len(s))) / edge < .85:
        return None
    # Большие пропуски и вставки могут скрывать другой абзац; оставляем страницу.
    if max((b[0] - a[0] for a, b in zip(points, points[1:])), default=0) > 30:
        return None
    if points[-1][1] - points[0][1] > len(s) * 1.20 + 20:
        return None
    selected = [words[i] for i in sorted({ids[b] for _, b in points})]
    ys = [w['y0'] for w in selected]
    if any(b < a - 4 for a, b in zip(ys, ys[1:])):
        return None
    y0 = max(0, min(w['y0'] for w in selected) - 3)
    y1 = min(height, max(w['y1'] for w in selected) + 3)
    return {'box': [0, round(y0 / height, 6), 1, round(y1 / height, 6)], 'coverage': round(coverage, 3)}


def pdf_pages(pdf, cache):
    # Одинаковое имя бывает у исходного скана и нового экспорта FineReader.
    digest = hashlib.sha256(pdf.read_bytes()).hexdigest()[:16]
    bbox = cache / (pdf.stem + '.' + digest + '.bbox.html')
    if not bbox.exists():
        subprocess.run(['pdftotext', '-bbox-layout', str(pdf), str(bbox)], check=True)
    return ET.parse(bbox).findall('.//x:page', NS)


def page_words(page, side=None):
    width, height = float(page.attrib['width']), float(page.attrib['height'])
    lo, hi = (0, width) if side is None else ((0, width / 2) if side == 'L' else (width / 2, width))
    lines = []
    for line in page.findall('.//x:line', NS):
        words = []
        for w in line.findall('x:word', NS):
            a = w.attrib
            x0, x1 = float(a['xMin']), float(a['xMax'])
            if not lo <= (x0 + x1) / 2 < hi:
                continue
            words.append(dict(text=w.text or '', x0=x0-lo, x1=x1-lo, y0=float(a['yMin']), y1=float(a['yMax'])))
        if words:
            lines.append(sorted(words, key=lambda w: w['x0']))
    lines.sort(key=lambda line: (line[0]['y0'], line[0]['x0']))
    return [w for line in lines for w in line], hi - lo, height


def leaf_page_index(filename):
    """p0001_L/p0001_R → нулевые индексы одиночных PDF-страниц 0/1."""
    match = re.fullmatch(r'p(\d{4})_([LR])(?:\.txt)?', filename)
    if not match or int(match[1]) < 1:
        raise ValueError(f'Некорректное имя листа: {filename}')
    return (int(match[1]) - 1) * 2 + (match[2] == 'R')


def validate_leaf_pdf(pages, year, byfile):
    """Сначала проверяем полный порядок нового экспорта, до записи изображений."""
    leaves = sorted((ROOT / 'ocr' / str(year)).glob('p????_[LR].txt'))
    if not leaves or len(pages) != len(leaves) or [leaf_page_index(p.name) for p in leaves] != list(range(len(pages))):
        raise ValueError(f'{year}: одиночный PDF должен содержать все {len(leaves)} листов в исходном порядке')
    for filename in sorted(byfile):
        words, _, _ = page_words(pages[leaf_page_index(filename)])
        raw = (ROOT / 'ocr' / str(year) / filename).read_text()
        ocr = norm(re.sub(r'\[\[.*?\]\]', '', raw))
        target = norm(' '.join(w['text'] for w in words))
        ratio = difflib.SequenceMatcher(None, ocr, target, autojunk=False).ratio()
        if ratio < .90:
            raise ValueError(f'{year}/{filename}: PDF-страница не подтверждена текстом ({ratio:.3f}); экспорт не принят')


def leaf_image(source, year, fn, pdf, cache, single_pages=False, digest=None):
    digest = digest or hashlib.sha256(pdf.read_bytes()).hexdigest()[:16]
    if single_pages:
        # Рендерим именно тот PDF, из которого получены координаты: FineReader
        # может изменить обрезку, размеры и наклон исходной картинки.
        page = leaf_page_index(fn) + 1
        ready = cache / f'{year}-{digest}-{fn}.png'
        if not ready.exists():
            subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-scale-to-x', '1100', '-scale-to-y', '-1', '-png', '-gray', '-singlefile', str(pdf), str(ready.with_suffix(''))], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return Image.open(ready).convert('L')
    ready = source / 'work' / str(year) / (fn + '.png')
    if ready.exists():
        return Image.open(ready).convert('L')
    number, side = int(fn[1:5]), fn[-1]
    spread = cache / f'{year}-{digest}-{number:04d}.png'
    if not spread.exists():
        subprocess.run(['pdftoppm', '-f', str(number), '-l', str(number), '-scale-to-x', '2200', '-scale-to-y', '-1', '-png', '-gray', '-singlefile', str(pdf), str(spread.with_suffix(''))], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    with Image.open(spread) as im:
        mid = im.width // 2
        return im.crop((0 if side == 'L' else mid, 0, mid if side == 'L' else im.width, im.height)).convert('L')


def build(source, cache, years=None, leaf_pdfs=None):
    cache.mkdir(parents=True, exist_ok=True)
    meta = json.loads((ROOT / 'lex/data/meta.json').read_text())
    leaf_pdfs = leaf_pdfs or {}
    available = {v['year'] for v in meta['volumes']}
    if (set(years or []) | set(leaf_pdfs)) - available:
        raise ValueError('Выбран год, отсутствующий в корпусе')
    summary = []
    for volume in meta['volumes']:
        year = volume['year']
        if years and year not in years:
            current = json.loads((ROOT / 'lex/data' / f'scans-{year}.json').read_text())
            summary.append(dict(year=year, **current['coverage']))
            continue
        single_pages = year in leaf_pdfs
        pdf = leaf_pdfs.get(year, source / 'scans' / f'se_a_u_k_ow_-da_e_o-u_k_ow_{year}.pdf')
        if not pdf.exists() or pdf.stat().st_size < 1000:
            raise ValueError(f'Нужен уже локальный PDF {year}: {pdf}; LFS не скачиваем')
        pages = pdf_pages(pdf, cache)
        data = json.loads((ROOT / 'lex/data' / f'passages-{year}.json').read_text())
        texts = json.loads((ROOT / 'lex/data' / volume['file']).read_text())
        docs = [d for d in meta['decisions'] if d['vol'] == year]
        text_by_id = {d['id']: t for d, t in zip(docs, texts)}
        byfile = collections.defaultdict(list)
        for p in data['passages']:
            groups = collections.defaultdict(list)
            for s in p['sources']:
                groups[s['file']].append(s)
            for filename, spans in groups.items():
                byfile[filename].append((p, spans))
        if single_pages:
            validate_leaf_pdf(pages, year, byfile)
        manifest = dict(version=1, year=year, source_pdf_sha256=hashlib.sha256(pdf.read_bytes()).hexdigest(), pages={}, passages={}, decisions={}, passage_sha256={p['id']:p['sha256'] for p in data['passages']})
        if single_pages:
            manifest.update(source_layout='single-pages', source_pdf_pages=len(pages))
        stage = cache / 'built' / str(year) / manifest['source_pdf_sha256'][:16]
        crops = 0
        for filename, items in sorted(byfile.items()):
            fn = Path(filename).stem
            page_index = leaf_page_index(fn) if single_pages else int(fn[1:5])-1
            page = pages[page_index]
            words, width, height = page_words(page, None if single_pages else fn[-1])
            raw = (ROOT / 'ocr' / str(year) / filename).read_text()
            body = re.sub(r'\[\[.*?\]\]', '', raw)
            ocr = norm(body)
            mapping, ids = alignment(ocr, words)
            image = leaf_image(source, year, fn, pdf, cache, single_pages, manifest['source_pdf_sha256'][:16])
            base = stage / 'scans' / str(year)
            (base / 'pages').mkdir(parents=True, exist_ok=True)
            (base / 'fragments').mkdir(exist_ok=True)
            suffix = '-' + manifest['source_pdf_sha256'][:16] if single_pages else ''
            full = f'scans/{year}/pages/{fn}{suffix}.webp'
            image.save(stage / full, format='WEBP', quality=86, method=4)
            page_nums = {s['page'] for _, spans in items for s in spans if s['page'] is not None}
            if len(page_nums) > 1:
                raise ValueError(f'{year}/{fn}: противоречивые номера страниц {page_nums}')
            info = dict(file=filename, page=next(iter(page_nums), None), full=full, width=image.width, height=image.height, ocr_sha256=hashlib.sha256(raw.encode()).hexdigest())
            if single_pages:
                info['pdf_page'] = page_index + 1
            manifest['pages'][filename] = info
            for p, spans in items:
                boxes = [crop_box(text_by_id[p['decision']][s['start']:s['end']], ocr, words, mapping, ids, width, height) for s in spans]
                result = dict(file=filename, page=info['page'], full=full, kind='page')
                if boxes and all(boxes):
                    box = [0, min(b['box'][1] for b in boxes), 1, max(b['box'][3] for b in boxes)]
                    if .025 < box[3] - box[1] < .85:
                        # Новые геометрия/рамка получают новый URL: браузер
                        # не должен показать старый кадр из кеша с новой рамкой.
                        identity = p['id'] + filename
                        if single_pages:
                            identity += manifest['source_pdf_sha256'] + json.dumps(box)
                        key = hashlib.sha256(identity.encode()).hexdigest()[:16]
                        thumb = f'scans/{year}/fragments/{key}.webp'
                        cut = image.crop((0, int(box[1]*image.height), image.width, min(image.height, int(box[3]*image.height)+1)))
                        cut.save(stage / thumb, format='WEBP', quality=86, method=4)
                        result.update(kind='fragment', image=thumb, box=box, coverage=min(b['coverage'] for b in boxes), width=cut.width, height=cut.height)
                        crops += 1
                if result['kind'] == 'page':
                    result.update(image=full, width=image.width, height=image.height)
                manifest['passages'].setdefault(p['id'], []).append(result)
                decision_pages = manifest['decisions'].setdefault(p['decision'], [])
                if filename not in decision_pages:
                    decision_pages.append(filename)
            print(f'{year}/{fn}: готово', flush=True)
        manifest['coverage'] = dict(pages=len(byfile), fragments=crops, references=sum(len(v) for v in manifest['passages'].values()))
        assets = {r[k] for refs in manifest['passages'].values() for r in refs for k in ('image', 'full')}
        for asset in sorted(assets):
            destination = ROOT / 'lex' / asset
            destination.parent.mkdir(parents=True, exist_ok=True)
            (stage / asset).replace(destination)
        # После исправлений текста идентификаторы кадров меняются. Удаляем
        # только неиспользуемые WebP выбранного тома после полной сборки.
        for folder in ('pages', 'fragments'):
            for old in (ROOT / 'lex/scans' / str(year) / folder).glob('*.webp'):
                if old.relative_to(ROOT / 'lex').as_posix() not in assets:
                    old.unlink()
        (ROOT / 'lex/data' / f'scans-{year}.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')))
        summary.append(dict(year=year, **manifest['coverage']))
    (ROOT / 'lex/data/scans.json').write_text(json.dumps(dict(version=1, volumes=summary), ensure_ascii=False, separators=(',', ':')))
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-root', required=True, type=Path)
    ap.add_argument('--cache', required=True, type=Path)
    ap.add_argument('--years', nargs='+', type=int, help='Пересобрать только выбранные тома')
    ap.add_argument('--leaf-pdf', action='append', default=[], metavar='ГОД=ПУТЬ', help='Уже локальный PDF с одной книжной страницей на PDF-страницу')
    a = ap.parse_args()
    overrides = {}
    for value in a.leaf_pdf:
        year, sep, path = value.partition('=')
        if not sep or not year.isdigit() or not path or int(year) in overrides:
            ap.error('--leaf-pdf ожидает неповторяющееся ГОД=ПУТЬ')
        overrides[int(year)] = Path(path)
    build(a.source_root, a.cache, a.years, overrides)
