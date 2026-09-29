#!/usr/bin/env python3
"""Распознаёт страницы через локальный Claude Code (`claude -p`), по одной.

  run.py work/1905 --out ocr/1905 [--model sonnet] [--limit 50] [--with-draft]

Пропускает страницы, у которых уже есть результат, поэтому можно останавливать и
запускать заново. При исчерпании лимита подписки останавливается и пишет, где встал.
"""
import argparse, glob, os, shutil, subprocess, sys, time

LIMIT_MARKERS = ('usage limit', 'rate limit', 'limit reached', 'limit will reset', 'overloaded', 'quota')

def main():
    sys.stdout.reconfigure(line_buffering=True)
    ap = argparse.ArgumentParser()
    ap.add_argument('work'); ap.add_argument('--out', required=True)
    ap.add_argument('--model', default='sonnet'); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--with-draft', action='store_true', help='дать модели черновик ABBYY как подсказку')
    ap.add_argument('--dry', action='store_true'); ap.add_argument('--timeout', type=int, default=600)
    ap.add_argument('--claude', default='claude', help='путь к исполняемому файлу claude (если не в PATH)')
    a = ap.parse_args()
    prompt = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prompt.md'), encoding='utf-8').read()
    exe = shutil.which(a.claude) or (a.claude if os.path.isfile(a.claude) else None)
    if not exe and not a.dry:
        sys.exit('Не найден исполняемый файл claude. Узнайте путь командой `type -a claude` или `which claude`\n'
                 'и запустите с параметром --claude /полный/путь/к/claude (алиас из .zshrc сюда не подходит).')
    os.makedirs(a.out, exist_ok=True)
    pngs = sorted(glob.glob(os.path.join(a.work, 'p*.png')))
    todo = [p for p in pngs if not os.path.exists(os.path.join(a.out, os.path.basename(p)[:-4] + '.txt'))]
    print(f'страниц: {len(pngs)}, осталось: {len(todo)}')
    done = 0
    for png in todo:
        if a.limit and done >= a.limit: break
        name = os.path.basename(png)[:-4]
        msg = f'{prompt}\n\nФайл со страницей: {os.path.abspath(png)}\nПрочитай его инструментом Read и выведи распознанный текст.'
        draft = png[:-4] + '.abbyy.txt'
        if a.with_draft and os.path.exists(draft):
            msg += (f'\nЧерновик автоматического OCR (содержит ошибки, используй только как подсказку, '
                    f'источник истины — изображение): {os.path.abspath(draft)}')
        cmd = [exe or a.claude, '-p', msg, '--model', a.model, '--allowedTools', 'Read', '--output-format', 'text']
        if a.dry: print(' '.join(cmd[:2]), f'... {name}'); done += 1; continue
        t0 = time.time()
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=a.timeout)
        except subprocess.TimeoutExpired:
            print(f'{name}: таймаут, пропускаю'); continue
        out = (r.stdout or '').strip()
        blob = (out + (r.stderr or '')).lower()
        if r.returncode != 0 or any(m in blob for m in LIMIT_MARKERS) and len(out) < 300:
            print(f'\nОстановка на {name}: код {r.returncode}. Похоже, исчерпан лимит.\n{(out or r.stderr)[:300]}')
            print('Запустите ту же команду позже — готовые страницы будут пропущены.'); sys.exit(2)
        tmp = os.path.join(a.out, name + '.txt.tmp')
        open(tmp, 'w', encoding='utf-8').write(out + '\n')
        os.replace(tmp, os.path.join(a.out, name + '.txt'))
        done += 1
        print(f'{name}: {len(out)} зн., {time.time() - t0:.0f} с')
    print(f'готово: {done} стр.')

if __name__ == '__main__':
    main()
