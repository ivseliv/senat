#!/usr/bin/env python3
"""Проверка локального PDF без OCR, копирования источника и публикации."""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

from volumes import intake_constraints, load_registry, volume_record

SCHEMA = 1
METHOD = 'poppler-pdftotext-layout-utf8-v1'


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path, value):
    if path.is_symlink():
        raise ValueError('Символическая ссылка вместо файла результата запрещена')
    temp = path.with_suffix(path.suffix + '.partial')
    if temp.is_symlink():
        raise ValueError('Символическая ссылка вместо временного файла запрещена')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def run_poppler(args):
    try:
        completed = subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   timeout=60, env={**os.environ, 'LC_ALL': 'C'})
    except FileNotFoundError as error:
        raise ValueError('Нужны локальные pdfinfo и pdftotext (Poppler); ничего не скачано') from error
    except subprocess.TimeoutExpired as error:
        raise ValueError('Проверка PDF заняла больше 60 секунд; уменьшите --batch-pages и повторите с --resume') from error
    except subprocess.CalledProcessError as error:
        message = error.stderr.decode('utf-8', errors='replace')[:1000]
        raise ValueError('Poppler не прочитал PDF: ' + message) from error
    return completed.stdout


def pdf_info(path):
    raw = run_poppler(['pdfinfo', str(path)]).decode('utf-8', errors='replace')
    fields = dict(re.findall(r'^([^:\n]+):\s*(.*?)\s*$', raw, re.M))
    if not re.fullmatch(r'[1-9]\d*', fields.get('Pages', '')):
        raise ValueError('PDF не сообщил положительное число страниц')
    return {'pages': int(fields['Pages']), 'encrypted': fields.get('Encrypted', 'unknown'),
            'pdf_version': fields.get('PDF version'), 'page_size': fields.get('Page size'),
            'tagged': fields.get('Tagged', 'unknown')}


def inspect_pages(path, first, last):
    raw = run_poppler(['pdftotext', '-f', str(first), '-l', str(last), '-layout', '-enc', 'UTF-8', str(path), '-'])
    text = raw.decode('utf-8', errors='strict')
    parts = text.split('\f')
    if parts and not parts[-1].strip():
        parts.pop()
    if len(parts) != last - first + 1:
        raise ValueError('Число разделителей страниц в текстовом слое не совпало с PDF; карта не угадана')
    return [{'page': first + i, 'characters': len(piece.strip()),
             'text_sha256': hashlib.sha256(piece.encode('utf-8')).hexdigest(),
             'replacement_characters': piece.count('\ufffd'),
             'sample': re.sub(r'\s+', ' ', piece).strip()[:160]}
            for i, piece in enumerate(parts)]


def update_summary(manifest):
    pages = manifest['pages']
    complete = len(pages) == manifest['pdf']['pages']
    manifest.update(complete=complete, pages_inspected=len(pages), status='inspected' if complete else 'in_progress',
                    text_layer={'pages_with_text': sum(p['characters'] > 0 for p in pages),
                                'pages_without_text': [p['page'] for p in pages if not p['characters']],
                                'characters': sum(p['characters'] for p in pages),
                                'replacement_characters': sum(p['replacement_characters'] for p in pages)})
    manifest['publication'] = {'approved': False, 'ready': False, 'blockers': list(manifest['intake_blockers'])}
    if not complete:
        manifest['publication']['blockers'].insert(0, 'Проверены не все PDF-страницы; продолжите с --resume.')
    if manifest['text_layer']['pages_without_text']:
        manifest['publication']['blockers'].append('Есть страницы без текстового слоя. OCR в этой команде не выполняется.')


def report(manifest):
    text = manifest['text_layer']
    return '\n'.join([
        '# Предварительная проверка PDF', '',
        f'Том: {manifest["volume"]["volume_id"]}; {manifest["volume"]["department"]}; {manifest["volume"]["year"]}.',
        f'Издание: {manifest["volume"]["edition"]}.',
        f'SHA-256 PDF: `{manifest["source"]["sha256"]}`.',
        f'Проверено PDF-страниц: {manifest["pages_inspected"]} из {manifest["pdf"]["pages"]}.',
        f'Страниц с извлекаемым текстом: {text["pages_with_text"]}; без текста: {len(text["pages_without_text"])}.',
        '', 'Это PDF-страницы, а не печатные номера. Текстовый слой не удостоверяет правильность OCR, порядок колонок или границы решений.',
        'Исходный PDF не скопирован. OCR, модели, скачивание, создание сканов и публикация не выполнялись.',
        '', '## Что требуется до публикации', '',
        *['- ' + value for value in manifest['publication']['blockers']], '',
        'Для продолжения используйте ту же команду с `--resume`. Изменившийся SHA источника или другая идентичность тома требуют новой папки результата.', ''])


