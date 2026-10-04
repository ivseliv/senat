/* Проверка реального Chromium. NODE_PATH указывает на установленный Playwright. */
const { chromium }=require('playwright');
const assert=require('node:assert/strict'), path=require('path'), fs=require('fs');
const base=process.env.LEX_TEST_URL || 'http://127.0.0.1:8765/';
const out=process.env.LEX_SCREENSHOTS || path.resolve(__dirname,'../../work/browser');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.LEX_CHROMIUM ? {executablePath:process.env.LEX_CHROMIUM} : {})});
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
  // Стабильная ссылка из исследовательского экспорта не зависит от поискового запроса.
  await page.goto(base+'#/d/1905-105?mode=passage&at=7281&end=9186'); await page.waitForSelector('#passage-target');
  assert((await page.locator('#detail-body h2').innerText()).includes('№ 105'));
  await page.click('#detail-close'); await page.waitForSelector('#view-sense:not([hidden])');
  assert.equal(await page.locator('#sense-q').inputValue(),'');
  await page.fill('#sense-q','фиктивные сделки'); await page.click('#sense-form button[type=submit]');
  await page.waitForSelector('.passage');
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
  // Прямые и комбинированные ссылки на социальные фильтры.
  await page.goto(base+'#/search?sex='+encodeURIComponent('Женщины'));
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('решени'));
  assert.equal(await page.locator('#f-gender').inputValue(),'Женщины');
  assert(await page.locator('#results .card').count()>0);
  assert(await page.locator('#results .chip.group').count()>0);
  await page.goto(base+'#/search?age='+encodeURIComponent('Малолетние'));
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('решени'));
  assert.equal(await page.locator('#f-age').inputValue(),'Малолетние');
  assert(await page.locator('#results .card').count()>0);
  await page.goto(base+'#/search?estate='+encodeURIComponent('Крестьяне')+'&entity='+encodeURIComponent('Банки и кредитные учреждения'));
  await page.waitForFunction(()=>!document.querySelector('#status').textContent.includes('Поиск…'));
  assert.equal(await page.locator('#f-estate').inputValue(),'Крестьяне');
  assert.equal(await page.locator('#f-entity').inputValue(),'Банки и кредитные учреждения');
  await page.reload(); await page.waitForSelector('#results .card');
  assert.equal(await page.locator('#f-estate').inputValue(),'Крестьяне');
  // Отдельные фильтры по коду акта и фокусу кассационного рассуждения.
  await page.goto(base+'#/search?c='+encodeURIComponent('УГС')+'&r='+encodeURIComponent('Доказательства'));
  await page.waitForSelector('#results .card');
  assert.equal(await page.locator('#f-code').inputValue(),'УГС');
  assert.equal(await page.locator('#f-procedure').inputValue(),'Доказательства');
  assert((await page.locator('#results').innerText()).includes('Доказательства'));
  await page.reload(); await page.waitForSelector('#results .card');
  assert.equal(await page.locator('#f-code').inputValue(),'УГС');
  assert.equal(await page.locator('#f-procedure').inputValue(),'Доказательства');
  // Указатели всех трёх томов: 1904/1905 пока честно показывают строку OCR,
  // а не кнопку на несуществующий скан страницы.
  await page.goto(base+'#/participants?y=1904&q='+encodeURIComponent('Алексакос'));
  await page.waitForSelector('#view-participants:not([hidden]) .participant-entry');
  assert((await page.locator('#participants-status').innerText()).includes('Записей: 1 · Решений: 1'));
  assert((await page.locator('#participants-results').innerText()).includes('Том 1904 · указатель · с. I — строка OCR'));
  assert.equal(await page.locator('.participant-source').count(),0);
  await page.goto(base+'#/participants?y=1905&q='+encodeURIComponent('Балкашин'));
  await page.waitForSelector('#view-participants:not([hidden]) .participant-entry');
  assert((await page.locator('#participants-results').innerText()).includes('№ 49'));
  assert((await page.locator('#participants-results').innerText()).includes('№ 55'));
  await page.reload(); await page.waitForSelector('#view-participants:not([hidden]) .participant-entry');
  assert.equal(await page.locator('#participants-year').inputValue(),'1905');
  // Юридическая карта: понятие ведёт к источнику, решениям, нормам и указателю.
  await page.goto(base+'#/map?q='+encodeURIComponent('фиктивные сделки'));
  await page.waitForSelector('#view-map:not([hidden]) [data-map-node="sources"]');
  assert((await page.locator('#map-status').innerText()).includes('решени'));
  assert.equal(await page.locator('#map-results [data-map-node]').count(),5);
  assert(await page.locator('[data-map-node="statutes"] .chip.stat').count()>0);
  await page.locator('[data-map-node="sources"] a').first().click();
  await page.waitForSelector('#passage-target');
  assert(page.url().includes('mode=map'));
  await page.reload(); await page.waitForSelector('#passage-target');
  await page.click('#detail-close'); await page.waitForSelector('#view-map:not([hidden]) [data-map-node="sources"]');
  assert.equal(await page.locator('#map-q').inputValue(),'фиктивные сделки');
  await page.goto(base+'#/map?t='+encodeURIComponent('Наследство и завещания'));
  await page.waitForSelector('#view-map:not([hidden]) [data-map-node="decisions"]');
  assert.equal(await page.locator('[data-map-node="sources"]').count(),0);
  await page.click('#tab-analytics');await page.waitForSelector('.kpi');
  assert((await page.locator('#analytics-body').innerText()).includes('Пол прямо указан'));
  // Новый том: фильтр, составная дата, конец решения и ссылка на пассаж.
  const metadata=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/meta.json'),'utf8'));
  if(metadata.volumes.some(v=>v.year===1904)) {
   await page.goto(base+'#/search?y=1904');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('120'));
   assert.equal(await page.locator('#f-year').inputValue(),'1904');
   assert((await page.locator('#corpus-summary').innerText()).includes('335'));
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
   assert(/636/.test(await page.locator('#corpus-table').innerText()));
   await page.screenshot({path:path.join(out,'corpus.png'),fullPage:false});
  }
  // 1897: современный запрос ведёт к исторической формулировке и прямой ссылке.
  if(metadata.volumes.some(v=>v.year===1897)) {
   await page.goto(base+'#/search?y=1897');
   await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('100'));
   assert.equal(await page.locator('#f-year').inputValue(),'1897');
   await page.goto(base+'#/sense?q='+encodeURIComponent('фиктивные требования кредиторов при банкротстве'));
   await page.waitForSelector('.passage[data-passage^="1897-006:30358-31945"]');
   assert(await page.locator('.passage[data-passage^="1897-006:30358-31945"] mark').count()>0);
   await page.locator('.passage[data-passage^="1897-006:30358-31945"] a').first().click();
   await page.waitForSelector('#passage-target');
   assert((await page.locator('#detail-body h2').innerText()).includes('№ 6'));
   await page.reload();await page.waitForSelector('#passage-target');
   await page.goto(base+'#/about');await page.waitForSelector('#corpus-table tbody tr');
   assert((await page.locator('#corpus-table').innerText()).includes('641 из 641'));
  }
  // Телефон и тёмная тема, без горизонтальной прокрутки.
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'#/map?q='+encodeURIComponent('фиктивные сделки'));await page.waitForSelector('[data-map-node="sources"]');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
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
  console.log(JSON.stringify({checked:'desktop, mobile, dark, highlights, original, orthography persistence, source anchor, deep links including export, empty answer, old search, analytics, standalone',consoleErrors:errors,detailURL,screenshots:out},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
