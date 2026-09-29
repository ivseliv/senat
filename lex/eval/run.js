#!/usr/bin/env node
/* Оценка тем же ядром, которое используется в браузере. */
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const C=require('../concept.js');
const ROOT=path.resolve(__dirname,'..');
const read=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f),'utf8'));
const config=read('data/concepts.json'), suite=read('eval/queries.json');
const volumes=config.volumes.map(v=>read('data/'+v.file));
const engines=volumes.map(v=>C.makeEngine(v,config.glossary));
const meta=read('data/meta.json').decisions, texts={};
for(const v of config.volumes) texts[v.year]=read(`data/text-${v.year}.json`);
const originals=new Map();
for(const year of Object.keys(texts)) meta.filter(d=>String(d.vol)===year).forEach((d,i)=>originals.set(d.id,texts[year][i]));
for(const q of suite.queries) for(const g of q.expected) {
  if(C.slice(originals.get(g.decision),g.start,g.end)!==g.quote) throw Error(q.id+': эталонная цитата не совпадает с источником');
}
const args=process.argv.slice(2), split=args.includes('--split')?args[args.indexOf('--split')+1]:'all';
if(!['all','dev','test','negative'].includes(split)) throw Error('Неизвестная часть набора: '+split);
const queries=suite.queries.filter(q=>split==='all'||q.split===split);
const methods=['baseline','glossary','enriched','hybrid'];
function relevant(p,g) {return p.decision===g.decision && p.start<=g.start && p.end>=g.end;}
const rows=[];
for(const q of queries) for(const method of methods) {
  const hits=engines.flatMap(e=>e.search(q.query,method).hits).sort((a,b)=>b.score-a.score||a.passage.id.localeCompare(b.passage.id));
  const recall=k=>q.expected.length ? q.expected.filter(g=>hits.slice(0,k).some(h=>relevant(h.passage,g))).length/q.expected.length : null;
  const rank=hits.findIndex(h=>q.expected.some(g=>relevant(h.passage,g)));
  rows.push({id:q.id,query:q.query,split:q.split,method,recall5:recall(5),recall10:recall(10),mrr:q.expected.length?(rank<0?0:1/(rank+1)):null,
    negativeFalsePositive:q.expected.length?null:hits.length>0,results:hits.length,
    top10:hits.slice(0,10).map(h=>({passage:h.passage.id,decision:h.passage.decision,pages:h.passage.pages,score:Number(h.score.toFixed(5)),relevant:q.expected.some(g=>relevant(h.passage,g))}))});
}
const average=(rs,key)=>rs.length?rs.reduce((n,r)=>n+r[key],0)/rs.length:0;
const aggregates=[];
for(const group of ['dev','test','positive','negative']) for(const method of methods) {
  const selected=rows.filter(r=>r.method===method && (group==='positive'?r.split!=='negative':r.split===group));
  if(!selected.length) continue;
  const positive=selected.filter(r=>r.mrr!==null),negative=selected.filter(r=>r.negativeFalsePositive!==null);
  aggregates.push({split:group,method,n:selected.length,recall5:positive.length?average(positive,'recall5'):null,
    recall10:positive.length?average(positive,'recall10'):null,mrr:positive.length?average(positive,'mrr'):null,
    falsePositives:negative.length?negative.filter(r=>r.negativeFalsePositive).length:null});
}
const result={queriesSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'eval/queries.json'))).digest('hex'),
  protocol:suite.protocol,split,aggregates,rows};
const filename=split==='all'?'metrics':`metrics-${split}`;
fs.writeFileSync(path.join(__dirname,filename+'.json'),JSON.stringify(result,null,2)+'\n');
const f=n=>n===null?'—':n.toFixed(3);
let md='# Сравнение понятийного поиска\n\n'+suite.protocol+'\n\n'+
'Релевантным считается пассаж, содержащий целиком размеченную цитату рассуждения. Recall измеряется по эталонным цитатам, MRR — по первому такому пассажу во всей выдаче. Отрицательные запросы исключены из средних recall и MRR.\n\n'+
'| Часть | Подход | Запросов | Recall@5 | Recall@10 | MRR | Ложные ответы |\n|---|---|---:|---:|---:|---:|---:|\n';
for(const a of aggregates) md+=`| ${a.split} | ${a.method} | ${a.n} | ${f(a.recall5)} | ${f(a.recall10)} | ${f(a.mrr)} | ${a.falsePositives===null?'—':a.falsePositives} |\n`;
md+='\n| Запрос | Часть | Подход | Recall@5 | Recall@10 | MRR |\n|---|---|---|---:|---:|---:|\n';
for(const r of rows) md+=`| ${r.query} | ${r.split} | ${r.method} | ${f(r.recall5)} | ${f(r.recall10)} | ${f(r.mrr)} |\n`;
md+='\nКонтрольная сумма queries.json: `'+result.queriesSha256+'`.\n';
fs.writeFileSync(path.join(__dirname,filename+'.md'),md);
console.table(aggregates);
if(args.includes('--fail-on-regression')) {
 const a=aggregates.find(a=>a.split==='positive'&&a.method===config.method);
 if(!a||a.recall5<0.65||a.mrr<0.55||rows.some(r=>r.method===config.method&&r.negativeFalsePositive)) process.exitCode=1;
}
