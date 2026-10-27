/* Реальный браузер: единые темы, поиск разборов, роли, цитаты и сохранение адреса. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const lex=path.resolve(__dirname,'..'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8770/';
const catalog=JSON.parse(fs.readFileSync(path.join(lex,'data/topic-catalog.json'),'utf8'));
const index=JSON.parse(fs.readFileSync(path.join(lex,'data/analysis-search.json'),'utf8'));
const family=catalog.topics.find(t=>t.id==='family').decision_ids.slice().sort();
const url=(view,params={})=>base+'#/'+view+'?'+new URLSearchParams(params);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'});
 const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(30000);
  await page.route('https://fonts.googleapis.com/**',route=>route.fulfill({status:200,contentType:'text/css',body:''}));
  page.on('pageerror',error=>errors.push(error.message));
  async function visit(view,params,selector){await page.goto('about:blank');await page.goto(url(view,params));await page.waitForSelector(selector);}
  for(const q of ['алименты','алиментов']){
   await visit('guides',{q},'.topic-card');
   assert.deepEqual(await page.locator('.topic-card').evaluateAll(xs=>xs.map(x=>x.dataset.topic)),['family']);
  }
  for(const q of ['купля-продажа','купля продажа']){
   await visit('guides',{q},'.topic-card');assert(await page.locator('.topic-card[data-topic="contracts"]').count());
  }
  await visit('guides',{g:'family',catalog:'1',q:'алиментов'},'.catalog-case');
  assert(await page.locator('.catalog-case[data-id="1904-116"]').count());
  for(const t of ['family','Семья и брак']){
   await visit('search',{t},'#results .card');
   await page.waitForFunction(()=>document.querySelector('#status strong')?.textContent==='27 решений');
   assert.equal(await page.locator('#f-topic').inputValue(),'family');
   await page.click('#more');await page.waitForFunction(()=>document.querySelectorAll('#results .card').length===27);
   assert.deepEqual((await page.locator('#results .card').evaluateAll(xs=>xs.map(x=>x.dataset.id))).sort(),family);
  }
  await visit('map',{t:'Семья и брак'},'[data-map-node="decisions"]');
  assert((await page.locator('#map-status').textContent()).startsWith('27 решений'));
  assert.deepEqual((await page.locator('[data-map-node="decisions"] li > a').evaluateAll(xs=>xs.map(a=>a.hash.match(/d\/(\d{4}-\d{3})/)[1]))).sort(),family);
  await visit('sense',{t:'family'},'#sense-results .card');
  assert.deepEqual((await page.locator('#sense-results .card').evaluateAll(xs=>xs.map(x=>x.dataset.id))).sort(),family);
  await visit('analyses',{t:'family'},'.analysis-card');
  assert((await page.locator('#analyses-status').textContent()).includes('Найдено 27 решений'));
  while(await page.locator('#analyses-more').isVisible()){
   const before=await page.locator('.analysis-card').count();await page.click('#analyses-more');
   await page.waitForFunction(n=>document.querySelectorAll('.analysis-card').length>n,before);
  }
  assert.deepEqual([...new Set(await page.locator('.analysis-card').evaluateAll(xs=>xs.map(x=>x.dataset.id)))].sort(),family);
  for(const year of ['1896','1897','1904','1905']){
   await visit('analyses',{y:year,kind:'reasoning'},'.analysis-card');
   assert.deepEqual(await page.locator('.analysis-card').evaluateAll(xs=>[...new Set(xs.map(x=>x.dataset.kind))]),['reasoning']);
   const card=page.locator('.analysis-card').first(),ident=await card.getAttribute('data-id');
   assert(ident.startsWith(year+'-'));
   const expected=await card.locator('.source-quote').first().textContent();
   await card.locator('.analysis-evidence > summary').first().click();
   await card.locator('.analysis-evidence a').first().click();await page.waitForSelector('#passage-target');
   assert.equal((await page.locator('.passage-focus').allTextContents()).join('\n\n'),expected);
   assert.equal(await page.locator('#tab-analyses').getAttribute('aria-current'),'page');
   await page.reload();await page.waitForSelector('#passage-target');
   assert.equal((await page.locator('.passage-focus').allTextContents()).join('\n\n'),expected);
   await page.click('#detail-close');await page.waitForSelector('.analysis-card');
   assert.equal(await page.locator('#analyses-year').inputValue(),year);
   assert.equal(await page.locator('#analyses-kind').inputValue(),'reasoning');
  }
  await visit('analyses',{q:'содержание ребёнка',t:'family',y:'1904',kind:'reasoning'},'.analysis-card[data-id="1904-116"]');
  const matched=page.locator('.analysis-card[data-id="1904-116"]');assert(await matched.locator('mark').count());
  await matched.locator('h3 a').click();await page.waitForSelector('#analysis-section-4');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'analysis-section-4');
  await page.click('#detail-close');await page.waitForSelector('#analyses-filter');
  await page.fill('#analyses-q','содержание');await page.locator('#analyses-filter button[type="submit"]').click();
  await page.waitForFunction(()=>new URLSearchParams(location.hash.split('?')[1]).get('q')==='содержание');
  await page.goBack();await page.waitForFunction(()=>document.querySelector('#analyses-q')?.value==='содержание ребёнка');
  await page.goForward();await page.waitForFunction(()=>document.querySelector('#analyses-q')?.value==='содержание');
  await page.locator('#analyses-filter a').click();await page.waitForFunction(()=>document.querySelector('#analyses-status')?.textContent.includes('Найдено 384 решения'));
  await page.selectOption('#analyses-kind','limits');await page.waitForFunction(()=>document.querySelectorAll('.analysis-card').length>0&&[...document.querySelectorAll('.analysis-card')].every(x=>x.dataset.kind==='limits'));
  await page.reload();await page.waitForSelector('.analysis-card[data-kind="limits"]');
  assert.equal(await page.locator('#analyses-kind').inputValue(),'limits');
  assert((await page.locator('.analysis-card .analysis-speaker').first().textContent()).includes('Редакционное пояснение'));
  await visit('search',{q:'Слиозберга'},'#results .card[data-id="1904-058"]');
  await page.waitForFunction(()=>[...document.querySelectorAll('#results .snip mark')].some(x=>x.textContent==='Слiозберга'));
  await page.locator('#results .card h3 a').first().click();await page.waitForSelector('#detail-body .search-ocr-note');
  assert((await page.locator('#detail-body .text mark').allTextContents()).includes('Слiозберга'));
  await visit('sense',{q:'Слиозберга'},'#sense-results .search-ocr-note');
  assert((await page.locator('#sense-results .passage-text mark').allTextContents()).includes('Слiозберга'));
  await page.locator('#sense-results .passage').first().locator('p.small > a').first().click();await page.waitForSelector('#passage-target');
  assert((await page.locator('.passage-focus mark').allTextContents()).includes('Слiозберга'));
  await page.locator('#detail-close').click();await page.waitForSelector('#sense-results .search-ocr-note');
  assert.equal(await page.locator('#sense-q').inputValue(),'Слиозберга');
  await visit('search',{q:'наслетство'},'#results .search-ocr-note');
  await page.waitForSelector('#results .snip mark');
  assert((await page.locator('#results .search-ocr-note').first().textContent()).includes('Исходный текст сохранён'));
  if(!(await page.locator('#search-ocr').isVisible()))await page.locator('#fbox > summary').click();
  await page.locator('#search-ocr').uncheck();
  await page.waitForFunction(()=>document.querySelector('#status strong')?.textContent==='0 решений');
  assert.equal(new URLSearchParams(page.url().split('?')[1]).get('ocr'),'0');
  await visit('sense',{q:'наслетство'},'#sense-results .search-ocr-note');
  assert(await page.locator('#sense-results .passage-text mark').count());
  await page.locator('#sense-ocr').uncheck();await page.waitForFunction(()=>document.querySelector('#sense-status strong')?.textContent==='0 фрагментов');
  await visit('sense',{q:'наследство -завещание'},'#sense-status .preliminary-note');
  assert((await page.locator('#sense-status .preliminary-note').textContent()).includes('не применяет отрицания'));
  for(const view of ['analyses','guides','sense','search','map']){
   await page.setViewportSize({width:390,height:844});await visit(view,view==='guides'?{g:'family',catalog:'1'}:{t:'family'},view==='analyses'?'.analysis-card':view==='guides'?'.catalog-case':view==='sense'?'#sense-results .card':view==='map'?'[data-map-node="decisions"]':'#results .card');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Мобильное переполнение: '+view);
   if(process.env.LEX_SCREENSHOTS){fs.mkdirSync(process.env.LEX_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.LEX_SCREENSHOTS,'editorial-'+view+'-mobile.png')});}
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({family:family.length,analyses:index.count,sections:index.section_count,checked:'словоформы/дефисы, состав тем, прежние URL, четыре тома, роли, точные цитаты, перезагрузка, фильтры и история, OCR-пометки/подсветка/отключение, предупреждение об операторах, мобильный экран',errors},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
