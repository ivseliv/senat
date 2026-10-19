/* Настоящий Chromium: независимый получатель, цитаты, файлы, заметки и офлайн. */
'use strict';
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const R=require('../research.js'),base=process.env.LEX_TEST_URL||'http://127.0.0.1:8790/';
const out=path.resolve(process.env.LEX_TEST_OUTPUT||path.join(os.tmpdir(),'senat-research-browser'));fs.mkdirSync(out,{recursive:true});
let browser;const checks=[],errors=[];
const check=name=>{checks.push(name);console.log('OK',name);};
async function wait(page,n){await page.waitForFunction(n=>document.querySelectorAll('#research-cases [data-research-case]').length===n&&document.querySelector('#research-status').textContent.includes(n?'готова':'не найдено'),n);}
async function pageOf(context){const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});return page;}
(async()=>{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/Applications/Chromium.app/Contents/MacOS/Chromium',headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await pageOf(ctx);
 await page.goto(base+'#/research');await page.locator('.research-example').first().waitFor();assert.equal(await page.locator('.research-example').count(),6);
 await page.getByRole('button',{name:'Кто продолжает дело после смерти участника?',exact:false}).click();await wait(page,2);
 assert.equal(await page.locator('#research-comparison thead th').count(),3);assert.equal(await page.locator('#research-differences .card').count(),3);
 assert((await page.locator('#research-positions').textContent()).includes('Сенат'));check('Справка и матрица с редакционными различиями');
 await page.locator('#research-title').fill('Наследники — исследование');await page.locator('#research-note').fill('ЛИЧНОЕ: <script>не исполнять</script> 🌳');
 await page.getByLabel('Заметка к делу 1904 г. № 34',{exact:true}).fill('Сравнить последовательность событий');
 await page.reload();await wait(page,2);assert((await page.locator('#research-note').inputValue()).includes('ЛИЧНОЕ'));assert.equal(await page.getByLabel('Заметка к делу 1904 г. № 34',{exact:true}).inputValue(),'Сравнить последовательность событий');check('Справка и частные заметки восстанавливаются после перезагрузки');
 await page.locator('#research-share').click();await page.locator('#research-share-box').waitFor();const publicURL=await page.locator('#research-share-url').inputValue();
 const shared=R.decode(new URLSearchParams(publicURL.split('?')[1]).get('share'));assert.equal(shared.notes.general,'');assert.equal(shared.ids.length,2);check('Личные заметки исключены из ссылки');
 const other=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),receiver=await pageOf(other);
 await receiver.goto(base+new URL(publicURL).hash);await wait(receiver,2);assert.equal(await receiver.locator('#research-note').inputValue(),'');assert.equal(await receiver.locator('#research-saved .research-saved-row').count(),0);
 await receiver.locator('#research-save-copy').click();assert.equal(await receiver.locator('#research-saved .research-saved-row').count(),1);check('Ссылка открывается в чистом браузере без регистрации');
 const literal=await page.locator('#research-positions .research-evidence blockquote').first().textContent();
 await page.locator('#research-positions .research-evidence').first().locator('summary').click();await page.locator('#research-positions .research-quote-link').first().click();
 await page.locator('#passage-target').waitFor();assert.equal(await page.locator('#passage-target').textContent(),literal);
 await page.locator('#detail-body .detail-scans>summary').click();await page.locator('#detail-body .scan-figure').first().scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>{const img=document.querySelector('#detail-body .scan-figure img');return img&&img.complete&&img.naturalWidth>0;});
 await page.locator('#detail-body .scan-preview').first().click();await page.waitForFunction(()=>{const img=document.querySelector('.scan-dialog img');return img&&img.complete&&img.naturalWidth>0;});
 await page.locator('.scan-dialog button[aria-label="Закрыть скан"]').click();await page.locator('#detail-close').click();await wait(page,2);
 assert((await page.locator('#research-note').inputValue()).includes('ЛИЧНОЕ'));check('Точная цитата, скан, полная страница и возврат с заметкой');
 const downloads={};for(const type of ['json','html','md']){
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#research-export-'+type).click()]);const target=path.join(out,'research.'+type);await download.saveAs(target);downloads[type]=target;
 }
 const snapshot=JSON.parse(fs.readFileSync(downloads.json,'utf8'));assert.equal(snapshot.cases.length,2);assert(snapshot.notes.general.includes('ЛИЧНОЕ'));
 const html=fs.readFileSync(downloads.html,'utf8');assert(html.includes('<table>'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));check('HTML для печати, Markdown и JSON с оригинальными цитатами');
 const printed=await pageOf(other);await printed.goto('file://'+downloads.html);assert.equal(await printed.locator('table thead th').count(),3);assert.equal(await printed.locator('script').count(),0);
 await printed.emulateMedia({media:'print'});await printed.pdf({path:path.join(out,'research-print.pdf'),format:'A4',landscape:true,printBackground:true});await printed.close();
 await receiver.locator('#research-import').setInputFiles(downloads.json);await wait(receiver,2);assert((await receiver.locator('#research-note').inputValue()).includes('ЛИЧНОЕ'));check('JSON переносит выбранные дела и заметки');
 snapshot.state.corpus='0'.repeat(64);snapshot.state.hashes[snapshot.cases[0].id]='0'.repeat(64);
 await receiver.locator('#research-import').setInputFiles({name:'stale.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(snapshot))});
 await receiver.locator('#research-issues').getByText('Корпус обновился',{exact:false}).waitFor();assert((await receiver.locator('#research-issues').textContent()).includes('текст изменился'));check('Изменение версии текста не переносит старые координаты');
 await page.locator('#research-share-notes').check();await page.locator('#research-share').click();const notesURL=await page.locator('#research-share-url').inputValue();assert(R.decode(new URLSearchParams(notesURL.split('?')[1]).get('share')).notes.general.includes('ЛИЧНОЕ'));check('Заметки передаются только после явного включения');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(out,'research-desktop.png'),fullPage:false});await page.locator('#research-comparison').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:path.join(out,'comparison-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.locator('#research-comparison').scrollIntoViewIfNeeded();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));assert(await page.locator('.research-table-wrap').evaluate(el=>el.scrollWidth>el.clientWidth));await page.screenshot({path:path.join(out,'comparison-mobile-dark.png')});check('Мобильная и тёмная тема, таблица прокручивается внутри страницы');
 await page.setViewportSize({width:1440,height:1000});
 for(const id of ['1904-034','1905-083'])await page.locator('[data-research-case="'+id+'"] .reader-save-decision').click();
 await page.locator('#tab-reader').click();for(const id of ['1904-034','1905-083'])await page.locator('[data-reader-id="'+id+'"] .reader-compare-toggle').check();await page.locator('#reader-research').click();await wait(page,2);check('Переход из подборки в содержательное сравнение');
 await page.goto(base+'#/research');await page.locator('#research-q').fill('Когда сделку считали мнимой?');await page.locator('#research-form button[type=submit]').click();await wait(page,4);assert.equal(await page.locator('#research-terms').inputValue(),'мнимые сделки');assert.equal(await page.locator('[data-research-case]').first().getAttribute('data-research-case'),'1905-105');check('Вопрос переводится в видимую поисковую формулировку');
 await page.locator('#research-add').fill('1896-002');await page.locator('#research-add-results button').first().click();await wait(page,5);assert(await page.locator('[data-research-case="1896-002"]').count());check('Добавление дела из другого тома с отдельным департаментом');
 await page.locator('#research-q').fill('пошлины');await page.locator('#research-year').selectOption('1896');await page.locator('#research-department').selectOption('Общее собрание');await page.locator('#research-form button[type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('#research-status').textContent.includes('готова'));assert((await page.locator('[data-research-case]').evaluateAll(nodes=>nodes.map(n=>n.dataset.researchCase))).every(id=>id.startsWith('1896-')));
 await page.locator('#research-department').selectOption('Гражданский кассационный департамент');await page.locator('#research-form button[type=submit]').click();await wait(page,0);check('Фильтры не соединяют разные департаменты и годы');
 await page.locator('#research-q').fill('квантовый блокчейн нейросеть');await page.locator('#research-year').selectOption('');await page.locator('#research-department').selectOption('');await page.locator('#research-form button[type=submit]').click();await wait(page,0);assert.equal(await page.locator('#research-positions .card').count(),0);check('Пустой запрос по содержанию не создаёт ответ');
 const before=await page.evaluate(()=>localStorage.getItem('senat.research.v1'));await page.goto(base+'#/research?share=INVALID%%%');await page.locator('#research-notice').getByText('повреждена',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('senat.research.v1')),before);check('Повреждённая ссылка не перезаписывает сохранённые исследования');
 // Два редактора одного исследования: чужая правка сохраняется, локальная получает копию.
 await page.goto(base+'#/research');await page.locator('#research-saved button.btn').filter({hasText:'Наследники — исследование'}).first().click();await wait(page,2);
 const second=await pageOf(ctx);await second.goto(base+'#/research');await second.locator('#research-saved button.btn').filter({hasText:'Наследники — исследование'}).first().click();await wait(second,2);
 await page.locator('#research-note').fill('Первая правка в двух окнах');await second.locator('#research-note').fill('Вторая правка в двух окнах');
 const values=await second.evaluate(()=>JSON.parse(localStorage.getItem('senat.research.v1')).records.map(r=>r.state.notes.general));assert(values.includes('Первая правка в двух окнах')&&values.includes('Вторая правка в двух окнах'));await second.close();check('Правки из двух окон сохраняются отдельными копиями');
 const corrupt=await browser.newContext();await corrupt.addInitScript(()=>localStorage.setItem('senat.research.v1','{broken'));
 const cp=await pageOf(corrupt);await cp.goto(base+'#/research?ids=1905-105');await wait(cp,1);await cp.locator('#research-storage-warning').waitFor();assert.equal(await cp.evaluate(()=>localStorage.getItem('senat.research.v1')),'{broken');await corrupt.close();check('Повреждённое хранилище остаётся доступным для восстановления');
 const denied=await browser.newContext();await denied.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError');};});
 const dp=await pageOf(denied);await dp.goto(base+'#/research?ids=1905-105');await wait(dp,1);await dp.locator('#research-storage-warning').waitFor();assert((await dp.locator('#research-save-state').textContent()).includes('памяти'));await denied.close();check('При запрете записи нет ложного обещания сохранности');
 if(process.env.LEX_OFFLINE_FILE){
  const offline=await browser.newContext();await offline.route(/^https?:/,route=>route.abort());const p=await offline.newPage();p.on('pageerror',e=>errors.push(String(e)));
  await p.goto('file://'+path.resolve(process.env.LEX_OFFLINE_FILE)+'#/research');await p.getByRole('button',{name:'За что отвечает нотариус?',exact:false}).click();await wait(p,3);assert.equal(await p.locator('#research-comparison thead th').count(),4);await p.screenshot({path:path.join(out,'offline.png')});await offline.close();check('Справка и сравнение работают в офлайн HTML без сети');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({checks,errors},null,2));await ctx.close();await other.close();await browser.close();console.log('Browser checks passed:',checks.length);
})().catch(async err=>{console.error(err);fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(err),checks,errors},null,2));if(browser){for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:path.join(out,'failure-'+browser.contexts().indexOf(context)+'-'+context.pages().indexOf(page)+'.png')}).catch(()=>{});await browser.close();}process.exitCode=1;});
