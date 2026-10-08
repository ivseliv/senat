#!/usr/bin/env python3
"""Проверки источника, страниц, устойчивости сборки и безопасной подсветки."""
import hashlib
import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from passages import source_pages

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent

class ConceptTests(unittest.TestCase):
    def test_import_preserves_other_volumes(self):
        import enrich
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'enrichment').mkdir()
            old=root/'enrichment/1905.json'
            old.write_text('{"provenance":"Прежнее происхождение", "passages":{}}\n')
            before=old.read_bytes()
            pid='1904-001:0-10'
            response=root/'response.json'
            response.write_text(json.dumps(dict(provenance='Новый том', passages={pid:dict(
                sha256='sample',summary='Описание',concepts=['понятие'],evidence='источник')})))
            with patch.object(enrich,'ROOT',root), patch.object(enrich,'corpus',return_value=[dict(
                    id=pid,sha256='sample',text='источник')]), patch('sys.argv',['enrich.py','import',str(response)]):
                enrich.main()
            self.assertEqual(old.read_bytes(),before)
            self.assertEqual(json.loads((root/'enrichment/1904.json').read_text())['provenance'],'Новый том')

    def test_corpus_provenance(self):
        meta=json.loads((ROOT/'data/meta.json').read_text())['decisions']
        semantic_years={v['year'] for v in json.loads((ROOT/'data/concepts.json').read_text())['volumes']}
        documents={}
        for year in sorted(set(d['vol'] for d in meta)):
            texts=json.loads((ROOT/f'data/text-{year}.json').read_text())
            documents.update((d['id'],t) for d,t in zip([x for x in meta if x['vol']==year],texts))
            # Том без проверяемых листов остаётся в обычном поиске, но не
            # участвует в понятийной выдаче и не получает вымышленных страниц.
            if year not in semantic_years:
                continue
            data=json.loads((ROOT/f'data/passages-{year}.json').read_text())
            for p in data['passages']:
                text=documents[p['decision']][p['start']:p['end']]
                self.assertEqual(hashlib.sha256(text.encode()).hexdigest(),p['sha256'])
                self.assertLessEqual(p['words'],300)
                self.assertTrue(p['pages'],p['id'])
                for s in p['sources']:
                    self.assertTrue((REPO/f'ocr/{year}'/s['file']).is_file())
                    self.assertGreater(s['end'],s['start'])
                if 'ai' in p:
                    self.assertIn(p['ai']['evidence'],text)
        p=next(p for p in json.loads((ROOT/'data/passages-1905.json').read_text())['passages'] if p['id']=='1905-105:7281-9186')
        self.assertEqual(p['pages'],[286,287])
        self.assertIn('При заключеніи притворныхъ договоровъ',documents[p['decision']][p['start']:p['end']])

    def test_page_reconstruction_and_mismatch(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            (root/'p0001_L.txt').write_text('[[К: № 1. — 10 —]]\n\nНачало незаконченного')
            (root/'p0001_R.txt').write_text('[[К: № 1.]]\n\nабзаца.\n\nДругой абзац.')
            (root/'p0002_L.txt').write_text('[[К: 12 — № 1.]]\n\nКонец.')
            raw='Начало незаконченного абзаца.\n\nДругой абзац.\n\nКонец.\n'
            result=source_pages(root,raw)
            self.assertEqual([p['page'] for p in result],[10,11,11,12])
            self.assertEqual(result[1]['page_method'],'neighbors')
            self.assertEqual(raw[result[1]['start']:result[1]['end']],'абзаца.')
            with self.assertRaises(ValueError):source_pages(root,raw.replace('Конец','Изменение'))

    def test_unicode_and_html(self):
        script=r"""
const assert=require('node:assert/strict'), C=require('./concept.js');
assert.equal(C.slice('😀мнимая сдѣлка',1,7),'мнимая');
assert.equal(C.highlightEvidence('<script>😀сдѣлка</script>',[],'сдѣлка'),'&lt;script&gt;😀<mark>сдѣлка</mark>&lt;/script&gt;');
const parsed=C.parse('фиктивные требования кредиторов при банкротстве',[{
 понятие:'ложные требования кредиторов при несостоятельности',
 синонимы:['фиктивные требования кредиторов при банкротстве'],
 старые_выражения:['претензій ложныхъ, подставныхъ'],примечание:''}]);
assert.equal(parsed.groups.length,1,'Служебное «требования» не должно разрывать псевдоним понятия');
const fs=require('fs'),data=JSON.parse(fs.readFileSync('data/passages-1905.json')),config=JSON.parse(fs.readFileSync('data/concepts.json'));
const hits=C.makeEngine(data,config.glossary).search('фиктивные сделки',config.method).hits.slice(0,5);
assert(hits.length);assert(hits.every(h=>h.passage.decision==='1905-105'));
assert(hits.some(h=>h.passage.start<=7380 && h.passage.end>=7850));
assert.equal(C.makeEngine(data,config.glossary).search('электронная подпись',config.method).hits.length,0);
"""
        subprocess.run(['node','-e',script],cwd=ROOT,check=True)

    def test_idempotence_and_size(self):
        files=list((ROOT/'data').glob('*.json'))+[ROOT/'dist/senat-lex.html']
        before={p:hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
        subprocess.run(['python3',str(ROOT/'build.py'),'--single'],cwd=REPO,check=True,capture_output=True)
        self.assertEqual(before,{p:hashlib.sha256(p.read_bytes()).hexdigest() for p in files})
        # Предел относится к начальной загрузке сайта; офлайн-файл содержит все тома.
        initial = ['index.html','app.js','lex.js','concept.js','data/meta.json','data/index.json','data/analytics.json']
        self.assertLess(sum((ROOT/name).stat().st_size for name in initial),10_000_000)

    def test_scores_are_comparable_across_volumes(self):
        script=r"""
const assert=require('node:assert/strict'), C=require('./concept.js');
function volume(year, words) {
 const post={};words.forEach((word,i)=>{(post[word] ||= []).push(i,1);});
 return {passages:words.map((word,i)=>({id:year+'-'+i,decision:year+'-'+i,start:0,end:1})),
  original:{n:words.length,avgdl:1,len:words.map(()=>1),post},
  enriched:{n:words.length,avgdl:0,len:words.map(()=>0),post:{}}};
}
const data=[volume(1904,['залог']),volume(1905,['залог',...Array(9).fill('иной')])];
const engines=C.makeEngines(data,[]),hits=engines.flatMap(e=>e.search('залог','baseline').hits);
assert.equal(hits.length,2);
assert.equal(hits[0].score,hits[1].score,'Одинаковый пассаж должен получать одинаковый вес независимо от размера тома');
assert.equal(C.makeEngines([data[0]],[])[0].search('залог','baseline').hits[0].score,
 C.makeEngine(data[0],[]).search('залог','baseline').hits[0].score,'Один том сохраняет прежнее ранжирование');
"""
        subprocess.run(['node','-e',script],cwd=ROOT,check=True)

if __name__=='__main__': unittest.main()
