import hashlib, json, subprocess, sys, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
class AnalysesTests(unittest.TestCase):
 def test_source_and_generated_records_are_current(self):
  subprocess.run([sys.executable,str(ROOT/'decision_analyses.py'),'--check'],check=True)
  data=json.loads((ROOT/'data/decision-analyses.json').read_text())
  self.assertEqual(data['count'],10)
  for d in data['decisions'].values():
   self.assertEqual(len(d['sections']),7)
   for section in d['sections']:
    for evidence in section['evidence']:
     self.assertTrue(evidence['text'].strip())
     self.assertTrue(evidence['passage_id'].startswith(d['id']+':'))
     self.assertTrue(evidence['scan'])
if __name__=='__main__': unittest.main()
