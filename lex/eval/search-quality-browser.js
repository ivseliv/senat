/* Реальный браузер: поиск, явные частичные совпадения, прямые ссылки и офлайн. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const base=process.env.LEX_TEST_URL || 'http://127.0.0.1:8770/';
const out=path.resolve(__dirname,'../../work/search-browser');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.LEX_CHROMIUM ? {executablePath:process.env.LEX_CHROMIUM} : {})});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
  if(process.env.LEX_TEST_SCAN_URL)await context.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  for(const event of ['pageerror','console'])page.on(event,m=>{if(event==='pageerror'||m.type()==='error')errors.push(event==='pageerror'?m.message:m.text());});
  await context.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await context.route('https://fonts.gstatic.com/**',r=>r.abort());
  const search=async q=>{await page.goto(base+'#/sense?q='+encodeURIComponent(q));await page.waitForFunction(()=>!document.querySelector('#sense-status').textContent.includes('Ищем')&&document.querySelector('#sense-status strong'));};
  await search('ответственность нотариуса за убытки');
  assert((await page.locator('.passage').first().getAttribute('data-passage')).startsWith('1897-041:'));
  assert(await page.locator('.passage mark').count()>0);assert.equal(await page.locator('#sense-partial').count(),0);
  assert.equal(await page.locator('.passage .search-partial-note').count(),0);
  await page.screenshot({path:path.join(out,'notary.png')});
  await search('забытые вещи в поезде');assert.equal(await page.locator('.passage').count(),0);
  await page.click('#sense-partial');await page.waitForSelector('.passage');assert(page.url().includes('partial=1'));
  const first=page.locator('.passage').first();assert((await first.getAttribute('data-passage')).startsWith('1897-016:'));
  assert((await first.locator('.search-partial-note').innerText()).includes('«поезде»'));
  assert.equal(await page.locator('.passage').count(),await page.locator('.passage > .search-partial-note').count());
  assert(await first.locator('mark').count()>0);assert(await first.locator('.scan-open').count()>0);
  await page.waitForFunction(()=>[...document.querySelector('.passage').querySelectorAll('img')].every(img=>img.complete&&img.naturalWidth>0));
  await first.locator('.scan-open').first().click();await page.waitForSelector('.scan-dialog');
  await page.waitForFunction(()=>{const img=document.querySelector('.scan-dialog img');return img&&img.complete&&img.naturalWidth>0;});
  await page.keyboard.press('Escape');
  await first.locator('a').first().click();await page.waitForSelector('#passage-target');
  assert((await page.locator('#detail-body > .search-partial-note').innerText()).includes('«поезде»'));
  await page.reload();await page.waitForSelector('#passage-target');assert(await page.locator('#passage-target mark').count()>0);
  await page.click('#detail-close');await page.waitForSelector('.passage');assert(page.url().includes('partial=1'));
  await page.check('input[name=sense-orth][value=new]');await page.waitForFunction(()=>!/[ѣі]/.test(document.querySelector('.passage-text').textContent));
  assert(await page.locator('.passage mark').count()>0);
  await page.check('input[name=sense-orth][value=old]');await page.waitForFunction(()=>/[ѣіъ]/.test(document.querySelector('.passage-text').textContent));
  await page.setViewportSize({width:390,height:844});await page.click('#theme');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.passage').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'partial-mobile-dark.png')});
  await page.reload();await page.waitForSelector('.passage');assert((await page.locator('#sense-q').inputValue()).includes('поезде'));
  await page.click('#sense-strict');await page.waitForSelector('#sense-partial');assert.equal(await page.locator('.passage').count(),0);
  for(const q of ['залог залог электронный','электронная подпись','ответственность нотариуса 2026']) {
   await search(q);assert.equal(await page.locator('.passage').count(),0);assert.equal(await page.locator('#sense-partial').count(),0,q);
  }
  await page.goto(base+'#/sense?q='+encodeURIComponent('ответственность нотариуса за убытки')+'&partial=1');
  await page.waitForSelector('.passage');assert.equal(await page.locator('.passage .search-partial-note').count(),0);
  for(const [year,count] of [[1896,49],[1897,100],[1904,120],[1905,115]]) {
   await page.goto(base+'#/search?y='+year);await page.waitForFunction(n=>document.querySelector('#status').textContent.includes(n),String(count));
   assert.equal(await page.locator('#f-year').inputValue(),String(year));assert(await page.locator('.card').count()>0);
  }
  const offline=await context.newPage(),requests=[];offline.on('pageerror',e=>errors.push(e.message));offline.on('request',r=>requests.push(r.url()));
  await offline.goto('file://'+path.resolve(__dirname,'../dist/senat-lex.html')+'#/sense?q='+encodeURIComponent('забытые вещи в поезде'));
  await offline.waitForSelector('#sense-partial');await offline.click('#sense-partial');await offline.waitForSelector('.passage');
  assert((await offline.locator('.passage').first().getAttribute('data-passage')).startsWith('1897-016:'));
  assert(!requests.some(url=>/\/data\//.test(url)));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({checked:'4 тома, нотариус, частичные совпадения только по кнопке, пропущенные слова, защита чисел/повторов, ссылки и возврат, орфография, подсветка, мобильный экран, тёмная тема, офлайн HTML',errors,screenshots:out},null,2));
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
