#!/usr/bin/env python3
"""Проверка: modernize/tokens/stem в Python (build.py) и JS (lex.js) дают одинаковый результат."""
import json, os, random, subprocess, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build

def main():
    texts = json.load(open(os.path.join(build.OUT, 'text-1905.json'), encoding='utf-8'))
    random.seed(1)
    samples = [t[i:i + 400] for t in random.sample(texts, 40) for i in random.sample(range(0, max(1, len(t) - 400)), 3)]
    samples += ['Судебныя установленія, правительствующаго сената, чрезъ Общаго Собранія, гражданскія дѣла ѲЕДОРОВА']
    exp = [dict(m=build.modernize(s), t=build.tokens(s), s=build.stems(s)) for s in samples]
    with tempfile.TemporaryDirectory() as d:
        json.dump(samples, open(os.path.join(d, 'in.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        js = ("const L=require(%r);const fs=require('fs');const S=JSON.parse(fs.readFileSync(%r,'utf8'));"
              "console.log(JSON.stringify(S.map(s=>({m:L.modernize(s),t:L.tokens(s),s:L.stems(s)}))));"
              % (os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lex.js'), os.path.join(d, 'in.json')))
        out = subprocess.run(['node', '-e', js], capture_output=True, text=True)
        if out.returncode:
            print(out.stderr); sys.exit(1)
    got = json.loads(out.stdout)
    bad = [i for i, (a, b) in enumerate(zip(exp, got)) if a != b]
    print(f'образцов {len(samples)}, расхождений {len(bad)}')
    for i in bad[:3]:
        for k in 'mts':
            if exp[i][k] != got[i][k]:
                print(k, 'PY:', str(exp[i][k])[:160], '\n  JS:', str(got[i][k])[:160]); break
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
