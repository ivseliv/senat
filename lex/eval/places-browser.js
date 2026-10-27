/* Проверка карты и буквального источника в локальном Chromium. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const repo=path.resolve(__dirname,'../..'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8771/';
const out=path.resolve(process.env.LEX_TEST_OUTPUT||path.join(os.tmpdir(),'senat-places-browser'));fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(repo,'lex/data/geography.json'))),meta=JSON.parse(fs.readFileSync(path.join(repo,'lex/data/meta.json'))),P=require(path.join(repo,'lex/places.js'));
const report={base,counts:{places:data.places.length,mentions:data.mentions.length},cases:[],errors:[],requestFailures:[],externalRequests:[]};
const model=p=>P.select(data,meta,P.state(p)),params=p=>new URLSearchParams(p).toString();
async function ready(page){await page.waitForFunction(()=>/По фильтрам:/.test(document.querySelector('#places-status')?.textContent||''));}
async function goto(page,p={}){await page.goto(base+'#/places?'+params(p));await ready(page);}
async function check(page,p={}){
 const m=model(p);await ready(page);
 await page.waitForFunction(f=>['q','y','t','role'].every(key=>document.querySelector('#places-'+({q:'q',y:'year',t:'topic',role:'role'}[key])).value===(f[key]||'')),p);
 await page.waitForFunction(n=>document.querySelectorAll('#places-list button').length===n,m.points.length);
 assert.equal(await page.locator('#places-cases .places-case').count(),Math.min(20,m.cases.length));
 assert((await page.locator('#places-status').innerText()).includes('По фильтрам: '+m.decisionCount+' '));
 for(const g of m.points)assert((await page.locator('#places-list button[data-place="'+g.place.id+'"]').innerText()).includes(g.decisionIds.length+' '));
 return m;
}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(45000);
  page.on('pageerror',e=>report.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&!r.url().startsWith(base))report.externalRequests.push(r.url());});
  page.on('requestfailed',r=>report.requestFailures.push({url:r.url(),error:r.failure()?.errorText}));
  await goto(page);const all=await check(page);assert(all.points.length>0);
  await page.waitForFunction(()=>[...document.querySelectorAll('.places-land')].some(p=>p.getAttribute('d')!=='M0 0'));assert.equal(await page.locator('.places-marker').count(),all.points.length);
  await page.locator('#places-europe').click();await page.locator('#places-map').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'desktop-map.png')});
  assert.equal(await page.locator('.leaflet-tile').count(),0);report.cases.push('Карта без внешних тайлов, точки и счётчики соответствуют разным делам.');
  for(const year of ['1896','1897','1904','1905']){await goto(page,{y:year});await check(page,{y:year});}
  const sample=data.mentions.find(m=>m.place_id&&meta.decisions.find(d=>d.id===m.decision_id)?.topic_ids.length),doc=meta.decisions.find(d=>d.id===sample.decision_id);
  const filtered={y:String(sample.year),t:doc.topic_ids[0],role:sample.role};await goto(page,filtered);await check(page,filtered);assert((await page.locator('#places-year').inputValue())===filtered.y);
  await page.reload();await check(page,filtered);assert.equal(await page.locator('#places-role').inputValue(),filtered.role);report.cases.push('Все четыре тома, сочетание темы/роли/года и перезагрузка URL.');
  for(const q of ['Ялта','Ялте','Митава','Митаве']){await goto(page,{q});const m=await check(page,{q});assert(m.points.length>0,'Нет примера '+q);}
  await goto(page);const point=all.points.find(g=>g.mentions.some(m=>m.scans?.length));assert(point);
  await page.locator('#places-list button[data-place="'+point.place.id+'"]').focus();await page.keyboard.press('Enter');await page.waitForURL('**p='+point.place.id);await check(page,{p:point.place.id});
  assert.equal(await page.locator('#places-list button[aria-pressed=true]').count(),1);assert.equal(await page.locator('.places-marker[aria-pressed=true]').count(),1);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.place),point.place.id);
  await page.goBack();await check(page);await page.goForward();await check(page,{p:point.place.id});
  const mention=point.mentions.find(m=>m.scans?.length),ev=page.locator('[data-mention="'+mention.id+'"] details');
  await ev.locator('summary').click();assert.equal(await ev.locator('blockquote').textContent(),mention.quote);
  await ev.locator('a').click();await page.waitForSelector('#passage-target');
  assert.equal(await page.locator('.reader-source-warning').count(),0);await page.locator('#detail button').filter({hasText:'Дореформенная'}).click();await page.waitForSelector('#passage-target');
  const focus=await page.locator('#detail .passage-focus').allTextContents();assert.equal(focus.join('\n\n'),mention.quote);
  await page.locator('.detail-scans>summary').click();await page.waitForSelector('.detail-scans .scan-img');
  await page.waitForFunction(()=>[...document.querySelectorAll('.detail-scans img')].every(i=>i.complete&&i.naturalWidth>0));
  report.source={decision:mention.decision_id,mention:mention.id,quote:mention.quote,scans:await page.locator('.detail-scans img').evaluateAll(imgs=>imgs.map(i=>({src:i.src,width:i.naturalWidth})))};
  await page.locator('#passage-target').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'desktop-source.png')});
  await page.locator('#detail-close').click();await check(page,{p:point.place.id});assert(!(new URLSearchParams(page.url().split('?').pop())).has('geo'));
  const restored=data.mentions.find(m=>m.decision_id==='1896-022');assert(restored,'Нужен реальный direct-link 1896-022');
  await page.goto(base+'#/d/1896-022?'+params({mode:'places',geo:restored.id,at:restored.start,end:restored.end}));await page.waitForSelector('#passage-target');
  assert.equal(await page.locator('.reader-source-warning').count(),0);assert.equal((await page.locator('#detail .passage-focus').allTextContents()).join('\n\n'),restored.quote);
  report.restoredDirectLink={decision:'1896-022',mention:restored.id,versionParam:false,verifiedSHA:true};
  report.cases.push('Клавиатурный выбор точки, back/forward, буквальная цитата, подсветка, реальный скан и возврат к карте.');
  await goto(page,{u:'1'});const unresolved=await check(page,{u:'1'});assert(unresolved.cases.length>0);assert.equal(await page.locator('.places-marker').count(),0);
  await page.getByRole('link',{name:'Сбросить фильтры',exact:true}).click();await check(page);assert.equal(await page.locator('#places-unmapped').isChecked(),false);
  for(const [id,kind] of [['places-export-json','json'],['places-export-geojson','geojson']]){
   const promise=page.waitForEvent('download');await page.locator('#'+id).click();const download=await promise,parsed=JSON.parse(fs.readFileSync(await download.path()));
   if(kind==='json')assert.equal(parsed.mentions.length,data.mentions.length);else assert.equal(parsed.features.length,data.places.filter(P.validPoint).length);
  }
  report.cases.push('Без точки, сброс фильтров, полные JSON/GeoJSON выгрузки.');
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,colorScheme:'dark'}),mp=await mobile.newPage();mp.on('pageerror',e=>report.errors.push('mobile: '+e.message));
  await goto(mp,{q:'Митава'});await check(mp,{q:'Митава'});await mp.locator('#places-map').scrollIntoViewIfNeeded();await mp.screenshot({path:path.join(out,'mobile-dark-map.png')});
  await mp.locator('#places-cases .places-case').first().scrollIntoViewIfNeeded();await mp.locator('#places-cases .analysis-evidence summary').first().click();await mp.screenshot({path:path.join(out,'mobile-dark-source.png')});
  assert(await mp.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));report.cases.push('Мобильный тёмный вид: карта, реальная карточка и отсутствие горизонтального скролла.');
  const fail=await browser.newContext(),fp=await fail.newPage();await fail.route('**/data/geo-basemap.json*',r=>r.abort());await goto(fp);await fp.waitForFunction(()=>document.querySelector('#places-map-note').textContent.includes('Контур суши недоступен'));await check(fp);assert.equal(await fp.locator('.places-marker').count(),all.points.length);report.cases.push('Отказ фона не блокирует точки и дела.');
  if(process.env.LEX_OFFLINE){
   const off=await browser.newContext(),op=await off.newPage(),requests=[];op.setDefaultTimeout(90000);op.on('pageerror',e=>report.errors.push('offline: '+e.message));await off.route('http**://**',r=>{requests.push(r.request().url());return r.abort();});
   await op.goto('file://'+path.join(repo,'lex/dist/senat-lex.html')+'#/places?q='+encodeURIComponent('Митава'));await ready(op);await op.waitForFunction(()=>[...document.querySelectorAll('.places-land')].some(p=>p.getAttribute('d')!=='M0 0'));await check(op,{q:'Митава'});
   const offlineEvidence=op.locator('#places-cases .analysis-evidence').first();await offlineEvidence.locator('summary').click();const offlineQuote=await offlineEvidence.locator('blockquote').textContent();await offlineEvidence.locator('a').click();await op.waitForSelector('#passage-target');
   await op.locator('#detail button').filter({hasText:'Дореформенная'}).click();await op.waitForSelector('#passage-target');assert.equal((await op.locator('#detail .passage-focus').allTextContents()).join('\n\n'),offlineQuote);
   assert.equal(await op.locator('script[src]').count(),0);assert.deepEqual(requests,[]);report.cases.push('Offline file: карта, контур суши, буквальная цитата и переход в полный текст без сети.');
  }
  const bad=await browser.newContext(),bp=await bad.newPage(),altered=structuredClone(data);altered.mentions.find(m=>m.id===restored.id).source_sha256='0'.repeat(64);
  await bad.route('**/data/geography.json*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(altered)}));
  await bp.goto(base+'#/d/1896-022?'+params({mode:'places',geo:restored.id,at:restored.start,end:restored.end}));await bp.waitForSelector('.reader-source-warning');assert.equal(await bp.locator('#passage-target').count(),0);report.cases.push('Изменённый SHA не допускает подсветку неподтверждённой цитаты.');
  assert.deepEqual(report.errors,[]);assert(report.externalRequests.every(url=>/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)));assert(report.requestFailures.every(r=>/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(r.url)));report.passed=true;
 }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
