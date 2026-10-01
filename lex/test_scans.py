#!/usr/bin/env python3
"""Проверка отказа от ненадёжного кадрирования и актуальности привязок."""
import hashlib
import json
import unittest
from pathlib import Path
from build_scans import alignment, crop_box, norm

ROOT = Path(__file__).resolve().parent.parent

class LocalizationTests(unittest.TestCase):
    def words(self, text):
        return [dict(text=w,x0=0,x1=10,y0=i//8*12,y1=i//8*12+10) for i,w in enumerate(text.split())]

    def test_correct_text_localizes_on_its_own_page(self):
        text='Сенатъ признаетъ что представленные документы подтверждаютъ заключеніе договора и возникновеніе права истца требовать исполненія обязательства.'
        words=self.words(text);ocr=norm(text);mapping,ids=alignment(ocr,words)
        box=crop_box(text,ocr,words,mapping,ids,100,300)
        self.assertIsNotNone(box)
        self.assertGreaterEqual(box['coverage'],.90)

    def test_different_or_badly_recognized_page_does_not_create_crop(self):
        text='Сенатъ признаетъ что представленные документы подтверждаютъ заключеніе договора и возникновеніе права истца требовать исполненія обязательства.'
        words=self.words('Совершенно другой споръ о земельномъ владѣніи и наследованіи имущества безъ какихъ либо доказательствъ договора.')
        ocr=norm(text);mapping,ids=alignment(ocr,words)
        self.assertIsNone(crop_box(text,ocr,words,mapping,ids,100,300))

    def test_repeated_and_short_text_is_not_guessed(self):
        text='Сенатъ признаетъ что представленные документы подтверждаютъ заключеніе договора и возникновеніе права истца требовать исполненія обязательства.'
        ocr=norm(text+text);words=self.words(text+text);mapping,ids=alignment(ocr,words)
        self.assertIsNone(crop_box(text,ocr,words,mapping,ids,100,300))
        self.assertIsNone(crop_box('Сенатъ признаетъ',ocr,words,mapping,ids,100,300))

class AssetTests(unittest.TestCase):
    def test_every_passage_has_only_its_own_current_sources(self):
        for file in sorted((ROOT/'lex/data').glob('scans-*.json')):
            manifest=json.loads(file.read_text());year=manifest['year']
            data=json.loads((ROOT/'lex/data'/f'passages-{year}.json').read_text())
            passages={p['id']:p for p in data['passages']}
            self.assertEqual(set(manifest['passages']),set(passages))
            for pid,refs in manifest['passages'].items():
                p=passages[pid]; allowed={s['file'] for s in p['sources']}
                self.assertEqual({r['file'] for r in refs},allowed)
                self.assertEqual(manifest['passage_sha256'][pid],p['sha256'])
                for ref in refs:
                    self.assertTrue((ROOT/'lex'/ref['image']).is_file())
                    self.assertTrue((ROOT/'lex'/ref['full']).is_file())
                    if ref['kind']=='fragment':
                        self.assertGreaterEqual(ref['coverage'],.90)
                        self.assertTrue(0<=ref['box'][1]<ref['box'][3]<=1)
            for fn,info in manifest['pages'].items():
                self.assertEqual(hashlib.sha256((ROOT/'ocr'/str(year)/fn).read_bytes()).hexdigest(),info['ocr_sha256'])

if __name__=='__main__':unittest.main()
