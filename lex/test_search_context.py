"""Контекст поиска не может соединять разные дела или удалённые рассуждения."""
import json,subprocess,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
class SearchContextTests(unittest.TestCase):
 def test_neighbor_proofs_and_boundaries(self):
  script=r"""
const assert=require('node:assert/strict'),C=require('./concept.js'),L=require('./lex.js');
function volume(specs){
 const post={};specs.forEach((s,i)=>L.stems(s[3]).forEach(w=>(post[w]||=[]).push(i,1)));
 return {passages:specs.map((s,i)=>({id:s[0]+':'+s[1]+'-'+s[2],decision:s[0],start:s[1],end:s[2]})),
 original:{n:specs.length,avgdl:3,len:specs.map(()=>3),post},enriched:{n:specs.length,avgdl:1,len:specs.map(()=>0),post:{}}};
}
let data=volume([['A',0,1000,'аренда леса'],['A',800,1700,'пошлина леса'],['B',0,1000,'аренда леса пошлина']]);
let hits=C.makeEngine(data,[]).search('аренда леса пошлина','hybrid').hits;
assert.equal(hits[0].passage.decision,'B','Локальное полное совпадение должно быть первым');
const ctx=hits.find(h=>h.passage.decision==='A');assert(ctx&&ctx.context.length);
assert.equal(ctx.context[0].decision,ctx.passage.decision);
assert.equal(C.makeEngine(data,[]).search('аренда леса пошлина','hybrid',{context:false}).hits.length,1);
assert(C.makeEngine(data,[]).search('аренда леса пошлина','hybrid',{partial:true}).hits.some(h=>h.context&&!h.partial),'Контекст с полным набором групп не должен исчезать при включении частичного поиска');
data=volume([['A',0,1000,'аренда леса'],['B',800,1700,'пошлина леса']]);
assert.equal(C.makeEngine(data,[]).search('аренда леса пошлина','hybrid').hits.length,0);
data=volume([['A',0,1000,'аренда леса'],['A',9000,10000,'пошлина леса']]);
assert.equal(C.makeEngine(data,[]).search('аренда леса пошлина','hybrid').hits.length,0);
assert.equal(L.stem('сословию'),L.stem('сословия'));
assert.equal(L.stem('основанием'),L.stem('основания'));
assert.equal(L.stem('объяснение'),L.stem('объяснений'));
assert.equal(C.highlight('<лес>', ['леса']), '&lt;<mark>лес</mark>&gt;');
"""
  subprocess.run(['node','-e',script],cwd=ROOT,check=True)
 def test_frozen_quotes_can_be_retrieved_without_crossing_windows(self):
  suite=json.loads((ROOT/'eval/queries-restoration.json').read_text());passages=[p for f in (ROOT/'data').glob('passages-*.json') for p in json.loads(f.read_text())['passages']]
  for q in suite['queries']:
   for g in q['expected']:
    self.assertTrue(any(p['decision']==g['decision'] and p['start']<=g['start'] and p['end']>=g['end'] for p in passages),q['id'])
if __name__=='__main__':unittest.main()
