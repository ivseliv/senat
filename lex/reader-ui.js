/* Рабочая подборка читателя. Личные записи остаются в браузере. */
(function (root) {
  'use strict';
  const R=root.SenatReader, E=root.SenatReaderExport, PUBLIC=R.PUBLIC;
  const $=id=>document.getElementById(id), cp=text=>Array.from(text), cut=(s,a,b)=>cp(s).slice(a,b).join('');
  function h(tag,attrs,...children) {
    const el=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs||{})) {
      if(value==null || value===false)continue;
      if(key==='class')el.className=value;
      else if(key.startsWith('on'))el.addEventListener(key.slice(2),value);
      else el.setAttribute(key,value===true?'':value);
    }
    for(const child of children.flat(Infinity))if(child!=null && child!==false)el.append(child.nodeType?child:document.createTextNode(String(child)));
    return el;
  }
  function selectionFromRange(range,container,fields) {
    function endpoint(node,offset) {
      const element=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;
      const p=element && element.closest('[data-reader-start][data-reader-end][data-reader-field]');
      if(!p || !container.contains(p) || !p.contains(node))throw Error('Выделите только текст одного решения или его заголовок.');
      const field=p.dataset.readerField, source=fields[field], a=Number(p.dataset.readerStart),b=Number(p.dataset.readerEnd);
      if(typeof source!=='string' || p.textContent!==cut(source,a,b))throw Error('Для точной цитаты включите оригинальную орфографию.');
      const prefix=document.createRange();prefix.selectNodeContents(p);prefix.setEnd(node,offset);
      return {field,position:a+cp(prefix.toString()).length};
    }
    const a=endpoint(range.startContainer,range.startOffset),b=endpoint(range.endContainer,range.endOffset);
    if(a.field!==b.field || a.position>=b.position)throw Error('Выделите непустую цитату в одном поле источника.');
    const text=cut(fields[a.field],a.position,b.position);
    if(!text.trim() || cp(text).length>R.LIMITS.quote)throw Error('Цитата должна содержать от 1 до '+R.LIMITS.quote+' символов.');
    return {field:a.field,start:a.position,end:b.position,text_original:text};
  }
  function create(adapter) {
    let storage;try{storage=localStorage;}catch(_){storage=null;}
    const store=R.createStore({storage}), compareIds=new Set(), hashes=new Map(), volumes=new Map();
    let detail=null,selected=null,token=0,notice='',noticeError=false;
    const docs=new Map(adapter.meta.decisions.map(d=>[d.id,d]));
    const message=(text,error=false)=>{notice=text;noticeError=error;status();};
    function status() {
      const s=store.getState(),flags=store.getStatus(),n=s.items.reduce((n,i)=>n+i.quotes.length,0);
      $('tab-reader').textContent='Подборка'+(s.items.length?' ('+s.items.length+')':'');
      $('reader-status').textContent=`Решений: ${s.items.length} · Цитат: ${n}. `+(flags.persistent?'Сохранено в этом браузере.':'Сейчас записи хранятся только в памяти: сохраните JSON-копию до закрытия страницы.');
      $('reader-storage-warning').hidden=flags.persistent;
      $('reader-storage-warning').textContent=flags.blocked?'Сохранённый файл браузера повреждён или имеет другую версию. Его содержимое не перезаписано. Выгрузите доступные записи; восстановление хранилища требует отдельного подтверждения.':'Браузер запретил запись или его хранилище заполнено. Текущую подборку можно выгрузить в JSON; после перезагрузки изменения могут пропасть.';
      if($('reader-global-warning')) {
        $('reader-global-warning').hidden=flags.persistent;
        $('reader-global-warning').replaceChildren('Подборка сейчас хранится только в памяти. ',h('a',{href:'#/reader'},'Откройте подборку и скачайте JSON-копию.'));
      }
      for(const hint of document.querySelectorAll('.reader-persistence-hint')) {
        hint.hidden=flags.persistent;hint.textContent='Подборка не записана в хранилище браузера. До закрытия страницы откройте подборку и скачайте JSON-копию.';
      }
      $('reader-recover').hidden=!flags.blocked;
      $('reader-export-original').hidden=!flags.blocked;
      $('reader-notice').textContent=notice;$('reader-notice').classList.toggle('reader-error',noticeError);
      for(const btn of document.querySelectorAll('.reader-save-decision')) {
        const saved=s.items.some(i=>i.id===btn.dataset.decision);
        btn.textContent=saved?'В подборке ✓':'В подборку';btn.setAttribute('aria-pressed',String(saved));
      }
    }
    const guarded=fn=>async event=>{try{await fn(event);}catch(err){message(err.message,true);if(detail)$('reader-selection-status').textContent=err.message;}};
    async function hash(text) {
      if(!hashes.has(text))hashes.set(text,crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)).then(bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')));
      return hashes.get(text);
    }
    function passages(year) {
      if(!volumes.has(year))volumes.set(year,adapter.loadJSON('passages-'+year+'.json'));
      return volumes.get(year);
    }
    function cleanScan(ref) {
      return {file:ref.file,page:ref.page??null,full:ref.full,image:ref.full,kind:'page',width:ref.width,height:ref.height};
    }
    async function location(d,start,end,field='text') {
      if(field==='headnote')return {printed_pages:[],sources:[],scans:[],source_warning:''};
      const [data,scans]=await Promise.all([passages(d.vol),adapter.loadScans(d.vol)]), found=new Map(), warnings=new Set();
      for(const p of data.passages.filter(p=>p.decision===d.id && p.start<end && p.end>start)) {
        if(p.ai && p.ai.source_warning)warnings.add(p.ai.source_warning);
        for(const s of p.sources||[]) {
        const a=Math.max(start,s.start),b=Math.min(end,s.end);if(a>=b)continue;
        const key=s.file+':'+a+'-'+b;found.set(key,{file:s.file,page:s.page??null,start:a,end:b,...(s.page_method?{page_method:s.page_method}:{})});
      }}
      const sources=[];
      for(const part of [...found.values()].sort((a,b)=>a.start-b.start || a.end-b.end)) {
        const last=sources[sources.length-1];
        if(last && last.file===part.file && last.page===part.page && last.end>=part.start)last.end=Math.max(last.end,part.end);
        else sources.push({...part});
      }
      const files=[...new Set(sources.map(s=>s.file))];
      return {source_warning:[...warnings].join(' '),sources,printed_pages:[...new Set(sources.map(s=>s.page).filter(Number.isInteger))].sort((a,b)=>a-b),scans:files.map(file=>scans.pages[file]).filter(Boolean).map(cleanScan)};
    }
    async function snapshot(d) {
      const [text,scans]=await Promise.all([adapter.textOf(d),adapter.loadScans(d.vol)]);
      const refs=(scans.decisions[d.id]||[]).map(file=>scans.pages[file]).filter(Boolean).map(cleanScan);
      return {id:d.id,year:d.vol,number:d.num,department:d.dept,date_label:d.date_label||adapter.formatDate(d.date,d.date_label),headnote:d.headnote,
        url:PUBLIC+'#/d/'+d.id,source_sha256:await hash(text),printed_pages:[...new Set(refs.map(r=>r.page).filter(Number.isInteger))].sort((a,b)=>a-b),scans:refs,source_warning:adapter.warningOf?adapter.warningOf(d):''};
    }
    function quoteURL(d,q) {return PUBLIC+'#/d/'+d.id+'?'+new URLSearchParams({mode:'quote',field:q.field,at:q.start,end:q.end,sha:q.source_sha256});}
    async function makeQuote(d,field,start,end,text,note='') {
      const source=field==='headnote'?d.headnote:text, original=cut(source,start,end);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>cp(source).length||end<=start||!original.trim())throw Error('Диапазон цитаты не соответствует источнику.');
      const q={field,start,end,text_original:original,source_sha256:await hash(source),note,...await location(d,start,end,field)};
      q.url=quoteURL(d,q);return q;
    }
    async function save(d) {store.saveDecision(await snapshot(d));status();message('Решение добавлено в подборку.');}
    function saveButton(d) {const btn=h('button',{class:'btn ghost reader-save-decision','data-decision':d.id,'aria-pressed':String(store.getState().items.some(i=>i.id===d.id)),onclick:guarded(()=>save(d))},store.getState().items.some(i=>i.id===d.id)?'В подборке ✓':'В подборку');return btn;}
    function download(type) {
      const state=store.getState(), formats={json:()=>['application/json',store.exportJSON()],markdown:()=>['text/markdown;charset=utf-8',E.markdown(state)],html:()=>['text/html;charset=utf-8',E.html(state)],csv:()=>['text/csv;charset=utf-8',E.csv(state)]};
      const [mime,content]=formats[type](),url=URL.createObjectURL(new Blob([content],{type:mime}));
      const a=h('a',{href:url,download:E.filename(state.title,type==='markdown'?'md':type)});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
      message(type==='json'?'JSON-копия содержит всю подборку и подходит для переноса и восстановления.':'Подборка выгружена. Ссылки на сайт и сканы требуют интернета.');
    }
    async function importFile(file) {
      if(!file)return;if(file.size>R.LIMITS.bytes)throw Error('Файл подборки превышает 4 МБ.');
      const incoming=R.validate(await file.text()), prepared=JSON.parse(JSON.stringify(incoming));
      for(const item of prepared.items) {
        const d=docs.get(item.id);if(!d)throw Error('В корпусе нет решения '+item.id+'. Подборка не изменена.');
        const text=await adapter.textOf(d);item.decision=await snapshot(d);
        for(let i=0;i<item.quotes.length;i++) {
          const q=item.quotes[i],source=q.field==='headnote'?d.headnote:text;
          if(await hash(source)!==q.source_sha256 || cut(source,q.start,q.end)!==q.text_original)throw Error('Цитата '+item.id+' не совпадает с текущим источником. Файл сохранён у вас, подборка не изменена.');
          item.quotes[i]={...await makeQuote(d,q.field,q.start,q.end,text,q.note),id:q.id};
        }
      }
      store.importJSON(prepared,{merge:true});render();message('Подборка объединена с текущей. Существующие заметки и цитаты сохранены.');
    }
    function noteBox(value,label,save,className) {
      const input=h('textarea',{class:className,rows:3,maxlength:R.LIMITS.note,'aria-label':label,oninput:()=>{try{save(input.value);}catch(err){message(err.message,true);}}});input.value=value;
      return h('label',{class:'reader-note-label'},label,input);
    }
    function render() {
      token++;
      const s=store.getState();$('reader-title').value=s.title;$('reader-note').value=s.note;
      for(const id of [...compareIds])if(!s.items.some(i=>i.id===id))compareIds.delete(id);
      const cards=s.items.map(item=>{
        const d=docs.get(item.id),label=`${item.decision.year} г. № ${item.decision.number}`;
        const remove=h('button',{class:'btn ghost reader-remove',onclick:()=>{
          if(confirm('Удалить '+label+' из подборки вместе с заметкой и цитатами?')){store.removeItem(item.id);compareIds.delete(item.id);render();}
        }},'Удалить из подборки');
        const toggle=h('input',{type:'checkbox',class:'reader-compare-toggle','aria-label':'Сравнить '+label,onchange:e=>{
          if(e.target.checked && compareIds.size>=4){e.target.checked=false;message('Рядом можно сравнить от 2 до 4 решений.',true);return;}
          if(e.target.checked)compareIds.add(item.id);else compareIds.delete(item.id);compareStatus();
        }});toggle.checked=compareIds.has(item.id);
        return h('article',{class:'card reader-item','data-reader-id':item.id,'data-decision-id':item.id},
          h('div',{class:'reader-item-top'},h('h3',{},h('a',{href:'#/d/'+item.id+'?mode=reader'},label)),h('label',{},toggle,' Сравнить'),remove),
          h('p',{class:'muted small'},item.decision.department+' · '+item.decision.date_label),h('p',{class:'reader-headnote'},item.decision.headnote),
          item.decision.source_warning?h('p',{class:'preliminary-note'},item.decision.source_warning):null,
          h('p',{class:'small reader-pages'},E.pageLabel?E.pageLabel(item.decision):pageLabel(item.decision)),
          !d?h('p',{class:'reader-error'},'Это решение отсутствует в текущей версии корпуса. Сохранённые цитаты и заметки доступны в экспорте.'):null,
          noteBox(item.note,'Заметка к решению '+label,value=>store.updateItem(item.id,{note:value}),'reader-item-note'),
          h('div',{class:'reader-quotes'},item.quotes.map(q=>h('section',{class:'reader-quote','data-quote-id':q.id},
            h('blockquote',{class:'source-quote reader-quote-original'},q.text_original),
            q.source_warning?h('p',{class:'preliminary-note'},q.source_warning):null,
            h('p',{class:'small reader-quote-pages'},(q.field==='headnote'?'Заголовок издания. ':'')+pageLabel(q)),
            h('a',{class:'reader-quote-open',href:localQuoteURL(item.id,q)},'Открыть это место'),
            h('ul',{class:'reader-scan-links'},q.scans.map(scan=>h('li',{},h('a',{href:PUBLIC+scan.full.replace(PUBLIC,''),target:'_blank',rel:'noopener'},'Полная страница'+(scan.page==null?' без печатного номера':', с. '+scan.page))))),
            noteBox(q.note,'Заметка к цитате '+label,value=>store.updateQuote(item.id,q.id,{note:value}),'reader-quote-note'),
            h('button',{class:'btn ghost reader-remove-quote',onclick:()=>{if(confirm('Удалить эту цитату и заметку к ней?')){store.removeQuote(item.id,q.id);render();}}},'Удалить цитату')))));
      });
      $('reader-items').replaceChildren(...(cards.length?cards:[h('p',{class:'empty'},'Подборка пуста. Нажмите «В подборку» у решения. В карточке можно выделить оригинальный текст и сохранить цитату.')]));
      $('reader-compare-panel').replaceChildren();compareStatus();status();
    }
    function pageLabel(q) {return q.printed_pages.length?'Печатные страницы: '+q.printed_pages.join(', ')+'.':'Печатные страницы не определены.';}
    function localQuoteURL(id,q){return '#/d/'+id+'?'+new URLSearchParams({mode:'quote',field:q.field,at:q.start,end:q.end,sha:q.source_sha256});}
    function compareStatus() {$('reader-compare').disabled=compareIds.size<2;$('reader-research').disabled=compareIds.size<2;$('reader-compare-count').textContent='Выбрано для сравнения: '+compareIds.size+' из 4.';}
    async function compare() {
      const current=++token,s=store.getState(), selected=s.items.filter(i=>compareIds.has(i.id));if(selected.length<2)return;
      const box=$('reader-compare-panel');box.replaceChildren(h('p',{},'Загружаем решения для сравнения…'));
      const cases=await Promise.all(selected.map(async item=>{
        const d=docs.get(item.id);if(!d)return h('article',{class:'reader-compare-case'},item.id,' — текст отсутствует в этой версии корпуса.');
        const text=await adapter.textOf(d),pieces=[];let at=0;
        const digest=await hash(text);
        const currentQuotes=item.quotes.filter(q=>q.field==='text' && q.source_sha256===digest && cut(text,q.start,q.end)===q.text_original);
        const spans=currentQuotes.map(q=>({start:q.start,end:q.end})).sort((a,b)=>a.start-b.start);
        // Не подсвечиваем старые координаты после изменения OCR.
        const valid=digest===item.decision.source_sha256 && currentQuotes.length===item.quotes.filter(q=>q.field==='text').length;
        const merged=[];for(const span of spans){const last=merged[merged.length-1];if(last && last.end>=span.start)last.end=Math.max(last.end,span.end);else merged.push({...span});}
        for(const span of merged){pieces.push(cut(text,at,span.start),h('mark',{},cut(text,span.start,span.end)));at=span.end;}pieces.push(cut(text,at));
        return h('article',{class:'reader-compare-case','data-decision-id':item.id},
          h('h3',{},h('a',{href:'#/d/'+item.id+'?mode=reader'},d.vol+' г. № '+d.num)),h('p',{class:'muted small'},d.dept+' · '+adapter.formatDate(d.date,d.date_label)),
          h('p',{},d.headnote),item.decision.source_warning?h('p',{class:'preliminary-note'},item.decision.source_warning):null,h('dl',{},h('dt',{},'Исход (автоматическая метка)'),h('dd',{},d.outcome),h('dt',{},'Темы'),h('dd',{},d.topics.join('; '))),
          h('details',{},h('summary',{},'Упомянутые статьи ('+Object.keys(d.statutes).length+')'),h('ul',{},Object.keys(d.statutes).map(s=>h('li',{},s)))),
          h('h4',{},'Заметка читателя'),h('p',{class:'reader-preserve'},item.note||'Нет заметки.'),
          item.quotes.map(q=>h('section',{},h('blockquote',{class:'source-quote'},q.text_original),q.source_warning?h('p',{class:'preliminary-note'},q.source_warning):null,h('p',{class:'small'},pageLabel(q)),h('a',{href:localQuoteURL(item.id,q)},'Открыть цитату'),q.note?h('p',{class:'reader-preserve'},q.note):null)),
          !valid?h('p',{class:'preliminary-note'},'Текст изменился со времени сохранения. Сохранённые цитаты показаны отдельно; старые координаты не подсвечиваются.'):null,
          h('details',{class:'reader-compare-text'},h('summary',{},'Полный оригинальный текст'),h('div',{class:'reader-full-original'},pieces)));
      }));
      if(current!==token)return;box.replaceChildren(h('h2',{},'Сравнение решений'),h('p',{class:'muted small'},'Оригинальные тексты. Подсветка отмечает ваши сохранённые цитаты; заметки принадлежат читателю.'),h('div',{class:'reader-compare-grid',style:'--reader-columns:'+cases.length},cases));box.scrollIntoView({block:'start'});
    }
    function clearDetail() {detail=null;selected=null;}
    function attachDetail(info) {
      detail=info;selected=null;
      const selectionStatus=h('p',{id:'reader-selection-status',class:'small',role:'status'},adapter.isModern()?'Для выделения цитаты включите дореформенную орфографию.':'Выделите текст в оригинале и нажмите «Сохранить цитату».');
      const quoteButton=h('button',{id:'reader-save-quote',class:'btn ghost',disabled:true,onclick:guarded(async()=>{
        if(!selected || !detail)throw Error('Сначала выделите оригинальный текст.');
        const q={...selected},d=detail.d,text=detail.text;
        store.addQuote(await snapshot(d),await makeQuote(d,q.field,q.start,q.end,text));message('Цитата сохранена вместе с печатными страницами и ссылками на сканы.');
        selectionStatus.textContent='Цитата сохранена в подборке.';
      })},'Сохранить цитату');
      quoteButton.addEventListener('pointerdown',event=>event.preventDefault());
      for(const source of [info.body,info.headnote].filter(Boolean))source.addEventListener('pointerdown',()=>{selected=null;quoteButton.disabled=true;});
      const tools=h('section',{class:'reader-detail-tools'},h('div',{class:'reader-actions'},saveButton(info.d),quoteButton,h('a',{href:'#/reader'},'Открыть подборку'),h('a',{href:'#/research?ids='+info.d.id},'Исследовать это дело')),selectionStatus,h('p',{class:'preliminary-note reader-persistence-hint',hidden:true,role:'status'}));
      if(adapter.isModern())tools.append(h('button',{class:'btn ghost reader-original',onclick:()=>adapter.setModern(false)},'Включить оригинал для цитирования'));
      if(info.target && !info.target.warning && Number.isSafeInteger(info.target.start))tools.append(h('button',{id:'reader-save-target',class:'btn ghost',onclick:guarded(async()=>{
        store.addQuote(await snapshot(info.d),await makeQuote(info.d,info.target.field||'text',info.target.start,info.target.end,info.text));selectionStatus.textContent='Фрагмент сохранён в оригинальной орфографии.';
      })},'Сохранить открытый фрагмент'));
      info.body.before(tools);status();
    }
    async function resolveQuote(d,text,params) {
      const field=params.get('field'),start=Number(params.get('at')),end=Number(params.get('end')),digest=params.get('sha');
      if(!['text','headnote'].includes(field)||!/^\d+$/.test(params.get('at')||'')||!/^\d+$/.test(params.get('end')||'')||!digest||!/^[a-f0-9]{64}$/.test(digest))return {warning:'Ссылка на цитату повреждена или не содержит данных для проверки. Открыто решение целиком.'};
      const source=field==='headnote'?d.headnote:text;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>cp(source).length||start>=end||end-start>R.LIMITS.quote||await hash(source)!==digest)return {warning:'Сохранённая цитата не соответствует этой версии текста. Открыто решение целиком; проверьте цитату в подборке или её JSON-копии.'};
      const found=await location(d,start,end,field);
      return {id:d.id+':reader:'+start+'-'+end,field,start,end,pages:found.printed_pages,sources:found.sources,scans:found.scans,quote_original:cut(source,start,end),ai:{source_warning:found.source_warning}};
    }
    document.addEventListener('selectionchange',()=>{
      if(!detail || !document.contains(detail.body))return;
      const selection=getSelection(),button=$('reader-save-quote');if(!button)return;
      if(adapter.isModern()){button.disabled=true;return;}
      if(!selection || selection.isCollapsed || !selection.rangeCount){button.disabled=!selected;return;}
      try {
        selected=selectionFromRange(selection.getRangeAt(0),$('detail-body'),{text:detail.text,headnote:detail.d.headnote});button.disabled=false;
        $('reader-selection-status').textContent='Выделено символов: '+cp(selected.text_original).length+'. Сохранится оригинальный текст.';
      }catch(_){selected=null;button.disabled=true;}
    });
    $('reader-title').addEventListener('input',event=>{try{store.setTitle(event.target.value);}catch(err){message(err.message,true);}});
    $('reader-note').addEventListener('input',event=>{try{store.setNote(event.target.value);}catch(err){message(err.message,true);}});
    $('reader-compare').addEventListener('click',guarded(compare));
    $('reader-research').addEventListener('click',()=>{location.hash='#/research?'+new URLSearchParams({ids:[...compareIds].join(',')});});
    for(const type of ['json','markdown','html','csv'])$('reader-export-'+type).addEventListener('click',()=>download(type));
    $('reader-import').addEventListener('change',guarded(async event=>{const file=event.target.files[0];event.target.value='';await importFile(file);}));
    $('reader-recover').addEventListener('click',()=>{if(confirm('Перезаписать повреждённое хранилище текущими доступными записями? Сначала сохраните JSON-копию.')){store.recoverStorage();status();}});
    $('reader-export-original').addEventListener('click',guarded(()=>{
      const raw=storage && storage.getItem(store.key);if(raw==null)throw Error('Исходная запись хранилища недоступна.');
      const url=URL.createObjectURL(new Blob([raw],{type:'text/plain;charset=utf-8'}));
      const link=h('a',{href:url,download:'Сенат — исходная запись подборки.txt'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }));
    $('reader-retry').addEventListener('click',()=>{try{store.flush();status();}catch(err){message(err.message,true);}});
    store.subscribe(status);
    addEventListener('storage',event=>{if(event.key===store.key){store.sync();if(!document.activeElement.matches('#view-reader textarea,#reader-title'))render();}});
    status();return {render,saveButton,attachDetail,clearDetail,resolveQuote,store,importFile};
  }
  root.SenatReaderUI={create,selectionFromRange};
})(window);
