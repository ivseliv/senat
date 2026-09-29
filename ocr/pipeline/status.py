#!/usr/bin/env python3
"""Прогресс ночного распознавания: полосы по томам, скорость, оценка времени.

  python3 ocr/pipeline/status.py            # один раз
  python3 ocr/pipeline/status.py --watch    # обновлять каждые 5 с (выход: Ctrl+C)

Ничего не запускает и не меняет, только читает файлы. Работает из любой папки.
"""
import argparse, csv, glob, os, re, subprocess, sys, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
QUEUE = [1905, 1904, 1897, 1898, 1899, 1900, 1901, 1902, 1903, 1906, 1907, 1908, 1909, 1910, 1912, 1916]
G, Y, R, D, B, N = '\033[32m', '\033[33m', '\033[31m', '\033[2m', '\033[1m', '\033[0m'

def totals():
    t = {}
    p = os.path.join(ROOT, 'pages.csv')
    if os.path.exists(p):
        for r in csv.DictReader(open(p, encoding='utf-8')):
            m = re.search(r'ow_(\d{4})\.pdf$', r['file'])
            if m and '_o_' not in r['file']:
                t[int(m.group(1))] = int(r['pages']) * 2   # разворот = две половины
    return t

def bar(done, total, w=30):
    f = 0 if not total else min(w, int(w * done / total))
    return '█' * f + '░' * (w - f)

def fmt(sec):
    sec = int(sec)
    return f'{sec // 3600} ч {sec % 3600 // 60:02d} мин' if sec >= 3600 else f'{sec // 60} мин {sec % 60:02d} с'

def running():
    try:
        out = subprocess.run(['pgrep', '-f', '[o]vernight\.sh|[p]ipeline/run\.py'], capture_output=True, text=True).stdout
        return bool(out.split())
    except Exception:
        return None

def render():
    tot = totals(); now = time.time(); lines = []
    rows = []
    for y in QUEUE:
        files = glob.glob(os.path.join(ROOT, 'ocr', str(y), 'p*.txt'))
        finished = os.path.exists(os.path.join(ROOT, 'ocr', str(y), 'volume.txt'))
        rows.append((y, len(files), tot.get(y, 0), finished, files))
    all_done = sum(r[1] if not r[3] else r[2] or r[1] for r in rows)
    all_total = sum(r[2] for r in rows)
    lines.append(f'{B}Распознавание томов{N}   {D}{time.strftime("%d.%m %H:%M:%S")}{N}')
    lines.append('')
    current = None
    for y, n, t, fin, files in rows:
        if fin: st = f'{G}готов{N}'
        elif n:
            st = f'{Y}идёт{N}'; current = current or (y, n, t, files)
        else: continue
        lines.append(f'  {y}  {bar(n, t)}  {n:>4}/{t or "?":<4} {st}')
    pend = [y for y, n, t, fin, f in rows if not n and not fin]
    if pend: lines.append(f'  {D}в очереди: {", ".join(map(str, pend[:6]))}{" …" if len(pend) > 6 else ""}{N}')
    lines.append('')
    lines.append(f'  {B}Всего{N}  {bar(all_done, all_total, 40)}  {all_done}/{all_total} ({100 * all_done // max(1, all_total)}%)')
    if current:
        y, n, t, files = current
        mt = sorted(os.path.getmtime(f) for f in files)[-40:]
        last = mt[-1]; age = now - last
        rate = (len(mt) - 1) / (mt[-1] - mt[0]) if len(mt) > 2 and mt[-1] > mt[0] else 0
        lines.append('')
        if age > 600:
            lines.append(f'  {R}Пауза{N}: последняя страница {fmt(age)} назад — вероятно, лимит подписки или скрипт остановлен.')
        elif rate:
            lines.append(f'  Скорость: {rate * 60:.1f} стр/мин, том {y} закончится через ≈ {fmt((t - n) / rate)}')
    run = running()
    lines.append(f'  Скрипт: {G + "запущен" + N if run else (R + "НЕ запущен" + N if run is False else "неизвестно")}')
    lg = os.path.join(ROOT, 'ocr', 'overnight.log')
    if os.path.exists(lg):
        tail = [l.rstrip() for l in open(lg, encoding='utf-8', errors='replace').readlines()[-2:] if l.strip()]
        for l in tail: lines.append(f'  {D}{l[:100]}{N}')
    return '\n'.join(lines)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--watch', action='store_true')
    a = ap.parse_args()
    if not a.watch: print(render()); return
    try:
        while True:
            sys.stdout.write('\033[2J\033[H' + render() + f'\n\n  {D}обновление каждые 5 с, Ctrl+C — выход{N}\n'); sys.stdout.flush()
            time.sleep(5)
    except KeyboardInterrupt:
        print()

if __name__ == '__main__':
    main()
