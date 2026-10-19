/* Настоящий Chromium: разборы, точные цитаты/страницы, предупреждения и офлайн. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const lex=path.resolve(__dirname,'..'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8772/';
const out=process.env.LEX_SCREENSHOTS||path.resolve(lex,'../../explanations-2026-10/browser');fs.mkdirSync(out,{recursive:true});
const read=name=>JSON.parse(fs.readFileSync(path.join(lex,'data',name),'utf8'));
(async()=>{
 const data=read('decision-analyses.json'),errors=[];
 assert.equal(data.count,40);
 const browser=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  if(process.env.LEX_TEST_SCAN_URL)await context.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  for(const e of ['console','pageerror'])page.on(e,m=>{if(e==='pageerror'||m.type()==='error')errors.push(e==='pageerror'?m.message:m.text());});
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.goto(base+'#/analyses');await page.waitForSelector('.analysis-card');
  assert.equal(await page.locator('.analysis-card').count(),40);
  assert((await page.locator('#analyses-status').innerText()).includes('40 из 384'));
  for(const year of [1896,1897,1904,1905]){
   await page.selectOption('#analyses-year',String(year));
   await page.waitForFunction(y=>document.querySelectorAll('.analysis-card h3').length===10&&[...document.querySelectorAll('.analysis-card h3')].every(x=>x.textContent.startsWith(y)),String(year));
   assert.equal(await page.locator('.analysis-card').count(),10);
  }
  await page.goto(base+'#/analyses');await page.waitForSelector('.analysis-card');
  await page.screenshot({path:path.join(out,'analyses-desktop.png')});
  for(const id of ['1896-002','1897-006','1904-013','1905-041']){
   await page.goto(base+'#/d/'+id+'?mode=analyses');await page.waitForSelector('.decision-analysis');
   assert.equal(await page.locator('.analysis-item').count(),7);
   const quotes=await page.locator('.source-quote').allTextContents();
   assert.deepEqual(quotes,data.decisions[id].sections.flatMap(s=>s.evidence.map(e=>e.text)));
   assert.equal(await page.locator('.analysis-label').textContent(),'Редакционный разбор, подготовленный с помощью ИИ');
  }
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
  const warning=read('passages-1896.json').passages.find(p=>p.ai&&p.ai.source_warning);
  await page.goto(base+'#/d/'+warning.decision+'?'+new URLSearchParams({mode:'passage',at:warning.start,end:warning.end}));
  await page.waitForSelector('#detail-body > .source-warning');
  assert((await page.locator('#detail-body > .source-warning').innerText()).includes(warning.ai.source_warning));
  await page.goto(base+'#/d/'+warning.decision);await page.waitForSelector('#detail-body > details.source-warning');
  await page.locator('#detail-body > details.source-warning > summary').click();
  assert((await page.locator('#detail-body > .source-warning').innerText()).includes(warning.ai.source_warning));
  await page.goto(base+'#/search?y=1896');await page.waitForSelector('.card[data-id="1896-014"] .source-warning');
  await page.goto(base+'#/analyses?y=1896');await page.waitForSelector('.analysis-card');
  assert.equal(await page.locator('.analysis-card').count(),10);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const offline=await context.newPage(),requests=[];offline.on('pageerror',e=>errors.push(e.message));offline.on('request',r=>requests.push(r.url()));
  await offline.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/analyses');await offline.waitForSelector('.analysis-card');
  assert.equal(await offline.locator('.analysis-card').count(),40);
  await offline.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/d/1904-013?mode=analyses');await offline.waitForSelector('.decision-analysis');
  assert.equal(await offline.locator('.analysis-item').count(),7);assert(!requests.some(url=>/\/data\//.test(url)));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({analyses:40,sections:280,scanRegression:{decision:doc.id,start:ev.start,files:ev.scans.map(s=>s.file)},checked:'4 тома, фильтр, полные цитаты, Unicode-подсветка, страницы цитаты, полная картинка, прямые ссылки/перезагрузка, предупреждение, мобильный экран, тёмная тема, офлайн',errors,screenshots:out},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
