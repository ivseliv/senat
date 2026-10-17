/* Читательская подборка: сохранность записей, Unicode, импорт и отказы storage. */
const assert=require('node:assert/strict'),R=require('../reader.js'),E=require('../reader-export.js');
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),data};};
const d={id:'1905-001',year:1905,number:1,department:'Гражданский кассационный департамент',date_label:'1 января 1905',headnote:'Дѣло о правѣ',url:R.PUBLIC+'#/d/1905-001',source_sha256:'a'.repeat(64),printed_pages:[4,5],scans:[{file:'p0003_L.txt',page:4,full:'scans/1905/pages/p0003_L.webp',kind:'page',image:'scans/1905/pages/p0003_L.webp',width:1100,height:1500}]};
const text='Ѣ😀𐐀\n\nдѣло',q={field:'text',start:2,end:2+Array.from(text).length,text_original:text,source_sha256:'a'.repeat(64),printed_pages:[4,5],sources:[{file:'p0003_L.txt',page:4,start:2,end:2+Array.from(text).length}],scans:d.scans,note:''};
let tests=0;const test=(name,fn)=>{fn();tests++;console.log('✓',name);};
test('reload, duplicate save, exact Unicode and source identity',()=>{
 const storage=memory(),store=R.createStore({storage});store.saveDecision(d);store.updateItem(d.id,{note:'Не потерять'});store.saveDecision(d);store.addQuote(d,q);store.addQuote(d,q);
 const state=R.createStore({storage}).getState();assert.equal(state.items.length,1);assert.equal(state.items[0].quotes.length,1);assert.equal(state.items[0].note,'Не потерять');assert.equal(state.items[0].quotes[0].text_original,text);assert(state.items[0].quotes[0].url.includes('mode=quote'));assert(state.items[0].quotes[0].url.includes('sha='));assert.deepEqual(state.items[0].decision.printed_pages,[4,5]);
});
test('JSON roundtrip merges notes without silent replacement',()=>{
 const a=R.createStore({storage:memory()}),b=R.createStore({storage:memory()});a.addQuote(d,q);a.updateItem(d.id,{note:'Моя заметка'});b.addQuote(d,{...q,note:'Чужая пометка'});b.updateItem(d.id,{note:'Из копии'});a.importJSON(b.exportJSON());let state=a.getState();assert(state.items[0].note.includes('Моя заметка'));assert(state.items[0].note.includes('Из копии'));assert.equal(state.items[0].quotes[0].note,'Чужая пометка');a.importJSON(b.exportJSON());assert.deepEqual(a.getState().items,state.items);assert.throws(()=>a.importJSON(b.exportJSON(),{merge:false}));
});
test('malformed, version, size, URL and Unicode failures are atomic',()=>{
 const s=R.createStore({storage:memory()});s.addQuote(d,q);const before=s.exportJSON();
 const mutate=fn=>{const x=JSON.parse(before);fn(x);return x;};
 for(const bad of ['{',mutate(x=>x.schema_version=99),mutate(x=>x.items[0].quotes[0].url='javascript:alert(1)'),mutate(x=>x.items[0].decision.url='https://evil.test/#/d/1905-001'),mutate(x=>x.items[0].quotes[0].text_original='\ud800'),mutate(x=>x.items[0].quotes[0].end++),mutate(x=>x.items[0].quotes[0].scans[0].full='data:image/png,evil'),mutate(x=>x.items[0].quotes[0].url=x.items[0].quotes[0].url.replace('sha=','sha=b')),mutate(x=>x.title='x'.repeat(201))]){assert.throws(()=>s.importJSON(bad));assert.equal(s.exportJSON(),before);}
 assert.throws(()=>s.importJSON('x'.repeat(R.LIMITS.bytes+1)));
});
test('fresh read preserves sequential edits made in another tab',()=>{
 const storage=memory(),a=R.createStore({storage}),b=R.createStore({storage});a.saveDecision(d);b.setNote('Второе окно');a.addQuote(d,q);b.sync();assert.equal(b.getState().note,'Второе окно');assert.equal(b.getState().items[0].quotes.length,1);
});
test('storage denial retains exportable memory and reports failure',()=>{
 const errors=[],s=R.createStore({storage:{getItem(){throw Error('denied');},setItem(){throw Error('quota');}},onError:e=>errors.push(e)});s.addQuote(d,q);assert.equal(s.getStatus().persistent,false);assert.equal(JSON.parse(s.exportJSON()).items.length,1);assert(errors.length>=2);
});
test('corrupted storage is not overwritten implicitly',()=>{
 const storage=memory();storage.setItem(R.KEY,'{broken');const s=R.createStore({storage});s.saveDecision(d);assert(s.getStatus().blocked);assert.equal(storage.getItem(R.KEY),'{broken');assert(s.recoverStorage());assert.equal(R.validate(storage.getItem(R.KEY)).items.length,1);
});
test('failed write retries against latest data without losing pending edits',()=>{
 const storage=memory(),normal=storage.setItem;let fail=false;storage.setItem=(k,v)=>{if(fail)throw Error('quota');normal(k,v);};const a=R.createStore({storage}),b=R.createStore({storage});fail=true;a.saveDecision(d);fail=false;b.setNote('Другая вкладка');a.flush();assert.equal(a.getState().items.length,1);assert.equal(a.getState().note,'Другая вкладка');
});
test('delete one quote or decision does not damage remaining records',()=>{
 const s=R.createStore({storage:memory()});s.addQuote(d,q);s.updateQuote(d.id,s.getState().items[0].quotes[0].id,{note:'Комментарий'});s.removeQuote(d.id,s.getState().items[0].quotes[0].id);assert.equal(s.getState().items.length,1);assert.equal(s.getState().items[0].quotes.length,0);s.removeItem(d.id);assert.equal(s.getState().items.length,0);
});
test('safe exports include original, notes, pages and canonical scan links',()=>{
 const s=R.createStore({storage:memory()});s.addQuote(d,q);s.setTitle('</title><script>alert(1)</script>');s.setNote('[evil](javascript:alert(1)) <img src=x onerror=alert(1)>');s.updateItem(d.id,{note:'=HYPERLINK("evil")'});const state=s.getState(),html=E.html(state),md=E.markdown(state),csv=E.csv(state);
 assert(html.includes('Ѣ😀𐐀'));assert(!/<script[\s>]/i.test(html));assert(!/<img[\s>]/i.test(html));assert(!/href="javascript:/i.test(html));assert(html.includes('Печатные страницы: 4, 5'));assert(html.includes(R.PUBLIC+'scans/1905/pages/p0003_L.webp'));assert(html.includes('mode=quote'));assert(md.includes('Ѣ😀𐐀'));assert(!md.includes('[evil](javascript:'));assert(csv.includes("'=HYPERLINK"));assert(!E.filename('../bad/<name>','html').includes('/'));
});
test('whole decision export contains pages and scans without requiring a quote',()=>{
 const s=R.createStore({storage:memory()});s.saveDecision(d);for(const out of [E.markdown(s.getState()),E.html(s.getState()),E.csv(s.getState())]){assert(out.includes('p0003_L.webp'));assert(out.includes('4'));}
 const empty=R.createStore({storage:memory()});empty.saveDecision({...d,printed_pages:[],scans:[]});assert(E.markdown(empty.getState()).includes('Печатные страницы не определены'));
});
console.log('Reader core/export:',tests,'checks passed');
