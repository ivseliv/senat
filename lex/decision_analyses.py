#!/usr/bin/env python3
"""Собирает проверяемые редакционные разборы решений.

Смещения — Unicode-индексы Python/JavaScript в строке исходного OCR (UTF-8 при
хранении). Якорь из исходного JSON должен встречаться ровно один раз; цитата
всегда извлекается из самого текста, а не перепечатывается редактором.
"""
import argparse, hashlib, json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
LEX=ROOT/'lex'; DATA=LEX/'data'; SOURCE=LEX/'decision-analyses-source.json'; OUT=DATA/'decision-analyses.json'

def read(path): return json.loads(path.read_text(encoding='utf-8'))
def sentence(text, at):
    left=max(text.rfind(x,0,at) for x in ('.','!','?','\n\n'))+1
    ends=[text.find(x,at) for x in ('.','!','?','\n\n') if text.find(x,at)>=0]
    return left, (min(ends)+1 if ends else len(text))
def load_texts(meta):
    mins={y:min(x['i'] for x in meta['decisions'] if x['vol']==y) for y in {x['vol'] for x in meta['decisions']}}
    return {d['id']:read(DATA/f'text-{d["vol"]}.json')[d['i']-mins[d['vol']]] for d in meta['decisions']}
def build():
    source=read(SOURCE); meta=read(DATA/'meta.json'); docs={d['id']:d for d in meta['decisions']}; texts=load_texts(meta)
    passages={}; scans={}
    for y in {d['vol'] for d in meta['decisions']}:
        passages[y]=read(DATA/f'passages-{y}.json')['passages']; scans[y]=read(DATA/f'scans-{y}.json')
    output={'schema_version':source['schema_version'],'label':source['label'],'method':source['method'],
            'offset_encoding':'Unicode code points in UTF-8-decoded source text','decisions':{},'selection':[]}
    for spec in source['decisions']:
        ident=spec['id']; doc=docs[ident]; text=texts[ident]; items=[]
        for heading,speaker,summary,needle in spec['sections']:
            found=[m.start() for m in re.finditer(re.escape(needle),text)]
            if not found: raise ValueError(f'{ident}: anchor {needle!r} not found')
            start,end=sentence(text,found[0])
            candidates=[p for p in passages[doc['vol']] if p['decision']==ident and p['start']<=start and p['end']>=end]
            if not candidates:
                candidates=sorted((p for p in passages[doc['vol']] if p['decision']==ident),key=lambda p:max(0,min(end,p['end'])-max(start,p['start'])),reverse=True)
            p=candidates[0]
            refs=scans[doc['vol']]['passages'].get(p['id'],[])
            items.append({'heading':heading,'speaker':speaker,'summary':summary,'verification':'context_read',
                          'evidence':[{'text':text[start:end],'start':start,'end':end,'passage_id':p['id'],
                                       'printed_pages':p.get('pages',[]),'scan':refs[0] if refs else None}]})
        output['decisions'][ident]={'id':ident,'year':doc['vol'],'department':doc['dept'],
            'source_sha256':hashlib.sha256(text.encode('utf-8')).hexdigest(),'selection':spec['selection'],
            'status':{'automatic':'SHA-256, якоря, смещения, пассажи и ссылки на сканы','editorial':'полный текст прочитан по контексту','image':'страница назначена по опубликованной проверенной привязке; изображение открывается в интерфейсе'},'sections':items}
        output['selection'].append({'id':ident,'reason':spec['selection']})
    output['count']=len(output['decisions']); return output
def main():
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');a=p.parse_args(); obj=build()
    encoded=json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n'
    if a.check:
        if not OUT.is_file() or OUT.read_text(encoding='utf-8') != encoded:
            raise SystemExit('decision-analyses.json устарел: запустите decision_analyses.py')
    else: OUT.write_text(encoded,encoding='utf-8')
    print(f'Разборы: {obj["count"]}; все цитаты и привязки проверены.')
if __name__=='__main__':main()
