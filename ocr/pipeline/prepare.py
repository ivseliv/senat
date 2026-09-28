#!/usr/bin/env python3
"""Готовит страницы тома для распознавания.

  prepare.py TOM.pdf --out work/1905 [--pages 1-20] [--dpi N]

Для каждой страницы PDF создаёт work/<том>/pNNNN.png (развороты режутся пополам:
pNNNN_L.png / pNNNN_R.png) и, если в PDF есть текстовый слой, pNNNN(_L|_R).abbyy.txt.
Требуются poppler-utils: pdfinfo, pdfimages, pdftoppm, pdftotext.
"""
import argparse, os, re, subprocess, sys

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True, check=True).stdout

def parse_range(s, n):
    if not s: return range(1, n + 1)
    a, _, b = s.partition('-')
    return range(int(a), int(b or a) + 1)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('pdf'); ap.add_argument('--out', required=True)
    ap.add_argument('--pages'); ap.add_argument('--dpi', type=int)
    a = ap.parse_args()
    info = sh('pdfinfo', a.pdf)
    n = int(re.search(r'Pages:\s+(\d+)', info).group(1))
    w, h = map(float, re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info).groups())
    spread = w > h * 1.2
    dpi = a.dpi
    if not dpi:  # родное разрешение растра: пиксели первой картинки / ширина страницы в дюймах
        rows = sh('pdfimages', '-list', '-f', '1', '-l', '3', a.pdf).splitlines()[2:]
        px = max(int(r.split()[3]) for r in rows) if rows else 0
        dpi = round(px * 72 / w) if px else 150
        if spread and px and px < w * dpi / 72 * 0.6: dpi = round(px * 2 * 72 / w)
        dpi = min(max(dpi, 50), 220)
    os.makedirs(a.out, exist_ok=True)
    W, H = round(w * dpi / 72), round(h * dpi / 72)
    for p in parse_range(a.pages, n):
        parts = [('_L', 0, 0, W // 2, H), ('_R', W // 2, 0, W - W // 2, H)] if spread else [('', 0, 0, W, H)]
        for suf, x, y, cw, ch in parts:
            base = os.path.join(a.out, f'p{p:04d}{suf}')
            if not os.path.exists(base + '.png'):
                subprocess.run(['pdftoppm', '-f', str(p), '-l', str(p), '-r', str(dpi), '-png', '-gray', '-singlefile',
                                '-x', str(x), '-y', str(y), '-W', str(cw), '-H', str(ch), a.pdf, base], check=True)
            pt = subprocess.run(['pdftotext', '-f', str(p), '-l', str(p), '-x', str(round(x * 72 / dpi)), '-y', '0',
                                 '-W', str(round(cw * 72 / dpi)), '-H', str(round(h)), a.pdf, '-'],
                                capture_output=True, text=True).stdout
            if len(re.sub(r'\s', '', pt)) > 40:
                open(base + '.abbyy.txt', 'w', encoding='utf-8').write(pt)
    print(f'{a.pdf}: {n} стр., {"развороты" if spread else "одиночные"}, {dpi} dpi -> {a.out}')

if __name__ == '__main__':
    main()
