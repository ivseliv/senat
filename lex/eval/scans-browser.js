const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.LEX_TEST_URL||'http://127.0.0.1:8765/';
const out=process.env.LEX_SCREENSHOTS||path.resolve(__dirname,'../../work/browser-scans');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:950}}); const page=await context.newPage();const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('request',r=>requests.push(r.url()));
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  await page.goto(base);await page.waitForSelector('#corpus-summary:not([hidden])');assert((await page.locator('#corpus-summary').innerText()).includes('335'));
  assert(!requests.some(u=>u.includes('/scans/')||u.includes('passages-')),'Сканы и индексы пассажей не нужны до запроса');
  for(const year of [1897,1904,1905]){
   await page.goto(base+`#/search?y=${year}&q=договор`);await page.waitForSelector('#results .scan-img');
   const img=page.locator('#results .scan-img').first();await img.scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const im=document.querySelector('#results .scan-img');return im.complete&&im.naturalWidth>0});
   const src=await img.getAttribute('src');assert(src.includes(`/scans/${year}/`));
   const lazy=await img.getAttribute('loading');assert.equal(lazy,'lazy');
   await img.evaluate(im=>im.decode());
   await page.screenshot({path:path.join(out,`search-${year}.png`)});
   await page.locator('#results .scan-open').first().click();await page.waitForSelector('.scan-dialog[open] img');
   await page.waitForFunction(()=>document.querySelector('.scan-dialog img').complete&&document.querySelector('.scan-dialog img').naturalWidth>0);
   assert((await page.locator('.scan-dialog img').getAttribute('src')).includes(`/scans/${year}/pages/`));
   await page.locator('.scan-dialog button').filter({hasText:'Увеличить'}).click();assert(await page.locator('.scan-sheet.zoom').count());
   await page.keyboard.press('Escape');await page.waitForSelector('.scan-dialog',{state:'detached'});assert.equal(await page.locator('.scan-dialog').count(),0);
  }
  await page.goto(base+'#/sense?q=фиктивные%20сделки');await page.waitForSelector('#sense-results .scan-img');
  assert(await page.locator('.passage mark').count());
  const first=page.locator('.passage').first();const pid=await first.getAttribute('data-passage');console.log('top',pid);
  await first.locator('a').first().click();await page.waitForSelector('#passage-target');const direct=page.url();
  await page.reload();await page.waitForSelector('#passage-target');await page.locator('.detail-scans summary').click();await page.waitForSelector('.detail-scans .scan-img');
  assert.equal(page.url(),direct);
  await page.locator('.detail-scans .scan-open').first().focus();await page.keyboard.press('Enter');await page.waitForSelector('.scan-dialog[open]');assert.equal(page.url(),direct);await page.keyboard.press('Escape');await page.waitForSelector('.scan-dialog',{state:'detached'});assert.equal(page.url(),direct);assert(await page.locator('#passage-target').isVisible());
  await page.goto(base+'#/d/1897-095');await page.waitForSelector('#detail-body h2');assert((await page.locator('#detail-body h2').innerText()).includes('29/30'));
  await page.goto(base+'#/d/1904-042');await page.waitForSelector('#detail-body h2');assert((await page.locator('#detail-body h2').innerText()).replace('₄','4').includes('1903/4'));
  await page.goto(base+'#/sense?q=фиктивные%20сделки');await page.waitForSelector('#sense-results .scan-img');
  await page.locator('#sense-results .scan-img').first().evaluate(im=>im.decode());
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.locator('#sense-results .scan-img').first().scrollIntoViewIfNeeded();await page.locator('#sense-results .scan-img').first().evaluate(im=>im.decode());await page.screenshot({path:path.join(out,'mobile-dark.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#sense-results .scan-open').first().click();await page.waitForSelector('.scan-dialog[open] img');await page.screenshot({path:path.join(out,'mobile-page.png')});await page.keyboard.press('Escape');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Chromium: три тома, сканы, увеличение, ссылки, подсветка, мобильная и тёмная тема; ошибок нет');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
