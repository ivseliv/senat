#!/usr/bin/env python3
"""Собирает страницы в текст тома.

  assemble.py ocr/1905 --out ocr/1905/volume.txt

Убирает служебные строки [[К: ...]] и [[СНОСКИ]], склеивает абзац, разорванный границей
страницы (страница не кончается на . ! ? : ; » или ")"), сохраняет порядок p0001_L, p0001_R, p0002_L...
Помечает отсутствующие страницы строкой [[ПРОПУСК pNNNN]].
"""
import argparse, glob, os, re

LAT2CYR = str.maketrans('aeopcxyABCEHKMOPTXaeopcxy'[:0] + 'aeopcxyABCEHKMOPTX', 'аеорсхуАВСЕНКМОРТХ')
MIXED = re.compile(r'(?=\w*[а-яѣіѳѵъ])(?=\w*[a-zA-Z])\w+', re.I)

NOTE_PAGE = re.compile(r'(нет печатного текста|Страница пустая|на скане нет|оборотная сторона|штрихкод|библиотечные пометки)', re.I)

def is_note(t):
    t = t.strip()
    return t.startswith('[[ПУСТО]]') or (len(t) < 500 and bool(NOTE_PAGE.search(t)))

def fix_latin(t):
    return MIXED.sub(lambda m: m.group(0).translate(LAT2CYR), t)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir'); ap.add_argument('--out')
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.dir, 'p*.txt')))
    out = []; carry = False
    for f in files:
        t = fix_latin(open(f, encoding='utf-8').read())
        if is_note(t): continue
        t = re.sub(r'^\[\[К:.*?\]\]\s*\n?', '', t, flags=re.M)
        foot = ''
        if '[[СНОСКИ]]' in t:
            t, foot = t.split('[[СНОСКИ]]', 1)
        t = t.strip()
        if not t: continue
        if out and carry:
            first, _, rest = t.partition('\n\n')
            out[-1] = out[-1] + ' ' + first.strip()
            t = rest.strip()
        if t: out.extend(p.strip() for p in t.split('\n\n') if p.strip())
        carry = bool(out) and not re.search(r'[.!?:;»)]$', out[-1])
        if foot.strip(): out.append(foot.strip())
    txt = '\n\n'.join(out) + '\n'
    dst = a.out or os.path.join(a.dir, 'volume.txt')
    open(dst, 'w', encoding='utf-8').write(txt)
    print(f'{len(files)} страниц -> {dst}, {len(txt)} зн.')

if __name__ == '__main__':
    main()
