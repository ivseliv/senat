import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent

class GuideTests(unittest.TestCase):
    def test_inheritance_guide_has_current_unique_decisions(self):
        data=json.loads((ROOT/'data/guides.json').read_text(encoding='utf-8'))
        meta=json.loads((ROOT/'data/meta.json').read_text(encoding='utf-8'))
        docs={d['id']:d for d in meta['decisions']}
        guide=next(g for g in data['guides'] if g['id']=='inheritance')
        ids=[i for group in guide['groups'] for i in group['decisions']]
        self.assertGreaterEqual(len(ids),20)
        self.assertEqual(len(ids),len(set(ids)))
        self.assertTrue(all(i in docs and docs[i]['vol'] in (1897,1904,1905) for i in ids))

if __name__=='__main__': unittest.main()
