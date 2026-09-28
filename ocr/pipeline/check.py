#!/usr/bin/env python3
"""Проверяет результат распознавания и выводит страницы для повторного прогона.

  check.py work/1905 ocr/1905 [--delete]

Флаги: пустой/короткий ответ, маркеры отказа, много [?], сильное расхождение с
черновиком ABBYY (по частоте 4-грамм нормализованного текста), сильная разница длин.
С --delete удаляет результаты помеченных страниц, чтобы run.py прогнал их заново.
"""
import argparse, glob, os, re
from collections import Counter

def norm(s):
    s = s.lower()
    s = re.sub(r'\[\[.*?\]\]', '', s)
    for x, y in (('ѣ', 'е'), ('і', 'и'), ('ѳ', 'ф'), ('ѵ', 'и'), ('ъ', ''), ('ь', ''), ('ё', 'е'), ('й', 'и')): s = s.replace(x, y)
    return re.sub(r'[^а-я0-9]', '', s)

def grams(s, n=4):
    return Counter(s[i:i + n] for i in range(len(s) - n + 1))

def overlap(a, b):
    ga, gb = grams(a), grams(b)
    inter = sum((ga & gb).values())
    return inter / max(1, min(sum(ga.values()), sum(gb.values())))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('work'); ap.add_argument('out'); ap.add_argument('--delete', action='store_true')
    a = ap.parse_args()
    bad = []; n = 0
    for f in sorted(glob.glob(os.path.join(a.out, 'p*.txt'))):
        name = os.path.basename(f)[:-4]; n += 1
        t = open(f, encoding='utf-8').read(); why = []
        body = re.sub(r'\[\[.*?\]\]', '', t)
        if len(body.strip()) < 200: why.append('короткий')
        if re.search(r'не могу|cannot|не удалось прочитать|i can.t', t[:300].lower()): why.append('отказ')
        if t.count('[?]') > 5: why.append(f'[?]×{t.count("[?]")}')
        d = os.path.join(a.work, name + '.abbyy.txt')
        if os.path.exists(d):
            x, y = norm(t), norm(open(d, encoding='utf-8').read())
            if y:
                r = len(x) / len(y)
                if not 0.8 < r < 1.25: why.append(f'длина {r:.2f}')
                o = overlap(x, y)
                if o < 0.75: why.append(f'совпадение с ABBYY {o:.0%}')
        if why: bad.append((name, why))
    for name, why in bad: print(name, '; '.join(why))
    print(f'проверено {n}, помечено {len(bad)}')
    if a.delete:
        for name, _ in bad: os.remove(os.path.join(a.out, name + '.txt'))
        print('результаты помеченных страниц удалены, запустите run.py снова')

if __name__ == '__main__':
    main()
