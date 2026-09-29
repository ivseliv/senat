#!/usr/bin/env python3
"""Офлайн-обогащение: пакетный экспорт заданий и возобновляемый импорт ответов.

Без API, ключей и автоматических расходов. Ответы можно подготовить в текущем
диалоге либо любым отдельно согласованным инструментом. Каждый ответ содержит
id, sha256, summary, concepts, evidence. Сборка принимает только актуальные
ответы с точной цитатой. Незавершённое обогащение не ломает обычный поиск.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROMPT = ('Для каждого пассажа напиши 1–2 кратких предложения на современном юридическом языке '
          'и список понятий. Описывай обсуждение в источнике, не давай юридических выводов. '
          'Сохрани id и sha256; evidence — точная цитата из текста, подтверждающая описание. '
          'Различай доводы стороны и рассуждение суда. Отвечай JSON: {"passages": {id: '
          '{"sha256":..., "summary":..., "concepts":[...], "evidence":...}}}.')


def corpus():
    meta = json.loads((ROOT/'data/meta.json').read_text())['decisions']
    ds = {d['id']:d for d in meta}
    cache = {}
    out = []
    for f in sorted((ROOT/'data').glob('passages-*.json')):
        for p in json.loads(f.read_text())['passages']:
            d = ds[p['decision']]
            if d['vol'] not in cache:
                cache[d['vol']] = json.loads((ROOT/f'data/text-{d["vol"]}.json').read_text())
            local = sum(x['vol']==d['vol'] and x['i']<d['i'] for x in meta)
            text = cache[d['vol']][local][p['start']:p['end']]
            out.append(dict(id=p['id'],sha256=p['sha256'],text=text,headnote=d['headnote']))
    return out


def evidence(text):
    """Подсказка для ручной аннотации; не создаёт понятий или описаний."""
    # Берём законченное предложение внутри окна, избегая обрезанного начала.
    sentences = re.split(r'(?<=[.!?;»])\s+(?=[А-ЯЁѢІ])', text)
    candidates = [s for s in sentences[1:] if 90 <= len(s) <= 700] or [text[:400]]
    priorities = re.compile(r'сенат|долж|нельзя|слѣдует|мним|притвор|прав[оа]|закон|основан', re.I)
    return max(candidates,key=lambda s:(bool(priorities.search(s)),min(len(s),350)))[:400]


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    sub=ap.add_subparsers(dest='mode',required=True)
    export=sub.add_parser('export');export.add_argument('--out',type=Path,required=True);export.add_argument('--batch-size',type=int,default=30)
    imp=sub.add_parser('import');imp.add_argument('response',type=Path)
    review=sub.add_parser('review');review.add_argument('--start',type=int,default=0);review.add_argument('--count',type=int,default=100)
    a=ap.parse_args();all_items=corpus()
    records={}
    for f in sorted((ROOT/'enrichment').glob('*.json')):
        records.update(json.loads(f.read_text()).get('passages',{}))
    if a.mode=='review':
        for i,p in enumerate(all_items[a.start:a.start+a.count],a.start):
            print(f'{i} {p["id"]} | {evidence(p["text"])[:250]}')
        return
    if a.mode=='export':
        if a.batch_size < 1: ap.error('--batch-size должен быть положительным')
        pending=[p for p in all_items if records.get(p['id'],{}).get('sha256')!=p['sha256']]
        a.out.mkdir(parents=True,exist_ok=True)
        for i in range(0,len(pending),a.batch_size):
            (a.out/f'batch-{i//a.batch_size+1:04d}.json').write_text(json.dumps(dict(prompt=PROMPT,passages=pending[i:i+a.batch_size]),ensure_ascii=False,indent=2)+'\n')
        print(f'Ожидают аннотации: {len(pending)}; пакетов: {(len(pending)+a.batch_size-1)//a.batch_size}')
        return
    reply=json.loads(a.response.read_text())
    known={p['id']:p for p in all_items}
    imported=reply['passages']
    for pid,ann in imported.items():
        p=known[pid]
        if ann['sha256']!=p['sha256'] or not ann['evidence'] or ann['evidence'] not in p['text']:
            raise ValueError(f'{pid}: неверная контрольная сумма или цитата')
        if not ann['summary'].strip() or not isinstance(ann['concepts'],list) or any(not isinstance(c,str) for c in ann['concepts']):
            raise ValueError(f'{pid}: некорректная аннотация')
    records.update(imported)
    for year in sorted(set(pid.split('-')[0] for pid in records)):
        volume_records={pid:ann for pid,ann in sorted(records.items()) if pid.startswith(year+'-')}
        out=ROOT/f'enrichment/{year}.json'
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_text(json.dumps(dict(provenance=reply.get('provenance','Ответы модели, проверены цитаты'),passages=volume_records),ensure_ascii=False,indent=2)+'\n')
    print(f'Импортировано {len(imported)}; всего {len(records)}')


if __name__=='__main__': main()