def inspect(pdf, output, volume, *, resume=False, batch_pages=25, max_pages=None, registry=None):
    pdf, output = Path(pdf).resolve(), Path(output).absolute()
    if not pdf.is_file():
        raise ValueError('Нужен существующий локальный PDF')
    with pdf.open('rb') as stream:
        if b'%PDF-' not in stream.read(1024):
            raise ValueError('Это не локальный PDF (в том числе не принимается Git LFS-указатель)')
    if output.is_symlink() or any(parent.is_symlink() for parent in output.parents):
        # /tmp в macOS — системная ссылка; можно указать её реальный путь.
        raise ValueError('Для результата укажите реальный каталог, без символических ссылок')
    if type(batch_pages) is not int or not 1 <= batch_pages <= 100:
        raise ValueError('--batch-pages должен быть от 1 до 100')
    if max_pages is not None and (type(max_pages) is not int or max_pages < 1):
        raise ValueError('--max-pages должен быть положительным числом')
    volume = volume_record(volume)
    blockers = intake_constraints(volume, registry)
    initial_stat = pdf.stat()
    identity = {'path': str(pdf), 'bytes': initial_stat.st_size, 'mtime_ns': initial_stat.st_mtime_ns, 'sha256': file_sha256(pdf)}
    if (pdf.stat().st_size, pdf.stat().st_mtime_ns) != (initial_stat.st_size, initial_stat.st_mtime_ns):
        raise ValueError('PDF изменился при вычислении SHA; повторите проверку стабильного файла')
    destination = output / 'manifest.json'
    if output.exists():
        if not resume or not destination.is_file():
            raise ValueError('Каталог результата уже существует; для того же источника нужен --resume, для нового — новая папка')
    else:
        if resume:
            raise ValueError('Нечего продолжать: manifest.json не существует')
        output.mkdir(parents=True)
    lock = output / '.intake.lock'
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise ValueError('В этой папке уже выполняется intake. После аварии удалите только .intake.lock, убедившись, что процесс остановлен.') from error
    os.close(descriptor)
    try:
        if resume:
            if destination.is_symlink():
                raise ValueError('Символическая ссылка вместо manifest.json запрещена')
            manifest = json.loads(destination.read_text(encoding='utf-8'))
            if manifest.get('status') == 'source_changed':
                raise ValueError('Источник менялся во время прежней проверки; используйте новую папку результата')
            if manifest.get('schema_version') != SCHEMA or manifest.get('method') != METHOD or manifest.get('volume') != volume:
                raise ValueError('Параметры/схема продолжения не соответствуют сохранённой проверке')
            if any(manifest.get('source', {}).get(key) != identity[key] for key in ('sha256', 'bytes')):
                raise ValueError('PDF изменился; прежний результат не перезаписан. Используйте новую папку.')
            pages = manifest.get('pages')
            if not isinstance(pages, list) or len(pages) > manifest['pdf']['pages'] or any(
                row.get('page') != i + 1 or type(row.get('characters')) is not int or row['characters'] < 0 or
                not re.fullmatch(r'[a-f0-9]{64}', row.get('text_sha256', '')) or
                type(row.get('replacement_characters')) is not int or row['replacement_characters'] < 0 or
                not isinstance(row.get('sample'), str) or len(row['sample']) > 160
                for i, row in enumerate(pages)):
                raise ValueError('Повреждён список проверенных страниц; прежний результат не перезаписан')
            manifest['intake_blockers'] = blockers
        else:
            manifest = {'schema_version': SCHEMA, 'method': METHOD, 'volume': volume, 'source': identity,
                        'pdf': pdf_info(pdf), 'intake_blockers': blockers, 'pages': []}
        limit = min(manifest['pdf']['pages'], max_pages or manifest['pdf']['pages'])
        update_summary(manifest)
        atomic_json(destination, manifest)
        for first in range(len(manifest['pages']) + 1, limit + 1, batch_pages):
            manifest['pages'].extend(inspect_pages(pdf, first, min(limit, first + batch_pages - 1)))
            # Проверяем неизменность перед сохранением; итоговый SHA ниже
            # обнаруживает и замену без изменения размера. Публикация запрещена.
            if (pdf.stat().st_size, pdf.stat().st_mtime_ns) != (identity['bytes'], identity['mtime_ns']):
                manifest['status'] = 'source_changed'
                manifest['complete'] = False
                atomic_json(destination, manifest)
                raise ValueError('PDF изменился во время проверки; используйте новую папку')
            update_summary(manifest)
            atomic_json(destination, manifest)
            print(f'PDF: {manifest["pages_inspected"]}/{manifest["pdf"]["pages"]} страниц', flush=True)
        if file_sha256(pdf) != identity['sha256']:
            manifest['status'] = 'source_changed'
            manifest['complete'] = False
            manifest['publication']['blockers'].insert(0, 'PDF изменился во время проверки; весь результат требует новой проверки в новой папке.')
            atomic_json(destination, manifest)
            raise ValueError('PDF изменился во время проверки; результат нельзя продолжать или публиковать')
        report_path = output / 'report.md'
        if report_path.is_symlink():
            raise ValueError('Символическая ссылка вместо report.md запрещена')
        report_path.write_text(report(manifest), encoding='utf-8')
        return manifest
    finally:
        lock.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--volume-id', required=True)
    parser.add_argument('--year', required=True, type=int)
    parser.add_argument('--department-id', required=True)
    parser.add_argument('--department', required=True)
    parser.add_argument('--edition', required=True)
    parser.add_argument('--registry', type=Path)
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--batch-pages', type=int, default=25)
    parser.add_argument('--max-pages', type=int, help='Проверить только первые N страниц; затем можно продолжить с --resume')
    args = parser.parse_args()
    volume = dict(volume_id=args.volume_id, year=args.year, department_id=args.department_id,
                  department=args.department, edition=args.edition, status='staged')
    try:
        result = inspect(args.pdf, args.out, volume, resume=args.resume, batch_pages=args.batch_pages,
                         max_pages=args.max_pages, registry=load_registry(args.registry) if args.registry else None)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        parser.exit(2, str(error) + '\n')
    print(f'Готов отчёт {args.out / "report.md"}. Публикация: не одобрена; данные корпуса не менялись.')
    return result


if __name__ == '__main__':
    main()
