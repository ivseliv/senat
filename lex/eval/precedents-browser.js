/* Настоящий Chromium: департаменты, входящие/исходящие ссылки, цитаты и сканы. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.LEX_TEST_URL || 'http://127.0.0.1:8771/';
const out=process.env.LEX_SCREENSHOTS || path.resolve(__dirname,'../../work/precedents-browser');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.LEX_CHROMIUM?{executablePath:process.env.LEX_CHROMIUM}:{})});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[],requests=[];
  if(process.env.LEX_TEST_SCAN_URL)await context.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
  await page.goto(base);await page.waitForSelector('#view-search:not([hidden])');assert(!requests.some(u=>u.includes('/precedents.json')));
  const open=async id=>{await page.goto(base+'?audit='+id+'#/d/'+id);await page.waitForSelector('.precedents-out');};
  const bad=[['1904-074',1897,20],['1904-079',1896,42],['1905-074',1904,22],['1905-074',1904,23],
    ['1905-075',1904,21],['1905-092',1904,1],['1905-094',1896,25],['1905-102',1897,29]];
  for(const [id,year,num] of bad){
   await open(id);const row=page.locator(`.precedents-out li[data-precedent-year="${year}"][data-precedent-number="${num}"]`).first();
   assert.equal(await row.getAttribute('data-precedent-status'),'not_in_corpus');assert.equal(await row.locator('.precedent-target').count(),0);
   assert((await row.innerText()).includes('нет в корпусе'));assert(await row.locator('.precedent-context').count()>0);
  }
  await open('1904-079');let source=page.locator('.precedents-out li[data-precedent-year="1896"][data-precedent-number="42"]');
  await source.locator('.precedent-source').first().click();await page.waitForSelector('#passage-target');assert(page.url().includes('mode=precedent'));
  assert((await page.locator('#passage-target').innerText()).includes('гр. касс. деп. 1896 г. № 42'));
  await page.reload();await page.waitForSelector('#passage-target');
  await page.locator('.detail-scans > summary').click();await page.waitForSelector('.detail-scans .scan-open');
  const file=await page.locator('.detail-scans .scan-figure').first().getAttribute('data-source');assert(file);
  await page.locator('.detail-scans .scan-open').first().click();await page.waitForSelector('.scan-dialog');
  await page.waitForFunction(()=>{const img=document.querySelector('.scan-dialog img');return img&&img.complete&&img.naturalWidth>0;});await page.keyboard.press('Escape');
  await open('1897-073');await page.locator('.precedents-out .precedent-target[href="#/d/1896-031"]').click();
  await page.waitForSelector('.precedents-in');assert((await page.locator('#detail-body h2').innerText()).includes('№ 31'));
  const backlink=page.locator('.precedents-in .precedent-incoming[href*="1897-073"]');assert.equal(await backlink.count(),1);
  await backlink.click();await page.waitForSelector('#passage-target');assert((await page.locator('#detail-body h2').innerText()).includes('№ 73'));
  await open('1905-064');const unknown=page.locator('.precedents-out li[data-precedent-year="1897"][data-precedent-number="65"]');
  assert.equal(await unknown.getAttribute('data-precedent-status'),'department_unknown');assert.equal(await unknown.locator('.precedent-target').count(),0);
  await open('1905-075');const trailing=page.locator('.precedents-out li[data-precedent-year="1904"][data-precedent-number="21"]');
  assert((await trailing.innerText()).includes('Общее собрание'));assert((await trailing.locator('.precedent-context').first().innerText()).includes('по общ. собранію'));
  await page.setViewportSize({width:390,height:844});await page.click('#detail-close');await page.click('#theme');
  await open('1905-075');await page.locator('.precedents-out').evaluate(el=>el.scrollIntoView({block:'start'}));
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && document.querySelector('#detail').scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(out,'department-mobile-dark.png')});
  await page.locator('#detail-body .seg-b').filter({hasText:'Современная'}).click();
  await page.waitForFunction(()=>!/[ѣі]/.test(document.querySelector('.precedents-out blockquote').textContent));
  const unavailable=await context.newPage();unavailable.on('pageerror',e=>errors.push(e.message));
  await unavailable.route('**/data/precedents.json',r=>r.fulfill({status:503,body:'{}',contentType:'application/json'}));
  await unavailable.goto(base+'?outage=1#/d/1904-079');await unavailable.waitForSelector('.precedents-unavailable');
  assert((await unavailable.locator('#detail-body .text').innerText()).length>500);
  await unavailable.unroute('**/data/precedents.json');await unavailable.click('#precedents-retry');
  await unavailable.waitForSelector('.precedents-out');assert.equal(await unavailable.locator('.precedents-unavailable').count(),0);
  const offline=await context.newPage(),network=[];offline.on('pageerror',e=>errors.push(e.message));offline.on('request',r=>network.push(r.url()));
  await offline.goto('file://'+path.resolve(__dirname,'../dist/senat-lex.html')+'#/d/1897-073');
  await offline.waitForSelector('.precedent-target[href="#/d/1896-031"]');assert(!network.some(u=>/\/data\//.test(u)));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checked:'8 ошибочных связей, отсутствие угадывания, подтверждённая связь/обратный переход, цитата и перезагрузка, реальный скан, телефон/тёмная тема, орфография, ленивые данные, офлайн HTML',errors,screenshots:out},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
