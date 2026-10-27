/* Изолированный Chromium: перенос архивных снимков, проверка и безопасность. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const R=require('../reader.js'),E=require('../reader-export.js'),lex=path.resolve(__dirname,'..');
const sha=t=>crypto.createHash('sha256').update(t).digest('hex');
const current='Начало источника. Единственная цитата. Конец источника.',old='Старая вставка. '+current,literal='Единственная цитата.';
const start=Array.from(old.slice(0,old.indexOf(literal))).length;
const d={id:'1898-001',year:1898,number:1,volume_id:'senat-civil-1898-first',headnote:'Заголовок',department:'Гражданский кассационный департамент',date_label:'1898',source_sha256:sha(old),printed_pages:[7],scans:[{file:'p0001_L.txt',page:7,full:'scans/1898/pages/archive.webp',kind:'page',width:100,height:200}]};
const backupStore=R.createStore();backupStore.addQuote(d,{field:'text',start,end:start+Array.from(literal).length,text_original:literal,source_sha256:sha(old),printed_pages:[7],sources:[{file:'p0001_L.txt',page:7,start,end:start+Array.from(literal).length}],scans:d.scans,note:'Сохранить заметку'});backupStore.setNote('Общая заметка');
const backup=backupStore.exportJSON(),saved=JSON.parse(backup).items[0].quotes[0];
const strip=q=>{const copy=structuredClone(q);delete copy.verification;return copy;};
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'});
 try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'}));
  await page.goto('http://localhost/');
  await page.setContent('<section id="view-reader">'+['tab-reader','reader-status','reader-storage-warning','reader-notice','reader-items','reader-compare-count','reader-compare-panel'].map(id=>'<div id="'+id+'"></div>').join('')+['reader-recover','reader-export-original','reader-compare','reader-research','reader-export-json','reader-export-markdown','reader-export-html','reader-export-csv','reader-retry'].map(id=>'<button id="'+id+'"></button>').join('')+'<input id="reader-title"><textarea id="reader-note"></textarea><input type="file" id="reader-import"></section>');
  for(const file of ['reader.js','reader-export.js','reader-ui.js'])await page.addScriptTag({path:path.join(lex,file)});
  await page.evaluate(({d,current})=>{
   const doc={id:d.id,vol:d.year,num:d.number,volume_id:d.volume_id,dept:d.department,headnote:d.headnote};
   const meta={decisions:[doc],volumes:[{year:d.year,volume_id:d.volume_id}]};
   const adapter={meta,textOf:async()=>current,loadJSON:async()=>({passages:[{decision:d.id,start:0,end:Array.from(current).length,sources:[{file:'p0001_L.txt',page:9,start:0,end:Array.from(current).length}]}]}),loadScans:async()=>({pages:{'p0001_L.txt':{file:'p0001_L.txt',page:9,full:'scans/1898/pages/current.webp',width:100,height:200}},decisions:{[d.id]:['p0001_L.txt']}}),formatDate:()=>'',setModern:()=>{},isModern:()=>false};
   window.fixture=window.SenatReaderUI.create(adapter);window.fixture.render();
  },{d,current});
  await page.evaluate(async raw=>window.fixture.importFile(new File([raw],'backup.json',{type:'application/json'})),backup);
  let state=await page.evaluate(()=>window.fixture.store.getState()),quote=state.items[0].quotes[0];
  assert.deepEqual(strip(quote),saved);assert.equal(quote.verification.status,'archived');assert.equal(state.note,'Общая заметка');
  await page.locator('.reader-rebind-quote').click();
  await page.waitForFunction(()=>window.fixture.store.getState().items[0].quotes.length===2);
  state=await page.evaluate(()=>window.fixture.store.getState());
  assert.deepEqual(strip(state.items[0].quotes.find(q=>q.id===saved.id)),saved);
  const fresh=state.items[0].quotes.find(q=>q.id!==saved.id);assert.equal(fresh.source_sha256,sha(current));assert.deepEqual(fresh.printed_pages,[9]);assert.equal(fresh.note,saved.note);
  assert(E.html(state).includes('Архивная цитата'));assert(E.csv(state).includes('verification_status'));
  // Неизвестное дело не уничтожает перенос заметок остальных записей.
  const missing=JSON.parse(backup);missing.items[0].id='1898-999';missing.items[0].decision.id='1898-999';missing.items[0].decision.number=999;missing.items[0].decision.url=missing.items[0].decision.url.replace('1898-001','1898-999');missing.items[0].quotes=[];missing.items[0].note='Архивная заметка к отсутствующему делу';
  await page.evaluate(async raw=>window.fixture.importFile(new File([raw],'missing.json')),JSON.stringify(missing));
  assert.equal((await page.evaluate(()=>window.fixture.store.getState())).items[1].note,missing.items[0].note);
  const before=await page.evaluate(()=>window.fixture.store.exportJSON());
  for(const mutate of [x=>x.items[0].quotes[0].url='javascript:alert(1)',x=>x.items[0].decision.url='https://evil.test/#/d/1898-001']) {
   const bad=JSON.parse(backup);mutate(bad);
   const error=await page.evaluate(async raw=>{try{await window.fixture.importFile(new File([raw],'bad.json'));return '';}catch(e){return e.message;}},JSON.stringify(bad));
   assert(error);assert.equal(await page.evaluate(()=>window.fixture.store.exportJSON()),before);
  }
  for(const toggle of await page.locator('.reader-compare-toggle').all())await toggle.check();
  await page.locator('#reader-research').click();
  assert((await page.evaluate(()=>location.hash)).startsWith('#/research?ids=1898-001'));
  assert.deepEqual(errors,[]);console.log('Reader archive browser: unchanged snapshots, current copy, missing decision, export status, malicious URL rejection passed');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
