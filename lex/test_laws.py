#!/usr/bin/env python3
"""Проверяемые привязки, потери счётчиков и неопределённые ссылки."""
import copy
import json
import tempfile
import unittest
from urllib.parse import parse_qs
from pathlib import Path
from law_attribution import apply_attributions, check_quote, sha, statute_digest, texts_by_id
from laws import build_law_index, context

ROOT=Path(__file__).resolve().parent.parent

def read(path): return json.loads(Path(path).read_text())
def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,ensure_ascii=False))

class AttributionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=read(ROOT/'lex/law-attributions-source.json')
        cls.meta=read(ROOT/'lex/data/meta.json')
        cls.laws=read(ROOT/'lex/data/laws.json')
        cls.texts=texts_by_id(ROOT,cls.meta)

    def test_source_identity_and_all_literal_evidence(self):
        docs={d['id']:d for d in self.meta['decisions']}
        for ident,base in self.source['decisions'].items():
            self.assertEqual(sha(self.texts[ident]),base['text_sha256'])
            self.assertEqual(sha(docs[ident]['headnote']),base['headnote_sha256'])
        for row in self.source['resolutions']:
            ident=row['decision_id'];fields={'text':self.texts[ident],'headnote':docs[ident]['headnote']}
            self.assertEqual(sum(t['mentions'] for t in row['targets']),row['mentions'])
            for target in row['targets']:
                for occurrence in target['occurrences']:
                    check_quote(fields[occurrence['field']],occurrence)
                    for proof in occurrence['evidence']:
                        self.assertEqual(proof['act_code'],target['code'])
                        if proof['kind']=='printed_index':
                            text=(ROOT/'lex'/proof['path']).read_text()
                            self.assertEqual(sha(text),proof['source_sha256'])
                            check_quote(text,proof);check_quote(text,proof['heading'])
                        else: check_quote(fields[proof['field']],proof)

    def test_conservation_and_unresolved_are_complete(self):
        base=self.source['decisions'];stats=self.laws['attribution_summary']
        # Восстановление колонок1896 изменило исходную эвристическую выборку;
        # прежние1035 сохраняются в протоколе, новые ссылки не выданы за нормы.
        restoration=read(ROOT/'lex/source-restorations.json')['law_baseline']
        self.assertEqual(restoration['previous_unknown_pairs'],1035)
        self.assertEqual(stats['baseline_unknown'],restoration['unknown_pairs'])
        self.assertEqual(stats['baseline_unknown'],stats['resolved_unknown']+stats['remaining_unknown'])
        for doc in self.meta['decisions']:
            self.assertEqual(sum(doc['statutes'].values()),sum(base[doc['id']]['statutes'].values()))
        expected={(d['id'],k):n for d in self.meta['decisions'] for k,n in d['statutes'].items() if k.startswith('? ')}
        actual={(r['decision_id'],r['statute']):r['mentions'] for r in self.laws['unresolved']}
        self.assertEqual(actual,expected)
        self.assertTrue(all(r['code']=='?' and r['verification_status']=='act_unknown' for r in self.laws['unresolved']))

    def test_distinct_acts_and_private_reference_stay_distinct(self):
        doc={d['id']:d for d in self.meta['decisions']}
        self.assertIn('УСТ ст. 497–500',doc['1897-014']['statutes'])
        self.assertIn('УСТ ст. 538',doc['1897-014']['statutes'])
        self.assertNotIn('УГС ст. 497–500',doc['1897-014']['statutes'])
        self.assertIn('? ст. 39',doc['1904-002']['statutes']) # Устав акционерного общества.
        self.assertFalse(any(k.startswith('ГУП1825') for k in doc['1905-024']['statutes'])) # Российский проект, не Польша.
        self.assertTrue(any(k.startswith('УНМС') for d in self.meta['decisions'] for k in d['statutes']))
        # Article numbers are not silently repaired or collapsed to a base number.
        self.assertIn('УГС ст. 3656',doc['1896-049']['statutes'])
        self.assertTrue(any('¹' in r['article'] for r in self.laws['citations']))

    def test_same_number_can_split_between_acts_and_appendices_are_qualified(self):
        row=next(r for r in self.source['resolutions'] if r['decision_id']=='1904-060' and r['from_statute']=='? ст. 57')
        self.assertEqual({t['code']:t['mentions'] for t in row['targets']},{'ОГЗ':1,'УЖД':1})
        selected=[r for r in self.laws['citations'] if (r['decision_id'],r['statute']) in
                  [('1897-014','УГС ст. 22–25'),('1905-054','УПШ ст. 161'),('1904-071','ЗС ст. 857')]]
        self.assertEqual(len(selected),3)
        self.assertTrue(all('прилож' in r['attribution_note'].lower() for r in selected))

    def test_previous_reference_urls_keep_exact_sources_and_current_targets(self):
        history=self.laws['historical_references'];self.assertTrue(history)
        active={r['id']:r for r in self.laws['citations']+self.laws['unresolved']}
        docs={d['id']:d for d in self.meta['decisions']}
        self.assertEqual(len(history),len({r['id'] for r in history}))
        for row in history:
            self.assertNotIn(row['id'],active)
            self.assertTrue(row['historical_note'])
            self.assertTrue(row['current_references'])
            fields={'text':self.texts[row['decision_id']],'headnote':docs[row['decision_id']]['headnote']}
            check_quote(fields[row['field']],row)
            self.assertEqual(row['source_sha256'],sha(fields['text']))
            self.assertEqual(row['headnote_sha256'],sha(fields['headnote']))
            query=parse_qs(row['passage_url'].split('?',1)[1])
            self.assertEqual(int(query['at'][0]),row['start'])
            self.assertEqual(int(query['end'][0]),row['end'])
            self.assertEqual(query['law'][0],row['id'])
            self.assertEqual(query['field'][0],row['field'])
            if row['field']=='text':
                self.assertTrue(row['sources'])
                self.assertTrue(all(s['start']<row['end'] and s['end']>row['start'] for s in row['sources']))
            for ref in row['current_references']:
                current=active[ref['id']]
                self.assertEqual(current['decision_id'],row['decision_id'])
                self.assertEqual(current['article'],row['article'])
                self.assertEqual(ref,{k:current[k] for k in ('id','code','article','passage_url')})

    def test_exact_citation_and_source_field(self):
        docs={d['id']:d for d in self.meta['decisions']}
        for row in self.laws['citations']+self.laws['unresolved']:
            text=self.texts[row['decision_id']] if row['field']=='text' else docs[row['decision_id']]['headnote']
            check_quote(text,row)
            self.assertIn(row['quote_original'],row['context_original'])
            self.assertEqual(row['source_sha256'],sha(self.texts[row['decision_id']]))
            self.assertIn('law=',row['passage_url'])
            if row['field']=='headnote':self.assertFalse(row['scan_available'])
        self.assertEqual(context('ст. 40 уст. гр. суд.',0,6),'ст. 40 уст. гр. суд.')

    def test_projection_is_idempotent(self):
        before=(ROOT/'lex/data/meta.json').read_bytes()
        apply_attributions(ROOT)
        self.assertEqual((ROOT/'lex/data/meta.json').read_bytes(),before)

    def fixture(self,root):
        text='ст. 40 уст. гр. суд.'; ident='2000-001'
        # Existing target also has its own confirmation: incoming counts must
        # survive regardless of iteration order (the old del-key bug).
        base={'? ст. 40':1,'УГС ст. 40':2}
        occ=dict(field='text',start=0,end=6,quote_original=text[:6],method='direct',
                 evidence=[dict(kind='direct',field='text',start=0,end=len(text),quote_original=text,act_code='УГС')])
        source=dict(schema_version=1,decisions={ident:dict(text_sha256=sha(text),headnote_sha256=sha(''),statutes=base)},
                    resolutions=[dict(decision_id=ident,from_statute=k,mentions=n,targets=[dict(code='УГС',mentions=n,occurrences=[copy.deepcopy(occ) for _ in range(n)])]) for k,n in base.items()],unresolved=[])
        write(root/'lex/law-attributions-source.json',source)
        write(root/'lex/laws.json',{'acts':[dict(code='УГС',short_title='УГС')]})
        write(root/'lex/data/meta.json',dict(volumes=[dict(year=2000)],decisions=[dict(id=ident,vol=2000,headnote='',statutes=base)]))
        write(root/'lex/data/text-2000.json',[text]);write(root/'lex/data/analytics.json',{})
        return source

    def test_merge_collision_and_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=self.fixture(root)
            apply_attributions(root)
            self.assertEqual(read(root/'lex/data/meta.json')['decisions'][0]['statutes'],{'УГС ст. 40':3})
            source['resolutions'].reverse();write(root/'lex/law-attributions-source.json',source)
            apply_attributions(root)
            self.assertEqual(read(root/'lex/data/meta.json')['decisions'][0]['statutes'],{'УГС ст. 40':3})

    def test_previous_published_projection_is_explicit_and_not_a_wildcard(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=self.fixture(root)
            # A later pass can accept a precise prior projection, while the
            # immutable raw extractor counters continue to define the base.
            prior={'? ст. 40':2,'УГС ст. 40':1}
            source['previous_projection_sha256']={'2000-001':[statute_digest(prior)]}
            meta=read(root/'lex/data/meta.json');meta['decisions'][0]['statutes']=prior
            write(root/'lex/law-attributions-source.json',source);write(root/'lex/data/meta.json',meta)
            apply_attributions(root)
            self.assertEqual(read(root/'lex/data/meta.json')['decisions'][0]['statutes'],{'УГС ст. 40':3})
            meta['decisions'][0]['statutes']={'? ст. 40':3}
            write(root/'lex/data/meta.json',meta)
            with self.assertRaises(ValueError):apply_attributions(root)

    def test_fail_closed_stale_sha_quote_count_act_and_duplicates(self):
        mutations=[lambda s:s['decisions']['2000-001'].update(text_sha256='0'*64),
                   lambda s:s['resolutions'][0]['targets'][0]['occurrences'][0].update(quote_original='ст. 41'),
                   lambda s:s['resolutions'][0].update(mentions=2),
                   lambda s:s['resolutions'][0]['targets'][0]['occurrences'][0]['evidence'][0].update(act_code='УТ'),
                   lambda s:s['resolutions'].append(s['resolutions'][0])]
        for mutate in mutations:
            with self.subTest(mutation=mutate),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);source=self.fixture(root);mutate(source);write(root/'lex/law-attributions-source.json',source)
                before=(root/'lex/data/meta.json').read_bytes()
                with self.assertRaises(ValueError):apply_attributions(root)
                self.assertEqual(before,(root/'lex/data/meta.json').read_bytes())

if __name__=='__main__':unittest.main()
