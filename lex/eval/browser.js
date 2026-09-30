/* Проверка реального Chromium. NODE_PATH указывает на установленный Playwright. */
const { chromium }=require('playwright');
const assert=require('node:assert/strict'), path=require('path'), fs=require('fs');
const base=process.env.LEX_TEST_URL || 'http://127.0.0.1:8765/';
const out=process.env.LEX_SCREENSHOTS || path.resolve(__dirname,'../../work/browser');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>requests.push(r.url()));
  // Шрифт не нужен для функциональных проверок; внешние запросы не выполняются.
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await page.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.goto(base); await page.waitForSelector('#view-search:not([hidden])');
  assert(!requests.some(r=>r.includes('passages-')),'Индекс пассажей должен загружаться только по запросу режима');
  await page.click('#tab-sense'); await page.fill('#sense-q','фиктивные сделки');
  await page.click('#sense-form button[type=submit]');
  await page.waitForSelector('.passage');
  assert.equal(await page.locator('.passage').first().getAttribute('data-passage').then(x=>x.slice(0,8)),'1905-105');
  const original=await page.locator('.passage-text').first().innerText();
  assert(/[ѣіъ]/.test(original)); assert(await page.locator('.passage mark').count()>0);
  assert((await page.locator('.passage').first().innerText()).includes('Пояснение ИИ'));
  assert((await page.locator('.passage').first().innerText()).includes('с. 286'));
  await page.screenshot({path:path.join(out,'desktop.png'),fullPage:false});
  await page.locator('.passage a').first().click();
  await page.waitForSelector('#passage-target');
  assert((await page.locator('#detail-body h2').innerText()).includes('№ 105'));
  const focused=await page.locator('#passage-target').innerText();
  assert(original.includes(focused),'Открытое место должно быть частью показанного первоисточника');
  assert(await page.evaluate(()=>document.activeElement.id==='passage-target'));
  const detailURL=page.url();
  await page.screenshot({path:path.join(out,'detail.png'),fullPage:false});
  await page.reload(); await page.waitForSelector('#passage-target');
  assert((await page.locator('#passage-target').innerText()).length>0,'Прямая ссылка должна работать после перезагрузки');
  await page.click('#detail-close'); await page.waitForSelector('#view-sense:not([hidden])');
  assert.equal(await page.locator('#sense-q').inputValue(),'фиктивные сделки');
  await page.check('input[name=sense-orth][value=new]');
  await page.waitForFunction(()=>!/[ѣі]/.test(document.querySelector('.passage-text').textContent));
  await page.reload(); await page.waitForSelector('.passage');
  assert(await page.isChecked('input[name=sense-orth][value=new]'));
  await page.check('input[name=sense-orth][value=old]');
  await page.fill('#sense-q','неосновательное обогащение');await page.click('#sense-form button[type=submit]');
  await page.waitForFunction(()=>document.querySelector('#sense-status').textContent.includes('понятия: неосновательное обогащение') && document.querySelector('.passage[data-passage^="1905-107"]'));
  await page.waitForSelector('.passage mark');
  await page.fill('#sense-q','электронная подпись');await page.click('#sense-form button[type=submit]');
  await page.waitForSelector('#sense-results .empty');
  assert((await page.locator('#sense-results').innerText()).includes('не найдены'));
  // Старый поиск и аналитика продолжают работать.
  await page.click('#tab-search'); await page.fill('#q','давность');await page.click('#form button[type=submit]');
  await page.waitForSelector('#results .card');
  await page.click('#tab-analytics');await page.waitForSelector('.kpi');
  // Новый том: фильтр, составная дата, конец решения и ссылка на пассаж.
  const metadata=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/meta.json'),'utf8'));
  if(metadata.volumes.some(v=>v.year===1904)) {
   await page.goto(base+'#/search?y=1904');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('120'));
   assert.equal(await page.locator('#f-year').inputValue(),'1904');
   assert((await page.locator('#corpus-summary').innerText()).includes('235'));
   await page.goto(base+'#/d/1904-042');await page.waitForSelector('#detail-body h2');
   const date42=await page.locator('#detail-body').innerText();
   assert(date42.includes('1903/₄ года декабря 17 / февраля 11'));
   assert((await page.locator('#detail-body h2').innerText()).includes('№ 42'));
   await page.goto(base+'#/d/1904-120');await page.waitForSelector('#detail-body h2');
   assert((await page.locator('#detail-body').innerText()).includes('контръ-кассацію'));
   await page.goto(base+'#/sense?q='+encodeURIComponent('вред от диких животных'));
   await page.waitForSelector('.passage[data-passage^="1904-069"]');
   assert(await page.locator('.passage mark').count()>0);
   await page.locator('.passage[data-passage^="1904-069"] a').first().click();
   await page.waitForSelector('#passage-target');assert((await page.locator('#detail-body h2').innerText()).includes('№ 69'));
   await page.reload();await page.waitForSelector('#passage-target');
   await page.goto(base+'#/about');await page.waitForSelector('#corpus-table tbody tr');
   assert((await page.locator('#corpus-table').innerText()).includes('7 из 636'));
   await page.screenshot({path:path.join(out,'corpus.png'),fullPage:false});
  }
  // Телефон и тёмная тема, без горизонтальной прокрутки.
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/sense?q='+encodeURIComponent('фиктивные сделки'));await page.waitForSelector('.passage');
  await page.click('#theme');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'mobile-dark.png'),fullPage:false});
  await page.locator('.passage a').first().click();await page.waitForSelector('#passage-target');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'mobile-detail.png'),fullPage:false});
  // Самодостаточный HTML открывается с диска без запросов данных.
  const standalone=await context.newPage(),standaloneRequests=[];
  standalone.on('request',r=>standaloneRequests.push(r.url()));
  standalone.on('pageerror',e=>errors.push(e.message));
  await standalone.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await standalone.goto('file://'+path.resolve(__dirname,'../dist/senat-lex.html')+'#/sense?q='+encodeURIComponent('фиктивные сделки'));
  await standalone.waitForSelector('.passage');
  assert(!standaloneRequests.some(r=>/\/data\//.test(r)));
  assert.deepEqual(errors,[],'В консоли не должно быть ошибок');
  console.log(JSON.stringify({checked:'desktop, mobile, dark, highlights, original, orthography persistence, source anchor, deep link, empty answer, old search, analytics, standalone',consoleErrors:errors,detailURL,screenshots:out},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
