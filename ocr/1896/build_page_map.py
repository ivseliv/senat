#!/usr/bin/env python3
"""Создать проверяемую карту страниц 1896 из исходного FineReader PDF.

PDF в Git не добавляется. Скрипт принимает только уже проверенный локальный
экспорт, сохраняет его постраничный текст и связывает каждый фрагмент текста
решения с одной физической страницей. Карта валидна лишь при совпадении SHA-256
PDF и существующего volume.txt.
"""
from pathlib import Path
import argparse, hashlib, importlib.util, json, re, subprocess, sys

ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
EXPECTED='798ba3ebc3471affe8c3827293ec31a887ebfc194014006431040a8bbc093250'

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); sys.modules[name]=module
    spec.loader.exec_module(module)
    return module

def printed_folio(pdf,page):
    raw=subprocess.run(['pdftotext','-f',str(page),'-l',str(page),'-raw',str(pdf),'-'],capture_output=True,text=True,check=True).stdout.replace('\f','')
    vals=re.findall(r'(?<!\d)(?:1896\s+(\d{3,4})|(\d{3,4})\s+1896)(?!\d)',raw)
    nums=[int(a or b) for a,b in vals]
    if len(set(nums))>1:
        raise ValueError(f'PDF-страница {page}: противоречивые печатные номера {nums}')
    return nums[0] if nums else None

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--pdf',required=True,type=Path)
    args=parser.parse_args(); pdf=args.pdf
    digest=hashlib.sha256(pdf.read_bytes()).hexdigest()
    if digest!=EXPECTED: raise SystemExit('PDF не совпадает с проверенным источником; карту не создаём.')
    importer=load(HERE/'import_finereader.py','import_1896')
    importer.PDF=pdf
    sys.path.insert(0,str(ROOT/'lex'))
    parser_build=load(ROOT/'lex/build.py','build_1896')
    raw=(HERE/'volume.txt').read_text(encoding='utf8')
    _, decisions, _=parser_build.split_volume(raw)
    if len(decisions)!=len(importer.STARTS): raise ValueError('Число решений не совпадает с проверенными началами')
    raw_pages=importer.pages()
    observed={page:printed_folio(pdf,page) for page in range(1,90)}
    # Колонтитул в FineReader иногда сам распознан неверно или пропущен.
    # Используем серию только когда её подтверждают многие страницы, и
    # восстанавливаем пропуск лишь между двумя согласными колонтитулами.
    offsets={}
    for page,folio in observed.items():
        if folio is not None:
            offsets[folio-page]=offsets.get(folio-page,0)+1
    series,count=max(offsets.items(),key=lambda item:item[1])
    if count < 10: raise ValueError('Недостаточно согласных печатных колонтитулов')
    trusted={page for page,folio in observed.items() if folio == page+series}
    folios={}
    for page in range(1,90):
        if page in trusted:
            folios[page]=(observed[page],'header')
            continue
        before=max((p for p in trusted if p<page),default=None)
        after=min((p for p in trusted if p>page),default=None)
        folios[page]=(page+series,'neighbors') if before is not None and after is not None else (None,'verified')
    starts=[(n,p,importer.pos(raw_pages[p],mark)) for n,p,mark in importer.STARTS]
    entries=[]; covered=[]
    for k,(number,first,offset) in enumerate(starts):
        last,end=(starts[k+1][1],starts[k+1][2]) if k+1<len(starts) else (89,len(raw_pages[89]))
        decision=decisions[k]
        if decision['num']!=number: raise ValueError(f'Номер {number}: расходится разбор тома')
        body=decision['text']; base=raw.find(body)
        if base<0 or raw.find(body,base+1)>=0: raise ValueError(f'Решение {number}: неоднозначное положение текста в томе')
        cursor=0
        for page in range(first,last+1):
            fragment=importer.clean(raw_pages[page][offset if page==first else 0:end if page==last else len(raw_pages[page])])
            if not fragment:
                continue
            at=body.find(fragment,cursor)
            if at<0:
                raise ValueError(f'Решение {number}, PDF-страница {page}: текст не найден в точности')
            if body.find(fragment,at+1)>=0 and at<cursor:
                raise ValueError(f'Решение {number}, PDF-страница {page}: неоднозначный фрагмент')
            start,endpos=base+at,base+at+len(fragment)
            printed_page,page_method=folios[page]
            entries.append(dict(decision=number,file=f'p{page:04d}.txt',pdf_page=page,printed_page=printed_page,page_method=page_method,start=start,end=endpos,sha256=hashlib.sha256(raw_pages[page].encode()).hexdigest()))
            covered.append((start,endpos)); cursor=at+len(fragment)
        if cursor!=len(body):
            raise ValueError(f'Решение {number}: карта покрывает {cursor} из {len(body)} символов')
    # Каждая строка карты относится к отдельному непрерывному фрагменту решения.
    # Перекрываться могут только искусственные заголовки, но их здесь нет.
    for a,b in zip(sorted(covered),sorted(covered)[1:]):
        if a[1]>b[0]: raise ValueError('Перекрывающиеся фрагменты карты')
    for page in range(1,90):
        (HERE/f'p{page:04d}.txt').write_text(raw_pages[page],encoding='utf8')
    payload=dict(version=1,layout='single-pages',source_pdf_sha256=digest,volume_sha256=hashlib.sha256(raw.encode()).hexdigest(),pages=89,entries=entries)
    (HERE/'page-map.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'1896: {len(entries)} фрагментов, 89 страниц, {len(decisions)} решений')
if __name__=='__main__': main()
