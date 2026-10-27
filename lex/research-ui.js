/* Исследование в браузере: справка, матрица дел, заметки, файлы и ссылки. */
(function (root) {
  'use strict';
  const R=root.SenatResearch,KEY='senat.research.v1',MAX_SAVED=20;
  const $=id=>document.getElementById(id);
  const replace=(id,...kids)=>$(id).replaceChildren(...kids.flat(Infinity).filter(k=>k!=null&&k!==false));
  function h(tag,attrs,...kids) {
    const el=document.createElement(tag);
    for(const [key,value] of Object.entries(attrs||{})) {
      if(value==null||value===false)continue;
      if(key.startsWith('on'))el.addEventListener(key.slice(2),value);
      else if(key==='class')el.className=value;
      else el.setAttribute(key,value===true?'':String(value));
    }
    for(const child of kids.flat(Infinity))if(child!=null&&child!==false)el.append(child.nodeType?child:document.createTextNode(String(child)));
    return el;
  }
  function create(adapter) {
    let active=R.state(),report=null,result=null,token=0,ready=null,pending=null,recordId=null,storage=null,records=[],blocked=false;
    let renderedCode='',notice='',persistent=true;
    const docs=new Map(adapter.meta.decisions.map(d=>[d.id,d]));
    function readRecords(raw) {
      if(!raw)return [];
      const saved=JSON.parse(raw);
      if(saved.version!==1||!Array.isArray(saved.records)||saved.records.length>MAX_SAVED)throw Error();
      const rows=saved.records.map(r=>{
        if(typeof r.id!=='string'||!/^[-a-z0-9]{1,80}$/i.test(r.id)||typeof r.updated!=='string'||!Number.isFinite(Date.parse(r.updated)))throw Error();
        return {id:r.id,updated:r.updated,state:R.state(r.state)};
      });
      if(new Set(rows.map(r=>r.id)).size!==rows.length)throw Error();
      return rows;
    }
    try {
      storage=localStorage;const raw=storage.getItem(KEY);
      records=readRecords(raw);
    } catch(_){blocked=true;persistent=false;}
    async function prepare() {if(!ready)ready=adapter.prepare().catch(e=>{ready=null;throw e;});return ready;}
    function message(value,error=false) {$('research-notice').textContent=value;$('research-notice').classList.toggle('reader-error',error);}
    function status() {
      $('research-storage-warning').hidden=persistent;
      $('research-storage-warning').textContent=blocked?'Сохранённые исследования недоступны; исходная запись браузера не перезаписана. Текущую справку можно скачать файлом.':'Не удалось записать исследование в браузер. Скачайте файл до закрытия страницы.';
      $('research-storage-raw').hidden=!blocked||!storage;
      $('research-save-copy').hidden=!report||Boolean(recordId);
      $('research-save-state').textContent=!report?'':recordId&&persistent?'Сохранено в этом браузере.':recordId?'Изменения доступны в памяти; скачайте копию.':'Это полученная справка. Сохраните свою копию для продолжения работы.';
    }
    function rememberURL() {
      if(!recordId||!persistent||!location.hash.startsWith('#/research'))return;
      const params=new URLSearchParams({share:R.encode(active,false),draft:recordId});
      history.replaceState(null,'',location.pathname+location.search+'#/research?'+params);
    }
    function syncNotes() {
      if(!report)return;
      active=R.state(active);report.state=R.state(active);report.title=active.title||active.q||'Сравнение решений Сената';report.notes=active.notes;
      report.cases.forEach(c=>{c.note=active.notes.cases[c.id]||'';});
      $('research-report-title').textContent=report.title;
      // Название могло измениться после отрисовки ссылок. Возврат из цитаты
      // должен относиться к текущей справке и сохранять заметки в памяти.
      for(const a of $('research-output').querySelectorAll('a[href^="#/d/"]')) {
        const [path,query]=a.getAttribute('href').split('?'),params=new URLSearchParams(query);
        if(params.get('mode')==='research'){params.set('back',R.encode(active,false));a.setAttribute('href',path+'?'+params);}
      }
      $('research-share-box').hidden=true;
      if(recordId)persist();
    }
    function persist() {
      if(blocked||!storage||!recordId){status();return;}
      let fresh;
      try{fresh=readRecords(storage.getItem(KEY));}catch(_){blocked=true;persistent=false;status();return;}
      const known=records.find(r=>r.id===recordId),remote=fresh.find(r=>r.id===recordId);
      if(known&&JSON.stringify(known)!==JSON.stringify(remote)) {
        recordId=crypto.randomUUID();message('Справка изменена в другом окне. Ваши правки сохраняются отдельной копией.');
      }
      const row={id:recordId,updated:new Date().toISOString(),state:R.state(active)},at=fresh.findIndex(r=>r.id===recordId);
      if(at<0&&fresh.length>=MAX_SAVED){recordId=null;persistent=false;message('Уже сохранено 20 исследований. Новая справка доступна в памяти; скачайте файл или удалите ненужную сохранённую копию.',true);status();return;}
      const next=fresh.slice();if(at<0)next.unshift(row);else next[at]=row;
      // Запись подтверждается только после успешного setItem.
      try{storage.setItem(KEY,JSON.stringify({version:1,records:next}));records=next;persistent=true;rememberURL();}
      catch(_){persistent=false;}
      status();
    }
    function saveCopy() {
      if(!report)return;recordId=crypto.randomUUID();persist();savedList();
      if(persistent)message('Своя копия сохранена в этом браузере.');
    }
    function savedList() {
      $('research-saved').replaceChildren(...records.map(row=>h('div',{class:'research-saved-row'},
        h('button',{class:'btn ghost',onclick:()=>navigate(row.state,'saved',row.id)},row.state.title||row.state.q||'Сравнение выбранных дел'),
        h('span',{class:'muted small'},new Date(row.updated).toLocaleString('ru-RU')),
        h('button',{class:'research-delete',type:'button','aria-label':'Удалить сохранённое исследование',onclick:()=>{
          if(!confirm('Удалить эту сохранённую справку и заметки из браузера?'))return;
          try{const next=readRecords(storage.getItem(KEY)).filter(r=>r.id!==row.id);storage.setItem(KEY,JSON.stringify({version:1,records:next}));records=next;if(recordId===row.id)recordId=null;savedList();status();}
          catch(_){persistent=false;status();}
        }},'Удалить'))));
      $('research-saved-empty').hidden=records.length>0;
    }
    function navigate(raw,origin='local',id=null) {
      const s=R.state(raw),code=R.encode(s,false);
      pending={state:s,origin,id,code};
      const hash='#/research?share='+code;
      if(location.hash===hash)render(new URLSearchParams({share:code}));else location.hash=hash;
    }
    function quoteLink(q) {
      const url=new URL(q.url),params=new URLSearchParams(url.hash.split('?')[1]);
      params.set('mode','research');params.set('back',R.encode(active,false));
      return '#/d/'+q.decision+'?'+params;
    }
    function evidence(q,open=false) {
      return h('details',{class:'research-evidence',open},
        h('summary',{},R.pageLabel(q)),q.warning?h('p',{class:'preliminary-note'},q.warning):null,
        h('blockquote',{class:'source-quote'},q.text),
        h('div',{class:'research-links'},h('a',{class:'research-quote-link',href:quoteLink(q)},'Цитата в решении и скан'),
          R.scanLinks(q).map(s=>h('a',{href:s.url,target:'_blank',rel:'noopener noreferrer'},s.label))));
    }
    function section(s) {
      return h('section',{class:'research-position','data-section-kind':s.kind},h('h4',{},s.heading),
        h('p',{class:'analysis-speaker'},R.displaySpeaker(s)),h('p',{},s.summary),s.evidence.map(q=>evidence(q)));
    }
    function itemLabel(id) {const d=docs.get(id);return d?d.vol+' г. № '+d.num:id;}
    function scope() {
      return adapter.meta.volumes.map(v=>v.year+' · '+v.dept).join('; ');
    }
    function comparison() {
      if(report.cases.length<2)return h('p',{class:'empty'},'Добавьте ещё одно дело, чтобы сравнить обстоятельства, доводы и рассуждение.');
      const rows=[['headnote','Предмет по заголовку издания'],['relevance','Фрагменты по вопросу'],...R.ROWS,['outcome','Исход (автоматическая метка)'],['statutes','Упоминания норм (метки корпуса)'],['note','Заметка читателя']];
      function cell(c,key) {
        if(key==='headnote')return [h('p',{class:'source-quote'},c.headnote),evidence(c.headnote_evidence)];
        if(key==='relevance')return c.fragments.map(f=>h('section',{},h('p',{},f.summary||'Оригинальный фрагмент'),
          h('p',{class:'small muted'},f.speaker+(f.partial?' · частичное совпадение':'')+(f.browsing?' · добавлено для чтения, совпадение с вопросом не установлено':'')),evidence(f.evidence)));
        if(key==='outcome')return [h('p',{},c.outcome),h('p',{class:'small muted'},'Автоматическая метка; резолютивная часть — в полном решении.')];
        if(key==='statutes')return statutes(c);
        if(key==='note')return h('p',{class:'research-case-note-copy'},active.notes.cases[c.id]||'Нет заметки.');
        const sections=c.sections.filter(s=>s.kind===key);
        return sections.length?sections.map(section):h('p',{class:'muted research-unavailable'},'Подробный разбор этого элемента не подготовлен.');
      }
      return h('div',{class:'research-table-wrap',tabindex:'0','aria-label':'Сравнение решений, таблицу можно прокручивать по горизонтали и вертикали'},
        h('table',{class:'research-table'},h('caption',{},'Дела сопоставлены по одинаковым вопросам. Отличие исхода само по себе не доказывает противоречия судебных позиций.'),
          h('thead',{},h('tr',{},h('th',{scope:'col'},'Элемент дела'),report.cases.map(c=>h('th',{scope:'col'},h('a',{href:'#/d/'+c.id+'?mode=research&back='+R.encode(active,false)},itemLabel(c.id)),h('div',{class:'small'},c.department))))),
          h('tbody',{},rows.map(([key,title])=>h('tr',{'data-compare-row':key},h('th',{scope:'row'},title),report.cases.map(c=>h('td',{'data-compare-case':c.id},cell(c,key))))))));
    }
    function statutes(c) {
      return c.statutes.length?h('ul',{class:'research-statutes'},c.statutes.map(value=>{
        const [code,...rest]=value.split(' ');
        return h('li',{},h('a',{href:'#/laws?'+new URLSearchParams({c:code,q:rest.join(' ')})},(adapter.analytics.codes[code]||'Акт не установлен')+' · '+rest.join(' ')));
      })):h('p',{class:'muted'},'Метки норм отсутствуют.');
    }
    function renderReport() {
      $('research-output').hidden=false;$('research-empty').hidden=true;
      $('research-report-title').textContent=report.title;
      $('research-title').value=active.title;
      $('research-note').value=active.notes.general;
      $('research-coverage').textContent=`Выбрано дел: ${report.cases.length}. Подробных разборов: ${report.coverage.analysed}. Доступные тома: ${scope()}.`;
      replace('research-issues',
        report.corpus_changed?h('p',{class:'preliminary-note'},'Корпус обновился после создания ссылки или файла. Справка собрана заново по текущим текстам; прежние выводы из файла не перенесены.'):null,
        report.coverage.partial?h('p',{class:'search-partial-note'},'Включены частичные совпадения с вопросом. Полного соответствия всех условий не установлено.'):null,
        report.issues.map(issue=>h('p',{class:'preliminary-note'},issue)));
      const positions=report.cases.filter(c=>c.sections.some(s=>['question','reason','holding','limits'].includes(s.kind)));
      $('research-positions').replaceChildren(...(positions.length?positions.map(c=>h('article',{class:'card'},h('h3',{},itemLabel(c.id)+' · '+c.department),
        c.sections.filter(s=>['question','reason','holding'].includes(s.kind)).map(section),
        c.sections.some(s=>s.kind==='limits')?h('details',{},h('summary',{},'Пределы вывода и оговорки'),c.sections.filter(s=>s.kind==='limits').map(section)):null)):[
        h('p',{class:'empty'},'Для выбранных дел отдельная атрибуция позиции Сената не подготовлена. Ниже доступны пояснения и оригинальные фрагменты для чтения.')]));
      $('research-cases').replaceChildren(...report.cases.map(c=>h('article',{class:'card research-case','data-research-case':c.id},
        h('div',{class:'reader-item-top'},h('h3',{},h('a',{href:'#/d/'+c.id+'?mode=research&back='+R.encode(active,false)},itemLabel(c.id))),adapter.reader.saveButton(docs.get(c.id)),
          h('button',{class:'btn ghost research-remove',onclick:()=>{
            const s=R.state(active);s.ids=s.ids.filter(id=>id!==c.id);delete s.notes.cases[c.id];delete s.hashes[c.id];navigate(s,'saved',recordId);
          }},'Убрать из справки')),
        h('p',{class:'muted small'},c.department+' · '+c.date),h('p',{class:'research-headnote'},Lmodern(c.headnote)),
        c.warning?h('p',{class:'preliminary-note'},c.warning):null,
        c.restored?h('p',{class:'small muted'},'Порядок колонок восстановлен по скану; сплошной буквенной вычитки нет.'):null,
        h('p',{class:'small muted'},c.pages.length?'Печатные страницы дела: '+c.pages.join(', '):'Печатные страницы не определены.'),
        h('p',{class:'small'},c.sections.length?'Редакционный разбор с атрибуцией позиций доступен.':'Подробный разбор не подготовлен; автор позиции в отдельных фрагментах не установлен.'),
        c.fragments.map((f,i)=>h('section',{class:'research-fragment'},
          h('p',{class:'analysis-label'},f.neighbor?'Соседний контекст':f.browsing?'Фрагмент для чтения · соответствие вопросу не установлено':f.partial?'Частичное совпадение с вопросом':'Фрагмент по вопросу'),
          f.summary?h('p',{},h('strong',{},'Пояснение ИИ: '),f.summary):null,
          h('p',{class:'small muted'},f.speaker),evidence(f.evidence,i===0))),
        c.sections.length?h('details',{class:'research-full-analysis'},h('summary',{},'Обстоятельства, доводы и полный разбор'),c.sections.map(section)):null,
        noteInput(c.id))));
      $('research-comparison').replaceChildren(comparison());
      replace('research-differences',report.comparisons.map(c=>h('article',{class:'card'},h('h3',{},c.heading),h('p',{},c.summary),
        h('p',{class:'small muted'},'Редакционное сравнение, подготовленное с помощью ИИ. '+c.scope),c.evidence.map(q=>evidence(q)),h('details',{},h('summary',{},'Пределы сравнения'),h('p',{},c.limits)))),
        report.shared_statutes.length?h('div',{},h('h3',{},'Общие упоминания норм'),h('ul',{},report.shared_statutes.map(row=>h('li',{},row.statute+' — '+row.ids.map(itemLabel).join('; ')))),h('p',{class:'small muted'},'Совпадение меток норм помогает сопоставить дела, но не устанавливает одинаковый предмет спора или противоречие позиций.')):null,
        !report.comparisons.length?h('p',{class:'muted'},'Отдельный редакционный вывод о сходствах и различиях для этого сочетания дел не подготовлен. Сопоставьте обстоятельства и цитаты в таблице.'):null);
      const remaining=result.candidates.filter(id=>!active.ids.includes(id));
      $('research-candidates').replaceChildren(...remaining.map(id=>h('button',{class:'btn ghost research-add-candidate',disabled:active.ids.length>=R.LIMITS.cases,onclick:()=>add(id)},itemLabel(id)+' · '+Lmodern(docs.get(id).headnote).slice(0,130))));
      $('research-candidate-count').textContent=result.candidates.length?`Найдено разных дел: ${result.candidates.length}. В справку можно включить до шести.`:'Полных совпадений с вопросом не найдено. Можно уточнить формулировку или добавить дело вручную.';
      $('research-partial').hidden=!result.suggested;
      $('research-partial').textContent='Показать частичные совпадения ('+result.suggested+')';
      savedList();status();
    }
    function Lmodern(s){return root.Lex.modernize(s);}
    function noteInput(id) {
      const area=h('textarea',{'aria-label':'Заметка к делу '+itemLabel(id),rows:2,maxlength:R.LIMITS.caseNote,oninput:()=>{
        active.notes.cases[id]=area.value;syncNotes();
        for(const cell of $('research-comparison').querySelectorAll('[data-compare-case="'+id+'"] .research-case-note-copy'))cell.textContent=area.value||'Нет заметки.';
      }});area.value=active.notes.cases[id]||'';
      return h('label',{class:'research-note-label'},'Моя заметка к делу',area);
    }
    async function render(params) {
      const current=++token;message('');savedList();
      try {
        const code=params.get('share')||params.get('back');
        if(!pending&&code&&report&&(code===renderedCode||code===R.encode(active,false))){rememberURL();status();return;}
        let incoming,origin='shared',id=null;
        if(code) {
          if(pending?.code===code){incoming=pending.state;origin=pending.origin;id=pending.id;pending=null;}
          else {
            incoming=R.decode(code);
            const saved=params.get('draft')&&records.find(row=>row.id===params.get('draft')&&R.encode(row.state,false)===code);
            if(saved){incoming=saved.state;origin='saved';id=saved.id;}
          }
        }else if(params.get('q')||params.get('ids')){
          incoming=R.state({q:params.get('q')||'',terms:params.get('terms')||params.get('q')||'',ids:(params.get('ids')||'').split(',').filter(Boolean),year:params.get('y')||'',department:params.get('dept')||''});origin='local';
        }else {
          report=null;active=R.state();$('research-output').hidden=true;$('research-empty').hidden=false;status();return;
        }
        const s=R.state(incoming);
        if(s.year&&!adapter.meta.volumes.some(v=>String(v.year)===s.year))throw Error('Этот год отсутствует в корпусе.');
        if(s.department&&!adapter.meta.volumes.some(v=>v.dept===s.department))throw Error('Этот департамент отсутствует в корпусе.');
        $('research-q').value=s.q;$('research-terms').value=s.terms;$('research-year').value=s.year;$('research-department').value=s.department;
        $('research-status').textContent='Собираем справку и проверяем цитаты…';
        $('research-output').hidden=true;
        const a=await prepare();if(current!==token)return;
        const found=R.find(a.engines,a.config,s,adapter.meta),compiled=await a.context.compile(s,found);
        if(current!==token)return;
        active=compiled.state;report=compiled;result=found;renderedCode=code||R.encode(active,false);recordId=id;
        $('research-q').value=active.q;$('research-terms').value=active.terms;$('research-year').value=active.year;$('research-department').value=active.department;
        $('research-status').textContent=report.cases.length?'Справка готова. Цитаты сверены с текущим текстом OCR.':'По выбранным условиям дел не найдено.';
        renderReport();
        if(origin==='local'){recordId=crypto.randomUUID();persist();savedList();}
        else if(origin==='saved'){
          if(JSON.stringify(records.find(row=>row.id===recordId)?.state)!==JSON.stringify(active))persist();
          rememberURL();savedList();
        }
        else message(origin==='import'?'Файл открыт. Цитаты и разборы восстановлены по текущему корпусу; заметки сохранены.':'Открыта полученная справка. Заметки не меняют вашу рабочую подборку.');
      }catch(err){if(current===token){$('research-status').textContent='';message(err.message,true);$('research-output').hidden=true;$('research-empty').hidden=false;}}
    }
    function add(id) {
      if(!docs.has(id))return;
      if(active.ids.includes(id)){message('Это дело уже включено в справку.');return;}
      if(active.ids.length>=R.LIMITS.cases){message('В справке можно сравнить до шести дел.',true);return;}
      navigate({...active,manual:true,ids:[...active.ids,id]},recordId?'saved':'local',recordId);
    }
    function download(kind) {
      if(!report)return;
      const mime={json:'application/json',md:'text/markdown;charset=utf-8',html:'text/html;charset=utf-8'}[kind];
      const content=kind==='json'?JSON.stringify(report,null,2):kind==='md'?R.markdown(report):R.html(report);
      blobDownload(content,mime,'Сенат — '+report.title.replace(/[\\/:*?"<>|\x00-\x1f]/g,' ').slice(0,80)+'.'+kind);
      message('Справка выгружена. Текст доступен без сети; ссылки на сайт и сканы требуют интернета.');
    }
    function blobDownload(content,mime,name) {
      const url=URL.createObjectURL(new Blob([content],{type:mime})),a=h('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    $('research-form').addEventListener('submit',async event=>{
      event.preventDefault();try {
        const q=$('research-q').value.trim(),entered=$('research-terms').value.trim();
        if(!q&&!entered){message('Введите вопрос или добавьте дело для сравнения.',true);return;}
        const a=await prepare();
        const terms=entered&&entered!==active.terms?entered:R.suggestTerms(q,a.config.glossary);
        navigate({q,terms,year:$('research-year').value,department:$('research-department').value});
      }catch(err){message(err.message,true);}
    });
    $('research-q').addEventListener('input',()=>{$('research-terms').value='';});
    for(const a of document.querySelectorAll('[data-research-scroll]'))a.addEventListener('click',event=>{event.preventDefault();$(a.dataset.researchScroll).scrollIntoView({behavior:'smooth',block:'start'});});
    $('research-partial').addEventListener('click',()=>navigate({...active,ids:[],manual:false,partial:true},'local'));
    $('research-title').addEventListener('input',()=>{active.title=$('research-title').value;syncNotes();});
    $('research-note').addEventListener('input',()=>{active.notes.general=$('research-note').value;syncNotes();});
    $('research-save-copy').addEventListener('click',saveCopy);
    $('research-share').addEventListener('click',async()=>{
      try {
        const url=R.shareURL(active,$('research-share-notes').checked);$('research-share-url').value=url;$('research-share-box').hidden=false;
        try{await navigator.clipboard.writeText(url);message('Ссылка скопирована'+($('research-share-notes').checked?' вместе с вашими заметками.':'. Ваши заметки в неё не включены.'));}
        catch(_){$('research-share-url').focus();$('research-share-url').select();message('Ссылка готова. Скопируйте её из поля.');}
      }catch(err){message(err.message,true);}
    });
    $('research-share-notes').addEventListener('change',()=>{$('research-share-box').hidden=true;});
    for(const kind of ['html','md','json'])$('research-export-'+kind).addEventListener('click',()=>download(kind));
    $('research-import').addEventListener('change',async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      try{if(file.size>R.LIMITS.file)throw Error('Файл превышает 2 МБ.');navigate(R.importState(await file.text()),'import');}
      catch(err){message(err.message,true);}
    });
    $('research-storage-raw').addEventListener('click',()=>{try{blobDownload(storage.getItem(KEY)||'','text/plain;charset=utf-8','Сенат — исходная запись исследований.txt');}catch(err){message(err.message,true);}});
    $('research-add').addEventListener('input',()=>{
      const query=Lmodern($('research-add').value.trim()).toLowerCase(),terms=root.Lex.stems(query);
      const found=query?adapter.meta.decisions.filter(d=>d.id.includes(query)||terms.length&&terms.every(t=>root.Lex.stems(d.headnote).includes(t))).slice(0,8):[];
      $('research-add-results').replaceChildren(...found.map(d=>h('button',{class:'btn ghost',onclick:()=>add(d.id)},itemLabel(d.id)+' · '+Lmodern(d.headnote).slice(0,150))));
    });
    const examples=[
      ['Когда сделку считали мнимой?','фиктивные сделки',[]],
      ['Кто продолжает дело после смерти участника?','наследники процесс',['1904-034','1905-083']],
      ['За что отвечает нотариус?','ответственность нотариуса',['1897-041','1904-050','1904-105']],
      ['Когда перевозчик возмещает убытки?','ответственность перевозчика',['1904-030','1905-022','1905-101']],
      ['Вред здоровью и производственная травма','производственная травма',[]],
      ['Кто должен доказывать свои требования?','бремя доказывания',[]]
    ];
    $('research-examples').replaceChildren(...examples.map(([q,terms,ids])=>h('button',{class:'research-example',onclick:()=>navigate({q,terms,ids})},q,
      h('span',{class:'small muted'},ids.length?'Сопоставление '+ids.length+' дел с редакционным разбором':'Подобрать дела из корпуса'))));
    for(const year of adapter.meta.volumes)$('research-year').append(h('option',{value:year.year},year.year));
    for(const dept of new Set(adapter.meta.volumes.map(v=>v.dept)))$('research-department').append(h('option',{value:dept},dept));
    savedList();status();
    return {render,cancel:()=>{token++;},getReport:()=>report};
  }
  root.SenatResearchUI={create};
})(window);
