/* Интеграция на реальном корпусе и отрицательные проверки границ доверия. */
'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),R=require('../research.js'),C=require('../concept.js');
const read=name=>JSON.parse(fs.readFileSync('data/'+name+'.json'));
const meta=read('meta'),analytics=read('analytics'),config=read('concepts'),analyses=read('decision-analyses'),guides=read('guides');
const volumes=config.volumes.map(v=>JSON.parse(fs.readFileSync('data/'+v.file))),shared=C.makeEngines(volumes,config.glossary),engines=volumes.map((data,i)=>({data,engine:shared[i]}));
const starts={},texts={};for(const d of meta.decisions)if(starts[d.vol]==null){starts[d.vol]=d.i;texts[d.vol]=read('text-'+d.vol);}
const scanCache={};const textOf=async d=>texts[d.vol][d.i-starts[d.vol]],loadScans=async y=>scanCache[y]||(scanCache[y]=read('scans-'+y));
const adapter={meta,analytics,analyses,guides,config,volumes,textOf,loadScans};
const ctx=R.context(adapter),lookup=new Map(meta.decisions.map(d=>[d.id,d]));
let count=0;const check=(condition,message)=>{assert(condition,message);count++;};
async function verifyQuote(q) {
 const d=lookup.get(q.decision),s=q.field==='headnote'?d.headnote:await textOf(d);
 check(R.cut(s,q.start,q.end)===q.text,'Точная цитата');check(await R.hash(s)===q.source_sha256,'SHA всего поля');
 for(const scan of R.scanLinks(q))check(scan.url.startsWith(R.PUBLIC+'scans/'),'Только сканы корпуса');
}
(async()=>{
 const privateState=R.state({q:'Когда сделку считали мнимой?',terms:'фиктивные сделки',ids:['1905-105'],notes:{general:'Личная заметка 🌳',cases:{'1905-105':'Не публиковать'}}});
 check(R.decode(R.encode(privateState)).notes.general==='','Личные заметки исключены по умолчанию');
 check(R.decode(R.encode(privateState,true)).notes.general==='Личная заметка 🌳','Unicode и явное включение заметок');
 assert.throws(()=>R.decode('%%%'));assert.throws(()=>R.decode('a'.repeat(16001)));assert.throws(()=>R.state({ids:Array(7).fill('1905-105')}));
 assert.throws(()=>R.state({ids:['1905-105','1905-105']}));assert.throws(()=>R.state({version:2}));assert.throws(()=>R.state({q:'x'.repeat(601)}));
 check(R.suggestTerms('Когда сделку считали мнимой?',config.glossary)==='мнимые сделки','Узнаваемое понятие из вопроса');
 const restricted='Когда сделку НЕ считали мнимой?';check(R.suggestTerms(restricted,config.glossary)===restricted,'Отрицание сохранено');
 const qualified=R.suggestTerms('Когда мнимые сделки с недвижимостью признавали недействительными?',config.glossary);
 check(qualified.includes('недвижимость')&&qualified.includes('недействитель'),'Содержательные условия сохранены');
 let s=R.state({q:'фиктивные сделки'}),found=R.find(engines,config,s,meta),report=await ctx.compile(s,found);
 check(report.cases.length===4&&report.cases[0].id==='1905-105','Ранжирование и ограничение справки');
 check(report.issues.length===0,'Нет устаревших цитат в справке');
 const modernID=Object.values(analyses.decisions).find(d=>d.sections.some(s=>s.heading==='Как рассуждал Сенат')).id;
 const modern=await ctx.compile({ids:[modernID]},{candidates:[],hits:[]});
 check(modern.cases[0].sections.some(s=>s.kind==='reason')&&modern.cases[0].sections.some(s=>s.kind==='holding'),'Современные заголовки рассуждения и постановления распознаны');
 check(report.cases.every(c=>c.sections.length===7),'Все найденные дела имеют семь подробных разделов');
 for(const c of report.cases){await verifyQuote(c.headnote_evidence);for(const section of c.sections)for(const q of section.evidence)await verifyQuote(q);for(const f of c.fragments){await verifyQuote(f.evidence);check(f.speaker.includes('отдельно не размечен'),'Пояснение не выдано за позицию Сената');}}
 found=R.find(engines,config,{q:'сделки',year:'1896',department:'Гражданский кассационный департамент'},meta);
 check(found.hits.length===0,'Общее собрание не подменяет кассационный департамент');
 found=R.find(engines,config,{q:'фиктивные сделки',year:'1905'},meta);check(found.hits.every(h=>h.passage.decision.startsWith('1905-')),'Год фильтруется');
 found=R.find(engines,config,{q:'квантовый блокчейн нейросеть'},meta);check(!found.hits.length&&!found.candidates.length,'Нет выдуманных результатов');
 const empty=await ctx.compile({q:'фиктивные сделки',manual:true,ids:[]},found);check(empty.cases.length===0,'Удаление последнего дела не восстанавливает автоподбор');
 for(const ids of [['1904-034','1905-083'],['1897-041','1904-050','1904-105'],['1904-030','1905-022','1905-101']]){
   const local=R.state({q:'Сравнение судебных позиций',terms:'наследство',ids});
   report=await ctx.compile(local,R.find(engines,config,local,meta));
   check(report.cases.length===ids.length&&report.cases.every(c=>c.sections.length),'Все дела сравнительной подборки разобраны');
   check(report.comparisons.length>0&&report.issues.length===0,'Редакционные различия с полным составом дел');
   for(const row of report.comparisons)for(const q of row.evidence)await verifyQuote(q);
 }
 const two=await ctx.compile({ids:['1904-030','1905-022']},{candidates:[],hits:[]});check(two.comparisons.length===0,'Вывод о трёх делах не перенесён на два');
 const cross=await ctx.compile({year:'1896',ids:['1905-105']},{candidates:[],hits:[]});check(cross.issues.some(i=>i.includes('вне поискового фильтра')),'Ручной выбор вне фильтра явно отмечен');
 check(!two.shared_statutes.some(r=>r.statute.startsWith('? ')),'Неизвестные акты не объединяются по одному номеру статьи');
 const pinned=R.state({...report.state,corpus:'0'.repeat(64),hashes:{...report.state.hashes,[report.cases[0].id]:'0'.repeat(64)}});
 const changed=await ctx.compile(pinned,{candidates:[],hits:[]});check(changed.corpus_changed&&changed.cases[0].changed&&changed.issues.length>0,'Изменение версии явно показано');
 const corrupted=structuredClone(analyses);const id=Object.keys(corrupted.decisions)[0];corrupted.decisions[id].source_sha256='0'.repeat(64);
 check(await R.context({...adapter,analyses:corrupted}).corpus!==await ctx.corpus,'Изменение редакционного разбора меняет версию справки');
 const stale=await R.context({...adapter,analyses:corrupted}).compile({ids:[id]},{candidates:[],hits:[]});
 check(stale.cases[0].sections.length===0&&stale.issues.length>0,'Устаревший разбор не принимается');
 const absent=structuredClone(analyses);delete absent.decisions[id];
 const fallback=await R.context({...adapter,analyses:absent,guides:{guides:[]}}).compile({ids:[id]},{candidates:[],hits:[]});
 check(fallback.cases[0].sections.length===0&&fallback.cases[0].fragments.length>0,'При отсутствии разбора остаётся исходный текст и явно неатрибутированные фрагменты');
 const tampered=structuredClone(analyses);tampered.decisions[id].sections[0].evidence[0].text+='НЕ ИЗ ИСТОЧНИКА';
 const mismatch=await R.context({...adapter,analyses:tampered}).compile({ids:[id]},{candidates:[],hits:[]});check(mismatch.issues.length>0,'Проверяется буквальная цитата, а не только SHA разбора');
 const forged={format:'senat-research',version:1,state:privateState,cases:[{summary:'Подложный вывод'}]};
 const imported=R.importState(JSON.stringify(forged));check(!Object.hasOwn(imported,'cases')&&imported.ids[0]==='1905-105','Импорт не принимает чужие выводы');
 assert.throws(()=>R.importState('{'));assert.throws(()=>R.importState(JSON.stringify({format:'другое'})));
 report.title='</title><script>alert(1)</script>';report.notes.general='<img src=x onerror=alert(1)>\n# Поддельный раздел';
 report.cases[0].note='=SUM(A1:A2)';
 const html=R.html(report),md=R.markdown(report);
 check(!html.includes('<script>')&&!html.includes('<img src=x'),'HTML заметок экранирован');
 check(html.includes('Сравнение по существу')&&html.includes('<table>'),'В печатном HTML есть матрица');
 check(!md.includes('\n# Поддельный раздел'),'Заметки не создают Markdown-разметку');
 check(md.includes('| Элемент дела |')&&html.includes('Исход (автоматическая метка)'),'Сравнительная матрица сохраняется в обоих читаемых форматах');
 check(html.includes('Изображения и ссылки на сайт требуют интернета')&&md.includes('Изображения и ссылки на сайт требуют интернета'),'Офлайн-ограничение изображений явно указано');
 const neg=await ctx.compile({q:'мнимая сделка без оплаты',ids:['1905-105']},{candidates:[],hits:[]});check(neg.issues.some(x=>x.includes('отрицание')),'Ограничение обработки отрицаний показано');
 let detailed=0;
 for(const d of meta.decisions){
   const one=await ctx.compile({ids:[d.id]},{candidates:[],hits:[]});
   check(one.cases.length===1&&one.issues.length===0,'Любое дело корпуса собирается без потери источника: '+d.id);
   if(one.cases[0].sections.length)detailed++;
   check(one.cases[0].sections.map(s=>s.kind).join(',')==='facts,party,lower,question,reason,holding,limits','Семь элементов дела разнесены по своим строкам: '+d.id);
   if(d.id==='1904-042')check(one.cases[0].date.includes('1903/₄')&&one.cases[0].date.includes('декабря')&&one.cases[0].date.includes('февраля'),'Составная дата сохранена');
 }
 check(detailed===meta.decisions.length&&detailed===384,'Подробные разборы покрывают все 384 дела корпуса');
 const requested=[],selectedIDs=['1896-001','1905-018'];
 const lazy=R.context({...adapter,analyses:{decisions:{}},analyses_revision:'catalog-v1',analysisOf:async id=>{requested.push(id);return analyses.decisions[id];}});
 const lazyReport=await lazy.compile({ids:selectedIDs},{candidates:[],hits:[]});
 check(requested.join(',')===selectedIDs.join(','),'Загружаются разборы только выбранных дел');
 check(lazyReport.cases.every(c=>c.sections.length===7)&&lazyReport.issues.length===0,'Раздельная загрузка сохраняет разделы, SHA и точные цитаты');
 check(await lazy.corpus!==await R.context({...adapter,analyses:{decisions:{}},analyses_revision:'catalog-v2',analysisOf:async id=>analyses.decisions[id]}).corpus,'Полная редакционная версия меняется и при ленивой загрузке');
 console.log('Research checks passed:',count);
})().catch(e=>{console.error(e);process.exitCode=1;});
