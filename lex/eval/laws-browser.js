/* Настоящий Chromium: новые привязки, неопределённые статьи и буквальные основания.
 * LEX_TEST_URL points at the served lex/ directory; LEX_CHROMIUM is optional.
 * No fixed article, year counts or decision IDs: assertions follow fresh data.
 */
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const lex=path.resolve(__dirname,'..'),base=process.env.LEX_TEST_URL || 'http://127.0.0.1:8776/';
const data=JSON.parse(fs.readFileSync(path.join(lex,'data/laws.json'),'utf8'));
const meta=JSON.parse(fs.readFileSync(path.join(lex,'data/meta.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(lex,'law-attributions-source.json'),'utf8'));
const Lex=require('../lex.js');
const out=process.env.LEX_SCREENSHOTS || path.resolve(lex,'../../law-attribution-2026-10/browser');
fs.mkdirSync(out,{recursive:true});
const all=[...data.citations,...data.unresolved];
const proofs=row=>[...new Map([...(row.evidence || []),...(row.occurrences || []).flatMap(o=>o.evidence || [])]
  .map(p=>[JSON.stringify([p.kind,p.path,p.field,p.start,p.end]),p])).values()];
const route=(c='',q='',page='')=>base+'#/laws?'+new URLSearchParams(Object.entries({c,q,page}).filter(([,v])=>v));
const modern=value=>Lex.modernize(String(value || '')).toLowerCase().replace(/ё/g,'е').replace(/[^а-я0-9]+/g,' ').trim();
const actText=act=>modern(act?[act.code,act.title,act.short_title,...(act.aliases || [])].join(' '):'Акт не установлен неопределённая ссылка');
const matches=(row,q)=>{
 const terms=modern(q).split(' ').filter(t=>t && !['ст','статья','статьи'].includes(t));
 const hay=actText(data.acts.find(a=>a.code===row.code))+' '+modern([row.article,row.year,row.decision_number,row.decision_id,row.context_original].join(' '));
 return terms.every(t=>hay.includes(t));
};
// Use the frozen pre-attribution statutes to distinguish new work from old known links.
const fresh=data.citations.filter(r=>r.verification_status==='context_verified' && !source.decisions[r.decision_id].statutes[r.statute]);
assert.equal(data.version,2);assert(fresh.length>0,'Нужны новые подтверждённые привязки');
assert(data.unresolved.length>0,'Оставшиеся неопределённые ссылки должны быть доступны');
assert.equal(data.attribution_summary.remaining_unknown,data.unresolved.length);
assert.equal(data.attribution_summary.confirmed_citations,data.citations.filter(r=>r.verification_status==='context_verified').length);
assert.equal(data.attribution_summary.legacy_unverified_citations,data.citations.filter(r=>r.verification_status==='legacy_unverified').length);

(async()=>{
 const executable=process.env.LEX_CHROMIUM || (fs.existsSync('/Applications/Chromium.app/Contents/MacOS/Chromium')?'/Applications/Chromium.app/Contents/MacOS/Chromium':null);
 const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
 const errors=[],images=[],checked=[];
 try {
  const context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage();
  page.setDefaultTimeout(30000);
  await context.addInitScript(()=>{try{localStorage.setItem('lex.modern','0');}catch(e){}});
  if(process.env.LEX_TEST_SCAN_URL)await context.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>{if(/\/scans\//.test(r.url()))images.push(r.url());});
  const listing=async(c='',q='',number=1)=>{
   await page.goto(route(c,q,number===1?'':String(number)));
   const expected=all.filter(r=>(!c || r.code===c) && matches(r,q));
   await page.waitForFunction(({code,query,count})=>{
    const view=document.querySelector('#view-laws'),status=document.querySelector('#laws-status');
    return view && !view.hidden && document.querySelector('#laws-code').value===code &&
     document.querySelector('#laws-q').value===query && status.textContent.trim().startsWith(String(count)+' ');
   },{code:c,query:q,count:expected.length});
   if(c || q) assert.deepEqual(await page.locator('#laws-results .law-citation').evaluateAll(xs=>xs.map(x=>x.dataset.lawId)),expected.slice((number-1)*80,number*80).map(r=>r.id));
   assert((await page.locator('#laws-status').textContent()).includes(String(expected.length)));
   assert(await page.locator('#laws-results .law-citation').count()<=80,'В DOM не больше одной страницы цитат');
   return expected;
  };
  const exact=async(row,span=row)=>{
   await page.waitForSelector('.law-detail[data-law-id="'+row.id+'"]');
   await page.waitForFunction(quote=>[...document.querySelectorAll('.passage-focus')].map(x=>x.textContent).join('\n\n')===quote,span.quote_original);
   assert.equal(await page.locator('.law-exact-quote').textContent(),span.quote_original);
   assert.equal(await page.locator('#tab-laws').getAttribute('aria-current'),'page');
   if((span.field || row.field)==='headnote'){
    assert(await page.locator('.headnote .passage-focus').count());
    assert.equal(await page.locator('#detail-body > .text .passage-focus').count(),0,'Смещения заголовка нельзя применять к телу решения');
   }
   if(row.source_warning)assert((await page.locator('#detail-body .source-warning').allTextContents()).some(s=>s.includes(row.source_warning)));
   if(row.attribution_note)assert((await page.locator('.law-detail').textContent()).includes(row.attribution_note));
  };
  const open=async(row)=>{await page.goto(base+row.passage_url);await exact(row);};
  const returned=async(row)=>{
   const expected=new URLSearchParams(row.passage_url.split('?')[1]);
   await page.click('#detail-close');await page.waitForFunction(()=>document.querySelector('#detail').hidden);
   const p=new URLSearchParams(page.url().split('?')[1]);
   assert.equal(p.get('c'),expected.get('c'));assert.equal(p.get('q'),expected.get('q'));
   for(const key of ['law','field','at','end','mode'])assert(!p.has(key),'Параметр карточки остался после закрытия: '+key);
  };

  await listing();
  assert.equal(await page.locator('#laws-code option[value="?"]').count(),1);
  assert.equal(await page.locator('[data-map-node="law-unknown"]').count(),1);
  const summary=await page.locator('.law-summary').textContent();
  for(const key of ['baseline_unknown','resolved_unknown','remaining_unknown','confirmed_citations','legacy_unverified_citations','corrected_known'])assert(summary.includes(String(data.attribution_summary[key])),key);
  assert(summary.includes(String(data.unlocated_known_mentions)));
  assert(summary.includes('повторные упоминания'));
  assert.equal(images.length,0,'Каталог не должен заранее скачивать изображения');
  await page.screenshot({path:path.join(out,'laws-desktop.png')});

  const unknownRows=await listing('?');assert.equal(unknownRows.length,data.unresolved.length);
  if(unknownRows.length>80){
   assert.equal(await page.locator('#laws-prev').isDisabled(),true);
   await page.click('#laws-next');await page.waitForURL('**page=2');
   assert.deepEqual(await page.locator('.law-citation').evaluateAll(xs=>xs.map(x=>x.dataset.lawId)),unknownRows.slice(80,160).map(r=>r.id));
   await page.reload();await page.waitForSelector('.law-citation');
   assert.deepEqual(await page.locator('.law-citation').evaluateAll(xs=>xs.map(x=>x.dataset.lawId)),unknownRows.slice(80,160).map(r=>r.id));
   await page.click('#laws-prev');await page.waitForURL('**page=1');
  }
  const unknown=data.unresolved[0];
  await listing('?',unknown.article);assert((await page.locator('.law-status').first().textContent()).includes('не установлен'));
  await listing('?',String(unknown.year));await listing('?',unknown.decision_id);
  const contextWord=modern(unknown.context_original).split(' ').find(w=>w.length>=7 && !/\d/.test(w));
  if(contextWord)await listing('?',contextWord);
  await open(unknown);await page.reload();await exact(unknown);await returned(unknown);

  for(const kind of ['direct','repeat','printed_index']){
   const row=fresh.find(r=>proofs(r).some(p=>p.kind===kind)) || data.citations.find(r=>r.verification_status==='context_verified' && proofs(r).some(p=>p.kind===kind));
   assert(row,'Отсутствует доказательство вида '+kind);
   await listing(row.code,row.decision_id);
   const item=page.locator('.law-citation[data-law-id="'+row.id+'"]');
   assert.equal(await item.getAttribute('data-verification'),'context_verified');
   assert((await item.locator('.law-status').textContent()).includes('подтверждён'));
   await item.locator('.law-evidence > summary').click();
   assert.equal(await item.locator('.law-citation-quote').textContent(),row.quote_original);
   const proof=proofs(row).find(p=>p.kind===kind),proofItem=item.locator('.law-proof[data-kind="'+kind+'"]').first();
   assert.equal(await proofItem.locator('.law-proof-quote').textContent(),proof.quote_original);
   if(kind==='printed_index'){
    assert.equal(await proofItem.locator('.law-index-heading').textContent(),proof.heading.quote_original);
    const link=proofItem.locator('.law-index-source');assert.equal(await link.getAttribute('href'),proof.path);
    const response=await context.request.get(new URL(proof.path,base).href);assert(response.ok());
    const text=await response.text();assert.equal(Array.from(text).slice(proof.start,proof.end).join(''),proof.quote_original);
    assert.equal(Array.from(text).slice(proof.heading.start,proof.heading.end).join(''),proof.heading.quote_original);
    if(proof.edition_continuation){const ed=proof.edition_continuation;assert.equal(await proofItem.locator('.law-index-edition').textContent(),typeof ed==='string'?ed:(ed.quote_original || ed.quote || ed.line));}
   }else{
    await proofItem.locator('.law-proof-source').click();await exact(row,proof);
    await page.reload();await exact(row,proof);await returned(row);
   }
   await open(row);await page.reload();await exact(row);await returned(row);
   checked.push({kind,id:row.id});
  }
  const legacy=data.citations.find(r=>r.verification_status==='legacy_unverified');assert(legacy);
  await listing(legacy.code,legacy.decision_id);
  const legacyItem=page.locator('.law-citation[data-law-id="'+legacy.id+'"]');
  assert((await legacyItem.locator('.law-status').textContent()).includes('отдельно не проверен'));
  await open(legacy);await exact(legacy);await returned(legacy);

  for(const year of [1896,1897,1904,1905]){
   const row=fresh.find(r=>r.year===year && r.field==='text' && r.scans.length) || data.citations.find(r=>r.year===year && r.field==='text' && r.scans.length);
   assert(row,'Нет доступного источника тома '+year);
   await listing(row.code,String(year));
   await open(row);await page.locator('.detail-scans > summary').click();await page.waitForSelector('.detail-scans .scan-figure');
   assert.deepEqual(await page.locator('.detail-scans .scan-figure').evaluateAll(xs=>xs.map(x=>x.dataset.source)),row.scans.map(s=>s.file));
   assert((await page.locator('.detail-scans .scan-figure').first().textContent()).includes(row.printed_pages.length?String(row.printed_pages[0]):'не определ'));
   const image=page.locator('.detail-scans img').first();await image.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>{const i=document.querySelector('.detail-scans img');return i&&i.complete&&i.naturalWidth>0;});
   assert((await image.getAttribute('src')).endsWith(row.scans[0].full));
   await page.locator('.detail-scans .scan-open').first().click();await page.waitForSelector('.scan-dialog[open]');
   await page.waitForFunction(()=>{const i=document.querySelector('.scan-dialog img');return i&&i.complete&&i.naturalWidth>0;});
   await page.keyboard.press('Escape');await returned(row);checked.push({year,id:row.id});
  }
  const headnote=all.find(r=>r.field==='headnote') || all.find(r=>(r.occurrences || []).some(o=>o.field==='headnote'));
  assert(headnote,'Нужна проверка смещений заголовка');
  if(headnote.field==='headnote'){await open(headnote);await page.reload();await exact(headnote);}
  else{
   const span=headnote.occurrences.find(o=>o.field==='headnote'),params=new URLSearchParams(headnote.passage_url.split('?')[1]);
   params.set('at',String(span.start));params.set('end',String(span.end));params.set('field','headnote');
   await page.goto(base+'#/d/'+headnote.decision_id+'?'+params);await exact(headnote,span);
   await page.reload();await exact(headnote,span);
  }
  await returned(headnote);
  const warned=all.find(r=>r.source_warning),noted=all.find(r=>r.attribution_note);
  for(const row of new Set([warned,noted].filter(Boolean))){await open(row);await exact(row);await returned(row);}

  // Existing mode=laws links pointed to a complete passage and have no law row ID.
  const oldRow=data.citations.find(r=>r.passage_id && r.field==='text'),passages=JSON.parse(fs.readFileSync(path.join(lex,`data/passages-${oldRow.year}.json`),'utf8'));
  const oldPassage=passages.passages.find(p=>p.id===oldRow.passage_id);assert(oldPassage);
  const oldParams=new URLSearchParams({mode:'laws',c:oldRow.code,q:oldRow.article,at:String(oldPassage.start),end:String(oldPassage.end)});
  await page.goto(base+'#/d/'+oldRow.decision_id+'?'+oldParams);await page.waitForSelector('#passage-target');
  const texts=JSON.parse(fs.readFileSync(path.join(lex,`data/text-${oldRow.year}.json`),'utf8'));
  const d=meta.decisions.filter(d=>d.vol===oldRow.year).findIndex(d=>d.id===oldRow.decision_id);
  assert.equal((await page.locator('.passage-focus').allTextContents()).join('\n\n'),Array.from(texts[d]).slice(oldPassage.start,oldPassage.end).join(''));
  await page.click('#detail-close');

  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});
  for(const [c,q] of [['',''],['?',''],[fresh[0].code,fresh[0].decision_id]]){
   await listing(c,q);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Мобильное переполнение каталога');
  }
  await listing('?');await page.screenshot({path:path.join(out,'laws-unknown-mobile-dark.png')});
  await open(fresh[0]);await page.locator('.law-detail .law-evidence > summary').first().click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('#detail').scrollWidth<=innerWidth),'Мобильное переполнение карточки');
  await page.locator('.law-detail').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'laws-proof-mobile-dark.png')});
  const offline=await browser.newContext(),op=await offline.newPage(),offlineRequests=[];
  await offline.route('http**://**',r=>r.abort());
  op.on('pageerror',e=>errors.push(e.message));op.on('request',r=>offlineRequests.push(r.url()));
  const file='file://'+path.join(lex,'dist/senat-lex.html');
  await op.goto(file+'#/laws?c=%3F');await op.waitForSelector('.law-citation');
  assert.equal(await op.locator('.law-citation').count(),80);
  const indexed=data.citations.find(r=>proofs(r).some(p=>p.kind==='printed_index'));
  await op.goto(file+indexed.passage_url);await op.waitForSelector('.law-detail');
  await op.locator('.law-detail .law-evidence > summary').click();
  const href=await op.locator('.law-detail .law-index-source').first().getAttribute('href');
  assert(href.startsWith('https://ivseliv.github.io/senat/lex/legislation-indexes/'));
  assert(!offlineRequests.some(u=>/\/data\//.test(u)),'Офлайн-указатель использует встроенные данные');
  await offline.close();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({version:data.version,fresh:fresh.length,remainingUnknown:data.unresolved.length,checked,
   checkedFeatures:'буквальные основания, прямые/повторные/печатные привязки, заголовки, старые ссылки, точные цитаты, четыре тома и сканы, поиск/пагинация/перезагрузка/возврат, тёмная тема и телефон',errors,screenshots:out},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
