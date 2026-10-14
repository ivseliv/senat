/* Регрессии запросов, подсветки и границ явно запрошенного частичного поиска. */
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const C=require('../concept.js'),L=require('../lex.js');
function volume(year,texts) {
 const post={},sequence=[],vocabulary=[],ids=new Map();
 const len=texts.map((text,i)=> {
  const terms=L.stems(text);for(const term of new Set(terms))(post[term] ||= []).push(i,terms.filter(t=>t===term).length);
  sequence.push(C.allStems(text).map(t=>{if(!ids.has(t)){ids.set(t,vocabulary.length);vocabulary.push(t);}return ids.get(t);}));
  return terms.length;
 });
 return {passages:texts.map((text,i)=>({id:year+'-'+i,decision:year+'-'+i,start:0,end:text.length})),
  original:{n:texts.length,len,avgdl:len.reduce((a,b)=>a+b,0)/texts.length,post,sequence,vocabulary},
  enriched:{n:texts.length,len:texts.map(()=>0),avgdl:0,post:{}}};
}
const glossary=[{понятие:'цифровая подпись',синонимы:[],старые_выражения:[],примечание:''},
 {понятие:'залог',синонимы:['обеспечение залогом'],старые_выражения:['закладъ'],примечание:''}];
const data=volume(1904,['нотариуса нескольких','нотариус отвечает','закладъ']);
const engine=C.makeEngine(data,glossary);
for(const q of ['нотариуса','нескольких'])assert(engine.search(q,'baseline').hits.some(h=>h.i===0),q+': основа запроса должна совпадать с индексом');
assert.equal(C.highlight('нотариуса & несколькихъ',['нотариуса','нескольких']),'<mark>нотариуса</mark> &amp; <mark>несколькихъ</mark>');
assert.equal(C.highlight('<script>нотариуса</script>',['нотариуса']),'&lt;script&gt;<mark>нотариуса</mark>&lt;/script&gt;');
const partial=q=>C.searchAll([engine],q,'glossary',{partial:true});
assert.equal(engine.search('нотариус отвечает криптовалюты','glossary').hits.length,0);
const relaxed=partial('нотариус отвечает криптовалюты');assert(relaxed.partial);assert.equal(relaxed.hits.length,1);
assert.deepEqual(relaxed.hits[0].missing,['криптовалюты']);
for(const q of ['нотариус отвечает 2026','нотариус не отвечает криптовалюты','нотариус без криптовалюты отвечает',
 'нотариус отвечает кроме криптовалюты','«нотариус» отвечает криптовалюты','“нотариус” отвечает криптовалюты',
 'нотариус отвечает -криптовалюты','нотариус отвечает −криптовалюты','нотариус криптовалюты',
 'залог залог электронный','залог обеспечение залогом электронный','цифровая подпись нотариус отвечает'])
 assert.equal(partial(q).hits.length,0,'Нельзя скрывать ограничение запроса: '+q);
assert.equal(C.parse('нотариус нотариус отвечает',[]).groups.length,2);
const all=C.makeEngines([data,volume(1905,['нотариус отвечает криптовалюты'])],glossary);
const strict=C.searchAll(all,'нотариус отвечает криптовалюты','glossary',{partial:true});
assert(!strict.partial);assert.equal(strict.hits.length,1);assert.equal(strict.hits[0].passage.decision,'1905-0');
const read=f=>JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data',f),'utf8'));
const config=read('concepts.json'),engines=C.makeEngines(config.volumes.map(v=>read(v.file)),config.glossary);
const hits=C.searchAll(engines,'ответственность нотариуса за убытки',config.method,{partial:true});
assert(!hits.partial);assert.equal(hits.hits[0].passage.decision,'1897-041');
const forgotten=C.searchAll(engines,'забытые вещи в поезде',config.method,{partial:true});
assert(forgotten.partial);assert.equal(forgotten.hits[0].passage.decision,'1897-016');
assert.deepEqual(forgotten.hits[0].missing,['поезде']);
for(const q of ['электронная подпись','биометрия криптовалюты смартконтракты','залог залог электронный'])
 assert.equal(C.searchAll(engines,q,config.method,{partial:true}).hits.length,0,q);
console.log('Поиск: однократная нормализация, подсветка, полные совпадения по всему корпусу и ограничения частичного поиска — OK');
