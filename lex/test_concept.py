#!/usr/bin/env python3
"""Проверки источника, страниц, устойчивости сборки и безопасной подсветки."""
import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from passages import source_pages

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent

class ConceptTests(unittest.TestCase):
    def test_corpus_provenance(self):
        meta=json.loads((ROOT/'data/meta.json').read_text())['decisions']
        documents={}
        for year in sorted(set(d['vol'] for d in meta)):
            texts=json.loads((ROOT/f'data/text-{year}.json').read_text())
            documents.update((d['id'],t) for d,t in zip([x for x in meta if x['vol']==year],texts))
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
        self.assertLess((ROOT/'dist/senat-lex.html').stat().st_size,10_000_000)

if __name__=='__main__': unittest.main()
