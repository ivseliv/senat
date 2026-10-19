/* Настоящий Chromium: разборы, точные цитаты/страницы, предупреждения и офлайн. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const lex=path.resolve(__dirname,'..'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8772/';
const out=process.env.LEX_SCREENSHOTS||path.resolve(lex,'../../explanations-2026-10/browser');fs.mkdirSync(out,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(path.join(lex,'data',name),'utf8'));
(async()=>{
 const data=read('decision-analyses.json'),errors=[],requests=[];
 assert.equal(data.count,384);
 const totals={1896:49,1897:100,1904:120,1905:115};
 const browser=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  page.on('request',r=>requests.push(r.url()));
  if(process.env.LEX_TEST_SCAN_URL)await context.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  for(const e of ['console','pageerror'])page.on(e,m=>{if(e==='pageerror'||m.type()==='error')errors.push(e==='pageerror'?m.message:m.text());});
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.goto(base+'#/analyses');await page.waitForSelector('.analysis-card');
  assert.equal(await page.locator('.analysis-card').count(),384);
  assert((await page.locator('#analyses-status').innerText()).includes('384 из 384'));
  assert(!(await page.locator('#analyses-status').innerText()).includes('пока отсутствует'));
  assert(!requests.some(url=>/\/data\/(?:decision-analyses\.json|analyses\/)/.test(url)),'Каталог не загружает полные разборы');
  for(const year of [1896,1897,1904,1905]){
   await page.selectOption('#analyses-year',String(year));
   await page.waitForFunction(({y,n})=>document.querySelectorAll('.analysis-card h3').length===n&&[...document.querySelectorAll('.analysis-card h3')].every(x=>x.textContent.startsWith(y)),{y:String(year),n:totals[year]});
   assert.equal(await page.locator('.analysis-card').count(),totals[year]);
  }
  await page.goto(base+'#/analyses');await page.waitForSelector('.analysis-card');
  await page.screenshot({path:path.join(out,'analyses-desktop.png')});
  for(const id of ['1896-002','1897-006','1904-013','1905-041','1896-016','1897-014','1904-005','1905-001']){
   await page.goto(base+'#/d/'+id+'?mode=analyses');await page.waitForSelector('.decision-analysis');
   assert.equal(await page.locator('.analysis-item').count(),7);
   const quotes=await page.locator('.source-quote').allTextContents();
   assert.deepEqual(quotes,data.decisions[id].sections.flatMap(s=>s.evidence.map(e=>e.text)));
   assert.equal(await page.locator('.analysis-label').textContent(),'Редакционный разбор, подготовленный с помощью ИИ');
  }
  assert(!requests.some(url=>/\/data\/decision-analyses\.json/.test(url)),'Веб-карточки не загружают весь набор');
  assert(requests.some(url=>/\/data\/analyses\/1905-001\.json\?v=[a-f0-9]{64}/.test(url)),'Отдельный разбор запрошен с точной версией');
  // Регрессия: первая страница пассажа может не быть страницей цитаты.
  let selected;
  for(const doc of Object.values(data.decisions)){
   const scans=read('scans-'+doc.year+'.json');
   for(const ev of doc.sections.flatMap(s=>s.evidence)){
    const old=ev.passage_id&&scans.passages[ev.passage_id];
    if(old&&old[0]&&old[0].file!==ev.scans[0].file){selected={doc,ev};break;}
   }
   if(selected)break;
  }
  assert(selected,'Нужен настоящий пример цитаты на следующей странице пассажа');
  const {doc,ev}=selected,link=base+'#/d/'+doc.id+'?'+new URLSearchParams({mode:'analysis',at:ev.start,end:ev.end});
  await page.goto(link);await page.waitForSelector('#passage-target');
  const focused=(await page.locator('.passage-focus').allTextContents()).join('\n\n');
  assert.equal(focused,ev.text);
  await page.locator('.detail-scans > summary').click();await page.waitForSelector('.detail-scans .scan-figure');
  assert.deepEqual(await page.locator('.detail-scans .scan-figure').evaluateAll(xs=>xs.map(x=>x.dataset.source)),ev.scans.map(s=>s.file));
  const image=page.locator('.detail-scans img').first();await image.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const img=document.querySelector('.detail-scans img');return img&&img.complete&&img.naturalWidth>0;});
  assert((await image.getAttribute('src')).endsWith(ev.scans[0].full));
  await page.locator('.detail-scans .scan-open').first().click();await page.waitForSelector('.scan-dialog');
  await page.waitForFunction(()=>{const img=document.querySelector('.scan-dialog img');return img&&img.complete&&img.naturalWidth>0;});
  assert((await page.locator('.scan-dialog img').getAttribute('src')).endsWith(ev.scans[0].full));await page.keyboard.press('Escape');
  await page.reload();await page.waitForSelector('#passage-target');
  const crossing=Object.values(data.decisions).flatMap(d=>d.sections.flatMap(s=>s.evidence.map(e=>({d,e})))).find(x=>!x.e.passage_id&&x.e.scans.length>1);
  assert(crossing,'Нужна настоящая цитата, пересекающая границы пассажей');
  await page.goto(base+'#/d/'+crossing.d.id+'?'+new URLSearchParams({mode:'analysis',at:crossing.e.start,end:crossing.e.end}));
  await page.waitForSelector('#passage-target');
  assert.equal((await page.locator('.passage-focus').allTextContents()).join('\n\n'),crossing.e.text);
  await page.locator('.detail-scans > summary').click();await page.waitForSelector('.detail-scans .scan-figure');
  assert.deepEqual(await page.locator('.detail-scans .scan-figure').evaluateAll(xs=>xs.map(x=>x.dataset.source)),crossing.e.scans.map(s=>s.file));
  const mobileLink=page.url();await page.click('#detail-close');
  await page.setViewportSize({width:390,height:844});await page.click('#theme');
  await page.goto(mobileLink);await page.waitForSelector('.decision-analysis');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.decision-analysis').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'analysis-mobile-dark.png')});
  const warning=Object.keys(totals).flatMap(y=>read('passages-'+y+'.json').passages).find(p=>p.ai&&p.ai.source_warning);
  if(warning){
   await page.goto(base+'#/d/'+warning.decision+'?'+new URLSearchParams({mode:'passage',at:warning.start,end:warning.end}));
   await page.waitForSelector('#detail-body > .source-warning');
   assert((await page.locator('#detail-body > .source-warning').innerText()).includes(warning.ai.source_warning));
   await page.goto(base+'#/d/'+warning.decision);await page.waitForSelector('#detail-body > details.source-warning');
   await page.locator('#detail-body > details.source-warning > summary').click();
   assert((await page.locator('#detail-body > .source-warning').innerText()).includes(warning.ai.source_warning));
  }else{
   // После реставрации прежние предупреждения о колонках больше не актуальны.
   // Остаточный обрыв OCR отмечен в новом разборе, а не скрыт старой меткой.
   await page.goto(base+'#/d/1896-001?mode=analyses');await page.waitForSelector('.decision-analysis');
   assert(/OCR|распознан/i.test(await page.locator('.decision-analysis').innerText()));
  }
  await page.goto(base+'#/analyses?y=1896');await page.waitForSelector('.analysis-card');
  assert.equal(await page.locator('.analysis-card').count(),49);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Ошибка отдельного файла или его версии не закрывает доступ к оригиналу.
  for(const failure of ['404','hash']){
   const failed=await browser.newContext(),fp=await failed.newPage(),failureErrors=[];
   fp.on('pageerror',e=>failureErrors.push(e.message));
   await failed.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
   const pattern='**/data/analyses/1905-027.json*';
   await failed.route(pattern,r=>r.fulfill({status:failure==='404'?404:200,contentType:'application/json',body:failure==='404'?'{}':JSON.stringify({...data.decisions['1905-027'],sections:[]})}));
   await fp.goto(base+'#/d/1905-027?mode=analyses');await fp.waitForSelector('.analysis-unavailable');
   assert.equal(await fp.locator('.decision-analysis').count(),0,'Непроверенный разбор не показан');
   assert((await fp.locator('#detail-body > .text').textContent()).length>500,'Оригинал доступен при ошибке разбора');
   await failed.unroute(pattern);await fp.click('#analysis-retry');await fp.waitForSelector('.decision-analysis');
   assert.equal(await fp.locator('.analysis-item').count(),7);assert.equal(await fp.locator('.analysis-unavailable').count(),0);
   assert.deepEqual(failureErrors,[]);await failed.close();
  }
  const offline=await context.newPage(),offlineRequests=[];offline.on('pageerror',e=>errors.push(e.message));offline.on('request',r=>offlineRequests.push(r.url()));
  await offline.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/analyses');await offline.waitForSelector('.analysis-card');
  assert.equal(await offline.locator('.analysis-card').count(),384);
  await offline.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/d/1904-013?mode=analyses');await offline.waitForSelector('.decision-analysis');
  assert.equal(await offline.locator('.analysis-item').count(),7);assert(!offlineRequests.some(url=>/\/data\//.test(url)));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({analyses:384,sections:2688,scanRegression:{decision:doc.id,start:ev.start,files:ev.scans.map(s=>s.file)},checked:'4 тома, полный каталог и фильтр, новые и прежние разборы, полные цитаты, Unicode-подсветка, страницы цитаты, полная картинка, прямые ссылки/перезагрузка, предупреждение, мобильный экран, тёмная тема, офлайн',errors,screenshots:out},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
