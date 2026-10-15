/* Настоящий Chromium: три сравнения, все выбранные дела и страницы цитат. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const lex=path.resolve(__dirname,'..'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8774/';
const out=process.env.LEX_SCREENSHOTS||path.resolve(lex,'../../comparative-guides-2026-10/browser');
fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(lex,'data/guides.json'),'utf8'));
const link=(g,e)=>base+'#/d/'+e.decision+'?'+new URLSearchParams({mode:'guides',g:g.id,at:e.start,end:e.end});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'});
 const errors=[],scans=[];
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  page.setDefaultTimeout(30000);
  if(process.env.LEX_TEST_SCAN_URL)await context.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('pageerror',e=>errors.push(e.message));
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  page.on('request',r=>{if(/\/scans\//.test(r.url()))scans.push(r.url());});
  await page.goto(base+'#/guides');await page.waitForSelector('.guide');
  assert.equal(await page.locator('.guide').count(),3);
  assert.equal(await page.locator('.guide-comparison').count(),0);
  assert.equal(scans.length,0,'Обзор тем не должен загружать сканы');
  await page.screenshot({path:path.join(out,'themes-desktop.png')});
  let checked=0;
  for(const g of data.guides){
   const comp=g.comparison;
   await page.goto(base+'#/guides?g='+g.id);await page.waitForSelector('.guide-comparison');
   await page.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,g.id);
   assert.equal(await page.locator('.comparison-case').count(),comp.cases.length);
   assert.equal(await page.locator('.guide-contrast').count(),comp.comparisons.length);
   const expected=[...comp.comparisons.flatMap(c=>c.evidence),...comp.cases.flatMap(c=>c.sections.flatMap(s=>s.evidence))];
   assert.deepEqual(await page.locator('.guide-comparison .source-quote').allTextContents(),expected.map(e=>e.text));
   assert((await page.locator('.comparison-limits').innerText()).includes(comp.limits));
   await page.locator('.guide-reading > summary').click();await page.waitForSelector('.guide-group');
   assert.equal(await page.locator('.guide-group li').count(),g.groups.flatMap(x=>x.decisions).length);
   await page.locator('.guide-reading > summary').click();
   for(const c of comp.cases){
    const ev=c.sections.flatMap(s=>s.evidence).find(e=>e.scans.length===1)||c.sections[0].evidence[0];
    await page.goto(link(g,ev));
    await page.waitForFunction(text=>[...document.querySelectorAll('.passage-focus')].map(x=>x.textContent).join('\n\n')===text,ev.text);
    assert.equal(await page.locator('#tab-guides').getAttribute('aria-current'),'page');
    assert.equal(await page.locator('.scan-figure').count(),0);
    await page.locator('.detail-scans > summary').click();await page.waitForSelector('.detail-scans .scan-figure');
    assert.deepEqual(await page.locator('.detail-scans .scan-figure').evaluateAll(xs=>xs.map(x=>x.dataset.source)),ev.scans.map(s=>s.file));
    const image=page.locator('.detail-scans img').first();await image.scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{const img=document.querySelector('.detail-scans img');return img&&img.complete&&img.naturalWidth>0;});
    assert((await image.getAttribute('src')).endsWith(ev.scans[0].full));
    await page.locator('.detail-scans .scan-open').first().click();await page.waitForSelector('.scan-dialog');
    await page.waitForFunction(()=>{const img=document.querySelector('.scan-dialog img');return img&&img.complete&&img.naturalWidth>0;});
    assert((await page.locator('.scan-dialog img').getAttribute('src')).endsWith(ev.scans[0].full));
    await page.keyboard.press('Escape');await page.reload();
    await page.waitForFunction(text=>[...document.querySelectorAll('.passage-focus')].map(x=>x.textContent).join('\n\n')===text,ev.text);
    await page.click('#detail-close');await page.waitForURL('**/#/guides?g='+g.id);
    await page.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,g.id);
    checked++;
   }
  }
  const g=data.guides[0],all=[...g.comparison.comparisons.flatMap(c=>c.evidence),...g.comparison.cases.flatMap(c=>c.sections.flatMap(s=>s.evidence))];
  const note=all.find(e=>e.editorial_note);assert(note);
  await page.goto(link(g,note));await page.waitForSelector('#detail-body > .editorial-note');
  assert.equal(await page.locator('#detail-body > .editorial-note').textContent(),note.editorial_note);
  await page.click('#detail-close');await page.waitForSelector('.guide-comparison');
  const evidence=data.guides.flatMap(guide=>[...guide.comparison.comparisons.flatMap(c=>c.evidence),...guide.comparison.cases.flatMap(c=>c.sections.flatMap(s=>s.evidence))].map(e=>({guide,e})));
  const crossing=evidence.find(x=>!x.e.passage_id),multipage=evidence.find(x=>x.e.scans.length>1);
  assert(crossing);assert(multipage);
  for(const {guide,e} of [crossing,multipage]){
   await page.goto(link(guide,e));
   await page.waitForFunction(text=>[...document.querySelectorAll('.passage-focus')].map(x=>x.textContent).join('\n\n')===text,e.text);
   await page.locator('.detail-scans > summary').click();await page.waitForSelector('.detail-scans .scan-figure');
   assert.deepEqual(await page.locator('.detail-scans .scan-figure').evaluateAll(xs=>xs.map(x=>x.dataset.source)),e.scans.map(s=>s.file));
  }
  await page.click('#detail-close');await page.waitForSelector('.guide-comparison');
  await page.setViewportSize({width:390,height:844});await page.click('#theme');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  for(const guide of data.guides){
   await page.goto(base+'#/guides?g='+guide.id);await page.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,guide.id);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Мобильный экран: '+guide.id);
  }
  await page.goto(base+'#/guides?g='+g.id);await page.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,g.id);
  await page.screenshot({path:path.join(out,'comparison-mobile-dark.png')});
  await page.goto(base+'#/guides?g=unknown');await page.waitForSelector('#guides-results .empty');
  assert.equal(await page.locator('.guide').count(),0);
  // Офлайн-тексты работают при запрете любых сетевых запросов.
  const offline=await browser.newContext({viewport:{width:390,height:844}}),op=await offline.newPage(),requests=[];
  op.on('pageerror',e=>errors.push(e.message));op.on('request',r=>requests.push(r.url()));
  await offline.route('http**://**',r=>r.abort());
  await op.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/guides?g='+g.id);
  await op.waitForSelector('.guide-comparison');assert.equal(await op.locator('.comparison-case').count(),2);
  await op.goto('file://'+path.join(lex,'dist/senat-lex.html')+link(g,note).slice(base.length));
  await op.waitForSelector('#passage-target');
  assert.equal((await op.locator('.passage-focus').allTextContents()).join('\n\n'),note.text);
  assert(!requests.some(url=>/\/data\//.test(url)));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({themes:3,cases:checked,checked:'буквальные цитаты, исходные страницы восьми дел, полная картинка, прямые ссылки/перезагрузка/возврат, многостраничная цитата, примечание, мобильная/тёмная тема, списки чтения и офлайн-текст',errors,screenshots:out},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
