#!/usr/bin/env python3
"""Защищает тождество решений, границы цитат и обратные ссылки/API."""
import collections
import hashlib
import json
import unittest
from pathlib import Path
from precedents import extract, resolve, CIVIL, ASSEMBLY

ROOT=Path(__file__).resolve().parent

def read(name):return json.loads((ROOT/name).read_text())

class ExtractionTests(unittest.TestCase):
    def test_department_is_part_of_identity(self):
        ga,civil={'id':'ga'},{'id':'civil'}
        targets={(ASSEMBLY,1896,42):[ga],(CIVIL,1896,42):[civil]}
        ref=extract('😀 Въ рѣшеніи гр. касс. деп. 1896 г. № 42 разъяснено.',1904)[0]
        self.assertEqual(resolve(ref,targets),('civil','linked'))
        self.assertEqual(resolve(ref,{(ASSEMBLY,1896,42):[ga]}),(None,'not_in_corpus'))
        self.assertEqual(resolve({**ref,'department':None},targets),(None,'department_unknown'))
        self.assertEqual(resolve(ref,{(CIVIL,1896,42):[civil,{'id':'other'}]}),(None,'ambiguous_target'))

    def test_lists_do_not_eat_next_year_or_large_number(self):
        refs=extract('(рѣш. гр. к. д-та 1878 г. № 162 и 1886 г. № 32, 1873 г. № 1239).',1905)
        self.assertEqual([(r['year'],r['number'],r['department']) for r in refs],[(1878,162,CIVIL),(1886,32,CIVIL),(1873,1239,CIVIL)])
        refs=extract('(рѣш. гр. касс. деп. 1880 г. № № 283 и 278, 1878 г. № 256).',1904)
        self.assertEqual([(r['year'],r['number']) for r in refs],[(1880,283),(1880,278),(1878,256)])

    def test_department_changes_in_same_list(self):
        refs=extract('(рѣш. гр. к. д-та 1880 г. № 33, 1875 г. № 102, 1873 г. № 1239 и общ. собр. за 1890 г. № 11 и 20)',1905)
        self.assertEqual([r['department'] for r in refs],[CIVIL]*3+[ASSEMBLY]*2)
        self.assertEqual([r['number'] for r in refs],[33,102,1239,11,20])

    def test_department_after_list_and_unicode_offsets(self):
        text='😀 (сб. рѣш. 1902 г. № 36, 1903 г. № 34 и 1904 г. № 21 по общ. собранію 1-го и касс. д—товъ Правит. Сената).'
        refs=extract(text,1905)
        self.assertEqual([r['department'] for r in refs],[ASSEMBLY]*3)
        self.assertEqual([(r['year'],r['number']) for r in refs],[(1902,36),(1903,34),(1904,21)])
        for r in refs:self.assertEqual(text[r['department_start']:r['department_end']],'общ. собранію')
        self.assertIn('1902 г. № 36',text[refs[0]['start']:refs[0]['end']])

    def test_do_not_borrow_department_from_other_reference_or_company(self):
        text='Гражданскимъ кассаціоннымъ департаментомъ въ рѣшеніи его № 32 за 1887 годъ; что позднѣйшее рѣшеніе Сената 1897 году № 5 разъясняетъ.'
        refs=extract(text,1905)
        self.assertEqual(refs[-1]['department'],None)
        refs=extract('Постановленіе общаго собранія съ постановленіями устава общества (рѣшеніе 1898 г. № 59).',1905)
        self.assertIsNone(refs[0]['department'])
        refs=extract('Рѣшеніе общаго собранія акціонеровъ 1896 г. № 42.',1905)
        self.assertIsNone(refs[0]['department'])

    def test_preserve_explicit_short_civil_name(self):
        refs=extract('Взглядъ, раздѣляемый Общимъ Собран\'емъ (рѣш. Гр. Касс. еп. 1875 г. № 236, 1879 г. № 132).',1896)
        self.assertEqual([r['department'] for r in refs],[CIVIL,CIVIL])

    def test_reject_statutory_issue_and_numbered_argument(self):
        self.assertEqual(extract('По рѣшенію суда законъ 1891 г. (собр. узак. 1891 г. № 76 ст. 821).',1897),[])
        refs=extract('Рѣшеній общ. собр. 1900 г. № 27 и 1897 г. № 29, и 3) что истецъ не доказалъ.',1905)
        self.assertEqual([(r['year'],r['number']) for r in refs],[(1900,27),(1897,29)])

class PublishedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta=read('data/meta.json')['decisions'];cls.docs={d['id']:d for d in cls.meta};cls.texts={}
        for year in {d['vol'] for d in cls.meta}:
            cls.texts.update(zip([d['id'] for d in cls.meta if d['vol']==year],read(f'data/text-{year}.json')))
        cls.data=read('data/precedents.json');cls.refs=cls.data['references']
        cls.passages={p['id']:p for year in {d['vol'] for d in cls.meta} for p in read(f'data/passages-{year}.json')['passages']}

    def test_every_quote_department_and_target_is_grounded(self):
        self.assertEqual(len({r['id'] for r in self.refs}),len(self.refs))
        for r in self.refs:
            text=self.texts[r['source_id']]
            self.assertEqual(hashlib.sha256(text.encode()).hexdigest(),r['source_sha256'])
            self.assertEqual(text[r['start']:r['end']],r['quote_original'])
            self.assertEqual(text[r['context_start']:r['context_end']],r['context_original'])
            self.assertIn(r['quote_original'],r['context_original'])
            if r['department']:
                self.assertEqual(text[r['department_start']:r['department_end']],r['department_evidence'])
                self.assertIn(r['department_evidence'],r['quote_original'])
            if r['status']=='linked':
                target=self.docs[r['target_id']]
                self.assertEqual((target['dept'],target['vol'],target['num']),(r['department'],r['year'],r['number']))
                self.assertEqual(r['target_url'],'#/d/'+target['id'])
            else:self.assertIsNone(r['target_id']);self.assertIsNone(r['target_url'])
            self.assertIn('mode=precedent',r['source_url'])
            if r['passage_id']:
                passage=self.passages[r['passage_id']]
                self.assertLessEqual(passage['start'],r['start']);self.assertGreaterEqual(passage['end'],r['end'])

    def test_all_known_cross_department_collisions_and_true_links(self):
        wrong=[('1904-074',1897,20,ASSEMBLY),('1904-079',1896,42,CIVIL),('1905-074',1904,22,ASSEMBLY),
               ('1905-074',1904,23,ASSEMBLY),('1905-075',1904,21,ASSEMBLY),('1905-092',1904,1,ASSEMBLY),
               ('1905-094',1896,25,CIVIL),('1905-102',1897,29,ASSEMBLY)]
        for source,year,number,department in wrong:
            refs=[r for r in self.refs if (r['source_id'],r['year'],r['number'])==(source,year,number)]
            self.assertTrue(refs,(source,year,number))
            for r in refs:self.assertEqual(r['department'],department);self.assertEqual(r['status'],'not_in_corpus')
        expected={('1897-037','1896-016'),('1897-073','1896-031'),('1904-117','1897-095'),('1905-008','1897-009'),('1905-057','1897-074'),('1905-072','1897-004')}
        self.assertEqual({(r['source_id'],r['target_id']) for r in self.refs if r['target_id']},expected)
        for source,year,number in [('1905-058',1897,5),('1905-055',1898,59),('1905-064',1897,65)]:
            refs=[r for r in self.refs if (r['source_id'],r['year'],r['number'])==(source,year,number)]
            self.assertTrue(refs)
            for r in refs:self.assertEqual(r['status'],'department_unknown')
        for source,year,number in [('1897-037',1891,76),('1904-071',1892,33),('1905-018',1899,25),('1905-062',1891,63),('1905-064',1891,63),('1905-102',1897,3)]:
            self.assertFalse(any((r['source_id'],r['year'],r['number'])==(source,year,number) for r in self.refs))

    def test_api_export_and_analytics_share_the_same_typed_links(self):
        exported=read('export/precedents.json');self.assertEqual(len(exported),len(self.refs))
        for actual,source in zip(exported,self.refs):
            self.assertEqual(actual['id'],source['id']);self.assertEqual(actual['target_id'],source['target_id'])
            self.assertTrue(actual['source_url'].startswith('https://ivseliv.github.io/senat/lex/#/d/'))
        for year in {d['vol'] for d in self.meta}:
            api=read(f'api/v1/precedents/{year}.json')['items']
            self.assertEqual(api,[r for r in exported if r['source_year']==year])
        for doc in self.meta:
            api=read(f'api/v1/decisions/{doc["id"]}.json')['item']
            self.assertEqual(api['precedents'],[r for r in exported if r['source_id']==doc['id']])
        analytics=read('data/analytics.json')
        self.assertTrue(all(row[3] is None for row in analytics['cited']))
        for row in analytics['cited_decisions']:
            self.assertIsNotNone(row['department'])
            if row['target_id']:
                doc=self.docs[row['target_id']]
                self.assertEqual((doc['dept'],doc['vol'],doc['num']),(row['department'],row['year'],row['number']))

if __name__=='__main__':unittest.main()
