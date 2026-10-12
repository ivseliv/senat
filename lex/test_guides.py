import json
import unittest
from pathlib import Path

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

if __name__=='__main__': unittest.main()
