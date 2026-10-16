/* Настоящий Chromium: полный каталог, фильтры, источник включения и старые ссылки. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const lex=path.resolve(__dirname,'..'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8776/';
const out=process.env.LEX_SCREENSHOTS||path.resolve(lex,'../../topic-catalog-2026-10/browser');fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(lex,'data/topic-catalog.json'),'utf8'));
const route=(g='',y='',q='')=>base+'#/guides?'+new URLSearchParams(Object.entries({g,y,q,...(g?{catalog:'1'}:{})}).filter(([,v])=>v));
(async()=>{
 const b=await chromium.launch({headless:true,executablePath:process.env.LEX_CHROMIUM||'/Applications/Chromium.app/Contents/MacOS/Chromium'}),errors=[],images=[];
 try{
  const ctx=await b.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage();p.setDefaultTimeout(30000);
  if(process.env.LEX_TEST_SCAN_URL)await ctx.addInitScript(url=>{window.LEX_SCAN_URL=url;},process.env.LEX_TEST_SCAN_URL);
  await ctx.route('https://fonts.googleapis.com/**',r=>r.fulfill({status:200,contentType:'text/css',body:''}));
  await ctx.route('https://fonts.gstatic.com/**',r=>r.abort());
  p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('request',r=>{if(/\/scans\//.test(r.url()))images.push(r.url());});
  await p.goto(route());await p.waitForSelector('.topic-card');
  assert.equal(await p.locator('.topic-card').count(),data.topic_count);assert.equal(images.length,0);
  assert((await p.locator('#guides-status').textContent()).includes(String(data.count)));
  await p.screenshot({path:path.join(out,'catalog-desktop.png')});
  await p.fill('#guides-q','алименты');await p.locator('#guides-filter button').click();await p.waitForURL('**q=*');
  await p.waitForFunction(()=>document.querySelectorAll('.topic-card').length===1);
  assert.equal(await p.locator('.topic-card').getAttribute('data-topic'),'family');
  await p.reload();await p.waitForSelector('.topic-card');assert.equal(await p.locator('.topic-card').count(),1);
  await p.goto(route('all'));await p.waitForSelector('.catalog-case');assert.equal(await p.locator('.catalog-case').count(),30);
  await p.click('#guides-more');await p.waitForFunction(()=>document.querySelectorAll('.catalog-case').length===60);
  const firstSixty=Object.keys(data.decisions).slice(0,60);
  assert.deepEqual(await p.locator('.catalog-case').evaluateAll(xs=>xs.map(x=>x.dataset.id)),firstSixty);
  for(const t of data.topics.filter(t=>t.count)){
   await p.goto(route(t.id));await p.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,t.id);
   assert.deepEqual(await p.locator('.catalog-case').evaluateAll(xs=>xs.map(x=>x.dataset.id)),t.decision_ids.slice(0,30));
   const ev=data.decisions[t.decision_ids[0]].topics.find(x=>x.id===t.id).evidence;
   assert.equal(await p.locator('.catalog-case .source-quote').first().textContent(),ev.text);
  }
  assert.equal(images.length,0,'Просмотр каталога и цитат не должен заранее скачивать изображения');
  const checked=[];
  for(const y of [1896,1897,1904,1905]){
   const t=data.topics.find(t=>t.by_year[y]>0),ids=t.decision_ids.filter(id=>data.decisions[id].year===y);
   await p.goto(route(t.id,String(y)));await p.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,t.id);
   assert.deepEqual(await p.locator('.catalog-case').evaluateAll(xs=>xs.map(x=>x.dataset.id)),ids.slice(0,30));
   const c=data.decisions[ids[0]],ev=c.topics.find(x=>x.id===t.id).evidence;
   await p.locator('.catalog-case .analysis-evidence > summary').first().click();
   await p.locator('.catalog-case .analysis-evidence a').first().click();
   await p.waitForFunction(text=>[...document.querySelectorAll('.passage-focus')].map(x=>x.textContent).join('\n\n')===text,ev.text);
   assert.equal(await p.locator('#tab-guides').getAttribute('aria-current'),'page');
   const direct=p.url();await p.reload();await p.waitForSelector('#passage-target');
   assert.equal((await p.locator('.passage-focus').allTextContents()).join('\n\n'),ev.text);
   await p.locator('.detail-scans > summary').click();await p.waitForSelector('.detail-scans .scan-figure');
   assert.deepEqual(await p.locator('.detail-scans .scan-figure').evaluateAll(xs=>xs.map(x=>x.dataset.source)),ev.scans.map(x=>x.file));
   await p.locator('.detail-scans img').first().scrollIntoViewIfNeeded();
   await p.waitForFunction(()=>{const i=document.querySelector('.detail-scans img');return i&&i.complete&&i.naturalWidth>0;});
   assert((await p.locator('.detail-scans img').first().getAttribute('src')).endsWith(ev.scans[0].full));
   await p.locator('.detail-scans .scan-open').first().click();await p.waitForSelector('.scan-dialog');
   await p.waitForFunction(()=>{const i=document.querySelector('.scan-dialog img');return i&&i.complete&&i.naturalWidth>0;});
   await p.keyboard.press('Escape');await p.click('#detail-close');await p.waitForFunction(id=>document.querySelector('.guide')?.dataset.guide===id,t.id);
   assert.equal(new URLSearchParams(p.url().split('?')[1]).get('y'),String(y));checked.push({year:y,id:c.id,url:direct});
  }
  await p.goto(route('all','1896'));await p.waitForSelector('.catalog-case');
  const c=data.decisions[Object.keys(data.decisions).find(i=>data.decisions[i].year===1896)];
  await p.fill('#guides-q',c.title.split(' ').slice(0,3).join(' '));await p.locator('#guides-filter button').click();
  await p.waitForURL('**q=*');await p.waitForSelector('.catalog-case');assert(await p.locator('.catalog-case[data-id="'+c.id+'"]').count());
  await p.goto(route('notary'));await p.waitForSelector('.topic-comparison');await p.locator('.topic-comparison > summary').click();await p.waitForSelector('.guide-comparison');assert.equal(await p.locator('.comparison-case').count(),3);
  for(const [id,count] of [['property-notary',3],['inheritance',2],['commerce-transport',3]]){
   await p.goto(base+'#/guides?g='+id);await p.waitForSelector('.guide-comparison');
   assert.equal(await p.locator('.comparison-case').count(),count);assert(await p.locator('.topic-comparison').getAttribute('open')!==null);
  }
  await p.setViewportSize({width:390,height:844});await p.click('#theme');
  for(const g of ['', 'all', 'family', 'notary']){
   await p.goto(route(g));await p.waitForFunction(()=>!document.querySelector('#guides-results').textContent.includes('Загрузка каталога'));
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Мобильное переполнение: '+g);
  }
  await p.goto(route());await p.waitForSelector('.topic-card');await p.screenshot({path:path.join(out,'catalog-mobile-dark.png')});
  await p.goto(route('family'));await p.waitForSelector('.catalog-case');await p.locator('.catalog-case').first().scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'family-mobile-dark.png')});
  await p.goto(route('unknown'));await p.waitForSelector('#guides-results .empty');
  const offline=await b.newContext(),op=await offline.newPage();await offline.route('http**://**',r=>r.abort());op.on('pageerror',e=>errors.push(e.message));
  await op.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/guides');await op.waitForSelector('.topic-card');assert.equal(await op.locator('.topic-card').count(),data.topic_count);
  await op.goto('file://'+path.join(lex,'dist/senat-lex.html')+'#/guides?g=all');await op.waitForSelector('.catalog-case');assert.equal(await op.locator('.catalog-case').count(),30);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({topics:data.topic_count,decisions:data.count,classified:data.classified,checkedSources:checked,checked:'все темы/точные списки, поиск тем и решений, тома, пагинация, цитаты/сканы/полная страница, ссылки/перезагрузка/возврат, старые сравнения, мобильная/тёмная тема и офлайн',errors,screenshots:out},null,2));
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
