"""Реставрация1896 сохраняет версии текста и не переносит соседнее решение."""
import hashlib,json,unittest
from pathlib import Path
from export import passage_url
ROOT=Path(__file__).resolve().parent
class RestorationTests(unittest.TestCase):
 def test_frozen_versions_and_real_boundaries(self):
  r=json.loads((ROOT/'source-restorations.json').read_text());texts=json.loads((ROOT/'data/text-1896.json').read_text());ps=json.loads((ROOT/'data/passages-1896.json').read_text())['passages']
  for d in r['decisions']:
   t=texts[int(d['id'][5:])-1];self.assertEqual(hashlib.sha256(t.encode()).hexdigest(),d['sha256']);self.assertNotEqual(d['sha256'],d['previous_sha256'])
  for number,page in [(40,782),(46,788)]:
   p=next(p for p in ps if p['decision']==f'1896-{number:03d}');self.assertEqual(p['pages'][0],page)
  self.assertIn('въ утвердительномъ смыслѣ.',texts[48][-100:])
  self.assertNotIn('храненія исполнительныхъ листовъ',texts[32])
 def test_export_version_and_unknown_law_are_not_fabricated(self):
  p=next(p for p in json.loads((ROOT/'data/passages-1896.json').read_text())['passages'] if p['decision']=='1896-034')
  self.assertIn('v=1896-restored-20261019',passage_url(p))
  s=json.loads((ROOT/'law-attributions-source.json').read_text())
  self.assertFalse(any(r['decision_id']=='1896-012' and r['from_statute']=='? ст. 135' for r in s['resolutions']))
if __name__=='__main__':unittest.main()
