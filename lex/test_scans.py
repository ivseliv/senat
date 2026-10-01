#!/usr/bin/env python3
"""Проверка отказа от ненадёжного кадрирования и актуальности привязок."""
import hashlib
import json
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from build_scans import alignment, crop_box, norm, page_words, leaf_page_index, validate_leaf_pdf, pdf_pages, leaf_image

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

class LeafPDFTests(unittest.TestCase):
    def page(self, text):
        page=ET.Element('{http://www.w3.org/1999/xhtml}page',width='200',height='300')
        for i,word in enumerate(text.split()):
            if i%18==0:line=ET.SubElement(page,'{http://www.w3.org/1999/xhtml}line')
            y=20+(i//18)*12
            w=ET.SubElement(line,'{http://www.w3.org/1999/xhtml}word',xMin=str(i%18*10),xMax=str(i%18*10+8),yMin=str(y),yMax=str(y+10))
            w.text=word
        return page

    def test_single_pages_keep_both_sides_of_the_image(self):
        words,width,height=page_words(self.page(' '.join(['право']*18)))
        self.assertEqual(len(words),18)
        self.assertEqual((width,height),(200,300))
        self.assertGreater(words[-1]['x0'],width/2)

    def test_leaf_numbering_is_explicit_and_rejects_bad_names(self):
        self.assertEqual(leaf_page_index('p0001_L.txt'),0)
        self.assertEqual(leaf_page_index('p0001_R'),1)
        self.assertEqual(leaf_page_index('p0175_R.txt'),349)
        for fn in ['p0000_L','p0175_X','p17_L','volume.txt']:
            with self.assertRaises(ValueError):leaf_page_index(fn)

    def test_missing_or_reordered_pages_are_rejected_before_building(self):
        left='Сенатъ признаетъ документы и заключеніе договора.'*8
        right='Наслѣдники получили земельное имущество отъ родителей.'*8
        with tempfile.TemporaryDirectory() as d,patch('build_scans.ROOT',Path(d)):
            leaves=Path(d)/'ocr/1897';leaves.mkdir(parents=True)
            (leaves/'p0001_L.txt').write_text(left)
            (leaves/'p0001_R.txt').write_text(right)
            byfile={'p0001_L.txt':[],'p0001_R.txt':[]}
            pages=[self.page(left),self.page(right)]
            validate_leaf_pdf(pages,1897,byfile)
            with self.assertRaisesRegex(ValueError,'все 2 листов'):
                validate_leaf_pdf(pages[:1],1897,byfile)
            with self.assertRaisesRegex(ValueError,'не подтверждена'):
                validate_leaf_pdf(pages[::-1],1897,byfile)

    def test_pdf_cache_distinguishes_same_named_exports_by_content(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);cache=root/'cache';cache.mkdir()
            one=root/'original';two=root/'new';one.mkdir();two.mkdir()
            a=one/'1897.pdf';b=two/'1897.pdf'
            a.write_bytes(b'original');b.write_bytes(b'new export')
            def extract(cmd,**kwargs):
                Path(cmd[-1]).write_text('<html xmlns="http://www.w3.org/1999/xhtml"><page width="200" height="300"/></html>')
            with patch('build_scans.subprocess.run',side_effect=extract) as run:
                pdf_pages(a,cache);pdf_pages(b,cache);pdf_pages(a,cache)
                self.assertEqual(run.call_count,2)
            self.assertEqual(len(list(cache.glob('*.bbox.html'))),2)

    def test_leaf_export_does_not_reuse_original_png_geometry(self):
        with tempfile.TemporaryDirectory() as d:
            source=Path(d);cache=source/'cache';cache.mkdir()
            original=source/'work/1897';original.mkdir(parents=True)
            Image.new('L',(20,20),10).save(original/'p0001_R.png')
            Image.new('L',(30,40),200).save(cache/'1897-verified-p0001_R.png')
            with patch('build_scans.subprocess.run') as run:
                result=leaf_image(source,1897,'p0001_R',source/'not-needed.pdf',cache,True,'verified')
                self.assertEqual(result.size,(30,40))
                self.assertEqual(result.getpixel((0,0)),200)
                run.assert_not_called()

if __name__=='__main__':unittest.main()
