import json
import unittest
from pathlib import Path
from unittest.mock import patch
import guide_comparisons as comparisons
from decision_analyses import load_texts

ROOT = Path(__file__).resolve().parent

class GuideTests(unittest.TestCase):
    def test_guides_have_current_unique_decisions(self):
        data=json.loads((ROOT/'data/guides.json').read_text(encoding='utf-8'))
        meta=json.loads((ROOT/'data/meta.json').read_text(encoding='utf-8'))
        docs={d['id']:d for d in meta['decisions']}
        self.assertGreaterEqual(len(data['guides']), 1)
        for guide in data['guides']:
            with self.subTest(guide=guide['id']):
                ids=[i for group in guide['groups'] for i in group['decisions']]
                self.assertGreaterEqual(len(ids), 5)
                self.assertEqual(len(ids),len(set(ids)))
                self.assertTrue(all(i in docs for i in ids))

    def test_comparisons_keep_original_reading_lists(self):
        generated=comparisons.build()
        original=json.loads((ROOT/'guides-source.json').read_text())
        self.assertEqual(generated, json.loads((ROOT/'data/guides.json').read_text()))
        self.assertEqual(generated['comparison_count'], 3)
        for before, after in zip(original['guides'],generated['guides']):
            self.assertEqual(before,{k:v for k,v in after.items() if k!='comparison'})

    def test_every_comparison_quote_has_exact_source_and_its_own_pages(self):
        data=comparisons.build()
        texts=load_texts(json.loads((ROOT/'data/meta.json').read_text()))
        for guide in data['guides']:
            comp=guide['comparison']
            ids={c['id'] for c in comp['cases']}
            self.assertGreaterEqual(len(ids),2)
            self.assertTrue(ids.issubset(comparisons.guide_decisions(guide)))
            claims=[s for c in comp['cases'] for s in c['sections']]+comp['comparisons']
            for claim in comp['comparisons']:
                self.assertGreaterEqual(len({e['decision'] for e in claim['evidence']}),2)
            for claim in claims:
                for ev in claim['evidence']:
                    text=texts[ev['decision']]
                    self.assertEqual(text[ev['start']:ev['end']],ev['text'])
                    self.assertEqual(text.count(ev['text']),1)
                    self.assertTrue(ev['scans'])
                    self.assertEqual({r['file'] for r in ev['scans']},{r['file'] for r in ev['sources']})
                    for r in ev['sources']:
                        self.assertLess(r['start'],ev['end'])
                        self.assertGreater(r['end'],ev['start'])

    def invalid_source(self, change, message):
        source=comparisons.read(comparisons.SOURCE)
        change(source['comparisons'][0])
        real=comparisons.read
        with patch.object(comparisons,'read',side_effect=lambda p: source if p==comparisons.SOURCE else real(p)):
            with self.assertRaisesRegex(ValueError,message): comparisons.build()

    def test_changed_case_requires_context_review(self):
        self.invalid_source(lambda s:s['cases'][0].update(source_sha256='0'*64),'повторная содержательная вычитка')

    def test_same_case_twice_cannot_support_a_comparison(self):
        def change(s):
            for e in s['comparisons'][0]['evidence']:e['decision']=s['cases'][0]['id']
        self.invalid_source(change,'разных выбранных дел')

    def test_citation_from_unselected_case_is_rejected(self):
        self.invalid_source(lambda s:s['comparisons'][0]['evidence'][0].update(decision='1896-001'),'разных выбранных дел')

    def test_edited_or_ambiguous_quote_stops_build(self):
        self.invalid_source(lambda s:s['cases'][0]['sections'][0]['evidence'][0].update(quote='выдуманная цитата'),'ровно один раз')

if __name__=='__main__': unittest.main()
