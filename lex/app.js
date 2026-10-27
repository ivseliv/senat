/* Интерфейс: поиск по решениям Сената и аналитика. Зависит от lex.js (Lex). */
(function () {
  'use strict';
  const L = window.Lex;
  const $ = (s, r) => (r || document).querySelector(s);
  const DATA = window.LEX_DATA_URL || 'data/';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MODERN_CONCEPTS = [
    ['Сделки и договоры', ['недействительность сделки', 'оспаривание сделки', 'толкование договора', 'расторжение договора', 'неосновательное обогащение']],
    ['Убытки и ответственность', ['возмещение убытков', 'неустойка', 'причинная связь', 'вина потерпевшего', 'возмещение вреда здоровью']],
    ['Недвижимость', ['право собственности', 'общая собственность', 'раздел имущества', 'регистрация недвижимости', 'приобретательная давность']],
    ['Наследство', ['завещание', 'принятие наследства', 'исполнитель завещания', 'отказ от наследства', 'оспаривание завещания']],
    ['Судебный процесс', ['исковая давность', 'бремя доказывания', 'судебные расходы', 'представительство', 'кассация']],
    ['Предпринимательство', ['перевозка грузов', 'банкротство', 'уступка права требования', 'страховое возмещение', 'акционерное общество']],
    ['Семья и труд', ['алименты', 'сделка несовершеннолетнего', 'недееспособность', 'трудовой договор', 'производственная травма']],
  ];
  const FACET_FILTERS = [
    {key:'gender', id:'f-gender', param:'sex', any:'Любой пол'},
    {key:'age', id:'f-age', param:'age', any:'Любой возраст / дееспособность'},
    {key:'family', id:'f-family', param:'family', any:'Любое семейное положение'},
    {key:'estate', id:'f-estate', param:'estate', any:'Любое сословие / занятие'},
    {key:'entity', id:'f-entity', param:'entity', any:'Любой тип организации'},
    {key:'role', id:'f-role', param:'role', any:'Любое правовое положение'},
  ];

  const S = {
    meta: null, index: null, an: null, engine: null, texts: {}, reader: null, research: null, places: null,
    opts: { modern: false, gloss: true, ocr: true }, detailId: null,
    sense: { config: null, engines: [], promise: null, q: '', topic: '', year: '', hits: [], shown: 10, token: 0, partial: false, suggested: 0 },
    map: { q: '', topic: '', token: 0 },
    laws: { q: '', code: '', page: 1, data: null, promise: null, token: 0, passages: {} },
    analyses: { data: null, promise: null, documents: {}, searchPromise: null, engine: null, token: 0, shown: 24, key: '' },
    precedents: { data: null, promise: null },
    guides: { data: null, promise: null, catalog: null, catalogPromise: null, token: 0, shown: 30, key: '' },
    api: { data: null, promise: null },
    participants: {q:'', year:'', shown:60}, participantMap: new Map(),
    f: { q: '', year: '', outcome: '', topic: '', code: '', statute: '', procedure: '', person: '', participant: '', gender: '', age: '', family: '', estate: '', entity: '', role: '', sort: 'rel' }, shown: 20, hits: [], sentinel: 0,
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, k==='href' ? versionedLink(v) : v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  }
  function versionedLink(value) {
    if (typeof value!=='string') return value;
    const match=value.match(/^(?:https:\/\/ivseliv\.github\.io\/senat\/lex\/)?#\/d\/(\d{4}-\d{3})\?(.*)$/);
    const revision=match && S.an?.source_revisions?.[match[1]];
    if (!revision) return value;
    const params=new URLSearchParams(match[2]);
    if (!params.has('at') || params.has('v')) return value;
    params.set('v',revision.version);
    return value.slice(0,value.indexOf('?')+1)+params;
  }
  const M = t => S.opts.modern ? L.modernize(t) : t;
  const fmtDate = (iso, label) => { if (!iso) return label ? M(label) : ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const CODE = () => S.an.codes;
  const statuteCode = s => s.split(' ', 1)[0];
  const codeLabel = code => code === '?' ? 'Акт не установлен' : (CODE()[code] || 'Иной акт');
  const statLabel = s => { const [code, ...rest] = s.split(' '); return codeLabel(code) + ', ' + rest.join(' '); };
  const deptShort = d => d.replace(' департамент', '').replace('Гражданский кассационный', 'Гражд. касс. деп.');
  const topicList = () => S.meta.topic_vocabulary || S.guides.catalog?.topics || [];
  const topicId = value => S.meta.topic_aliases?.[value] || topicList().find(t=>t.id===value||t.title===value)?.id || value;
  const topicTitle = value => topicList().find(t=>t.id===topicId(value))?.title || value;
  const topicIds = d => d.topic_ids || S.guides.catalog?.decisions[d.id]?.topics.map(t=>t.id) || [];
  const inTopic = (d,value) => !value || topicIds(d).includes(topicId(value));
  function topicChips(d,mode='search',extra={}) {
    return h('div',{class:'chips editorial-topics'},...topicIds(d).map(id=>h('a',{class:'chip',href:'#/'+mode+'?'+new URLSearchParams({...extra,t:id})},topicTitle(id))));
  }
  function ocrNotice(hit) {
    if(!hit?.ocr)return null;
    const changes=[...new Set((hit.corrections||[]).map(c=>'«'+c.from+'» → «'+c.to+'»'))];
    return h('p',{class:'small search-ocr-note'},'Совпадение с учётом OCR или опечатки'+(changes.length?': '+changes.join('; '):'')+'. Исходный текст сохранён.');
  }
  const correctionTerms = hit => (hit?.corrections||[]).map(c=>c.to);
  function sourceWarning(d) {
    const note = S.an.source_warnings && S.an.source_warnings[d.id];
    return note ? h('details',{class:'preliminary-note source-warning'},
      h('summary',{},`Ограничение источника: дефекты OCR в ${note.passages.length} фрагментах`),
      ...note.messages.map(message=>h('p',{},message))) : S.an.source_revisions?.[d.id] ?
      h('p',{class:'small muted'},'Порядок колонок и границы решения восстановлены по скану. Отдельные буквы, имена и числа не вычитаны сплошь.') : null;
  }

  const releaseURL = url => window.LEX_RELEASE ? url + (url.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(window.LEX_RELEASE) : url;
  async function loadJSON(name) { if (window.LEX_INLINE && window.LEX_INLINE[name]) return window.LEX_INLINE[name]; const r = await fetch(releaseURL(DATA + name)); if (!r.ok) throw new Error(name + ': ' + r.status); return r.json(); }
  async function loadVol(y) { if (!S.texts[y]) S.texts[y] = loadJSON(`text-${y}.json`); return S.texts[y]; }
  async function textOf(d) { return (await loadVol(d.vol))[localIndex(d)]; }
  async function loadAnalysesIndex() {
    if (!S.analyses.promise) S.analyses.promise = loadJSON('decision-analyses-index.json').then(data => (S.analyses.data = data)).catch(err=>{S.analyses.promise=null;throw err;});
    return S.analyses.promise;
  }
  async function loadAnalysisSearch() {
    if(!S.analyses.searchPromise)S.analyses.searchPromise=Promise.all([loadJSON('analysis-search.json'),loadAnalysesIndex(),loadJSON('concepts.json')]).then(([data,index,config])=>{
      if(data.count!==S.meta.decisions.length||Object.keys(data.decisions).length!==data.count)throw Error('Неполный поисковый каталог разборов');
      for(const c of Object.values(data.decisions))if(c.source_sha256!==index.decisions[c.id]?.source_sha256)throw Error('Поисковый каталог разборов устарел');
      S.sense.config=S.sense.config||config;
      return S.analyses.engine=window.AnalysisSearch.makeEngine(data,config.glossary);
    }).catch(err=>{S.analyses.searchPromise=null;throw err;});
    return S.analyses.searchPromise;
  }
  async function loadAnalysis(id) {
    const catalog=await loadAnalysesIndex(),entry=catalog.decisions[id];
    if(!entry)return null;
    if(!S.analyses.documents[id])S.analyses.documents[id]=(async()=>{
      let doc;
      if(window.LEX_INLINE?.['decision-analyses.json'])doc=window.LEX_INLINE['decision-analyses.json'].decisions[id];
      else {
        if(entry.id!==id||entry.file!=='analyses/'+id+'.json'||!/^[a-f0-9]{64}$/.test(entry.sha256))throw Error('Неверная запись каталога разбора '+id);
        const response=await fetch(DATA+entry.file+'?v='+entry.sha256);
        if(!response.ok)throw Error('Разбор '+id+': '+response.status);
        const raw=await response.text();
        if(await window.SenatResearch.hash(raw)!==entry.sha256)throw Error('Разбор '+id+' не соответствует каталогу. Обновите страницу.');
        doc=JSON.parse(raw);
      }
      if(!doc||doc.id!==id||doc.source_sha256!==entry.source_sha256)throw Error('Версия источника разбора '+id+' не соответствует каталогу.');
      return doc;
    })().catch(err=>{delete S.analyses.documents[id];throw err;});
    return S.analyses.documents[id];
  }
  async function loadPrecedents() {
    if (!S.precedents.promise) S.precedents.promise=loadJSON('precedents.json').then(data=>(S.precedents.data=data)).catch(err=>{S.precedents.promise=null;throw err;});
    return S.precedents.promise;
  }
  function precedentTarget(ref) {
    return ref.status==='linked' && S.meta.decisions.find(d=>d.id===ref.target_id && d.dept===ref.department && d.vol===ref.year && d.num===ref.number);
  }
  function precedentLabel(ref) {
    return (ref.department || 'Департамент не установлен')+' · '+ref.year+' г. № '+ref.number;
  }
  function precedentGroups(refs, incoming) {
    const groups=new Map();
    for(const ref of refs) {
      const key=incoming ? ref.source_id : JSON.stringify([ref.department,ref.year,ref.number,ref.target_id,ref.status]);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(ref);
    }
    return [...groups.values()];
  }
  function precedentEvidence(ref) {
    return h('div',{},h('blockquote',{class:'precedent-context'},M(ref.context_original)),
      h('p',{class:'small'},h('a',{class:'precedent-source',href:ref.source_url},'Показать место ссылки в тексте'+(ref.pages.length ? ' · с. '+ref.pages.join(', ') : ''))));
  }
  function precedentEntry(refs, incoming) {
    const ref=refs[0], target=precedentTarget(ref), source=S.meta.decisions.find(d=>d.id===ref.source_id);
    const label=incoming ? source.dept+' · '+source.vol+' г. № '+source.num : precedentLabel(ref);
    const link=incoming ? ref.source_url : target ? '#/d/'+target.id : null;
    const note=incoming || target ? '' : ref.status==='department_unknown' ? 'Департамент не указан в ссылке; тождество решения не установлено.' :
      ref.status==='not_in_corpus' ? 'Решения этого департамента, года и номера нет в корпусе.' : 'Тождество решения неоднозначно; переход не установлен.';
    return h('li',{'data-precedent-status':ref.status,'data-precedent-year':String(ref.year),'data-precedent-number':String(ref.number)},
      link ? h('a',{class:incoming?'precedent-incoming':'precedent-target',href:link},label) : h('strong',{},label),
      note ? h('p',{class:'muted small'},note) : '',precedentEvidence(ref),
      refs.length>1 ? h('details',{},h('summary',{},'Ещё упоминания: '+(refs.length-1)),refs.slice(1).map(precedentEvidence)) : '');
  }
  async function loadGuides() {
    if (!S.guides.promise) S.guides.promise = loadJSON('guides.json').then(data => (S.guides.data = data));
    return S.guides.promise;
  }
  async function loadTopicCatalog() {
    if (!S.guides.catalogPromise) S.guides.catalogPromise=loadJSON('topic-catalog.json').then(data=>(S.guides.catalog=data)).catch(err=>{S.guides.catalogPromise=null;throw err;});
    return S.guides.catalogPromise;
  }
  function apiURL(name) {
    return (window.LEX_INLINE ? 'https://ivseliv.github.io/senat/lex/api/v1/' : 'api/v1/') + name;
  }
  async function loadApi() {
    if (!S.api.promise) S.api.promise = fetch(releaseURL(apiURL('manifest.json'))).then(r => {
      if (!r.ok) throw new Error('manifest.json: ' + r.status);
      return r.json();
    }).then(data => (S.api.data = data));
    return S.api.promise;
  }
  function localIndex(d) { return d.i - S.volStart[d.vol]; }

  /* Сканы: метаданные по томам, картинки только при показе/открытии. */
  const scanData = new Map();
  function loadScans(year) {
    const volume = S.meta.volumes.find(v => Number(v.year) === Number(year));
    // Том с единым текстом без проверяемой постраничной разметки не должен
    // запрашивать несуществующий манифест и создавать видимость сканов.
    if (volume && volume.scans === false) return Promise.resolve({passages:{}, decisions:{}, pages:{}});
    if (!scanData.has(year)) scanData.set(year, loadJSON(`scans-${year}.json`).catch(err => { scanData.delete(year); throw err; }));
    return scanData.get(year);
  }
  function scanURL(path) {
    return (window.LEX_SCAN_URL || (window.LEX_INLINE ? 'https://ivseliv.github.io/senat/lex/' : './')) + path;
  }
  function scanLabel(d, ref) {
    if (ref.index) return `Том ${d.vol} · указатель · ` + (ref.printed_page ? `с. ${ref.printed_page}` : 'страница без печатного номера');
    return `Том ${d.vol} · ` + (ref.page == null ? `лист ${ref.file.replace('.txt','')}, печатный номер не определён` : `с. ${ref.page}`);
  }
  function openScan(d, ref) {
    const label = scanLabel(d, ref);
    const image = h('img', {src:scanURL(ref.full), alt:`Полная страница издания: ${label}`, width:ref.width});
    const sheet = h('div', {class:'scan-sheet'}, image);
    if (ref.box) sheet.append(h('div', {class:'scan-outline', style:`top:${ref.box[1]*100}%;height:${(ref.box[3]-ref.box[1])*100}%`, 'aria-hidden':'true'}));
    const viewer = h('div', {class:'scan-scroll'}, sheet);
    const dialog = h('dialog', {class:'scan-dialog', 'aria-label':`Скан: ${label}`},
      h('div', {class:'scan-toolbar'}, h('strong',{},label),
        h('button',{class:'btn ghost',onclick:e=>{const zoom=sheet.classList.toggle('zoom');e.target.textContent=zoom?'По ширине':'Увеличить';}},'Увеличить'),
        h('a',{href:scanURL(ref.full),target:'_blank',rel:'noopener'},'Открыть изображение'),
        h('button',{class:'btn ghost',onclick:()=>dialog.close(),'aria-label':'Закрыть скан'},'Закрыть')),
      viewer);
    image.addEventListener('error',()=>viewer.replaceChildren(h('p',{},'Не удалось загрузить скан. Проверьте подключение и попробуйте открыть изображение по ссылке.')));
    dialog.addEventListener('close',()=>dialog.remove());
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
    document.body.append(dialog); dialog.showModal();
  }
  function scanFigure(d, ref) {
    const label = scanLabel(d, ref);
    if (window.LEX_INLINE && location.protocol==='file:') return h('p',{class:'small'},
      h('a',{href:scanURL(ref.full),target:'_blank',rel:'noopener'},`${label} — скан на сайте (нужен интернет)`));
    const img = h('img',{class:'scan-img',src:scanURL(ref.image || ref.full),loading:'lazy',decoding:'async',
      width:ref.width,height:ref.height,alt:`${ref.kind==='fragment'?'Фрагмент':'Полная страница'}: ${label}`});
    const button=h('button',{class:'scan-preview',onclick:()=>openScan(d,ref),'aria-label':`Открыть всю страницу: ${label}`},img);
    const caption=h('figcaption',{class:'small muted'},`${label} · ${ref.kind==='fragment'?'фрагмент страницы':'страница целиком; точный участок не определён'}`,
      h('button',{class:'scan-open',onclick:()=>openScan(d,ref)},'Открыть всю страницу'));
    img.addEventListener('error',()=>button.replaceChildren(h('span',{class:'small'},'Скан не загрузился. Открыть страницу')));
    return h('figure',{class:'scan-figure','data-source':ref.file,'data-kind':ref.kind},button,caption);
  }
  function scanStrip(d, refs) {
    const box=h('div',{class:'scan-strip'},refs.slice(0,2).map(r=>scanFigure(d,r)));
    if(refs.length>2) box.append(h('details',{},h('summary',{},`Ещё страницы этого фрагмента (${refs.length-2})`),refs.slice(2).map(r=>scanFigure(d,r))));
    return box;
  }
  function bestScanPassage(manifest, d, text, qs) {
    const candidates=Object.keys(manifest.passages).filter(id=>id.startsWith(d.id+':'));
    let best=null, score=-1;
    for(const id of candidates) {
      const [start,end]=id.split(':')[1].split('-').map(Number);
      const part=window.Concept.slice(text,start,end), ss=L.stems(part);
      const unique=new Set(ss), found=qs.filter(q=>unique.has(q));
      const n=new Set(found).size*100 + ss.filter(q=>qs.includes(q)).length;
      if(n>score) {score=n;best={id,start,end,text:part};}
    }
    return best;
  }

  /* ---------------------------------------------------------------- маршрутизация */
  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#\/?[^?]*\??/, ''));
    const path = location.hash.replace(/^#\/?/, '').split('?')[0];
    return { path, p };
  }
  function go(path, params) {
    const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString() : '';
    location.hash = '#/' + path + (qs === '?' ? '' : qs);
  }
  function route() {
    const { path, p } = readHash();
    S.opts.ocr=p.get('ocr')!=='0';
    for(const id of ['search-ocr','sense-ocr'])if($('#'+id))$('#'+id).checked=S.opts.ocr;
    const requested = path.startsWith('d/') ? (['sense','participants','map','places','laws','analyses','analysis','guides','reader','quote','research'].includes(p.get('mode')) ? (p.get('mode') === 'analysis' ? 'analyses' : p.get('mode') === 'quote' ? 'reader' : p.get('mode')) : 'search') : (path.split('/')[0] || 'search');
    const tab = ['research','search','sense','map','places','laws','participants','guides','analyses','reader','api','analytics','about'].includes(requested) ? requested : 'search';
    const preservePlacesScroll=tab==='places'&&!$('#view-places').hidden;
    if(tab!=='research')S.research.cancel();
    if(tab!=='places')S.places.cancel();
    for (const t of ['research','search','sense','map','places','laws','participants','guides','analyses','reader','api','analytics','about']) {
      $('#view-' + t).hidden = t !== tab;
      $('#tab-' + t).setAttribute('aria-current', t === tab ? 'page' : 'false');
    }
    if (tab === 'search') {
      Object.assign(S.f, { q: p.get('q') || '', year: p.get('y') || '', outcome: p.get('o') || '', topic: topicId(p.get('t') || ''),
        code: p.get('c') || '', statute: p.get('s') || '', procedure: p.get('r') || '', person: p.get('p') || '', participant: p.get('u') || '', sort: p.get('sort') || 'rel' },
        Object.fromEntries(FACET_FILTERS.map(f => [f.key, p.get(f.param) || ''])));
      syncControls(); runSearch();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'sense') {
      S.sense.q = p.get('q') || ''; S.sense.topic=topicId(p.get('t')||''); S.sense.year=p.get('y')||'';
      $('#sense-q').value = S.sense.q; $('#sense-topic').value=S.sense.topic; $('#sense-year').value=S.sense.year; runSense();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'map') {
      S.map.q = p.get('q') || ''; S.map.topic = topicId(p.get('t') || '');
      $('#map-q').value = S.map.q; $('#map-topic').value = S.map.topic; renderMap();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'places') {
      S.places.render(p);
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'laws') {
      S.laws.q = p.get('q') || ''; S.laws.code = p.get('c') || '';
      S.laws.page = Math.max(1, parseInt(p.get('page'), 10) || 1);
      $('#laws-q').value = S.laws.q; $('#laws-code').value = S.laws.code; renderLaws();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'participants') {
      Object.assign(S.participants, {q:p.get('q') || '', year:p.get('y') || '', shown:60});
      renderParticipants();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'analyses') {
      renderAnalyses();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'guides') {
      renderGuides();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'research') {
      S.research.render(p);
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'reader') {
      S.reader.render();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'api') {
      renderApi(); closeDetail();
    } else closeDetail();
    if (tab === 'analytics') renderAnalytics();
    if (tab === 'about') renderCorpus();
    if(!preservePlacesScroll)window.scrollTo(0, path.startsWith('d/') ? window.scrollY : 0);
  }
  async function renderGuides(more=false) {
    const box=$('#guides-results'),status=$('#guides-status'),token=++S.guides.token;
    const params=readHash().p,requested=params.get('g')||'',year=params.get('y')||'',query=params.get('q')||'';
    if(!more)box.replaceChildren(h('p',{class:'muted'},'Загрузка каталога тем…'));
    try {
      const [data,catalog,,config]=await Promise.all([loadGuides(),loadTopicCatalog(),loadAnalysesIndex(),loadJSON('concepts.json')]);
      if(token!==S.guides.token || $('#view-guides').hidden)return;
      const selected=catalog.route_aliases[requested]||topicId(requested);
      const key=[selected,year,query].join('|');
      if(key!==S.guides.key){S.guides.key=key;S.guides.shown=30;}
      const topic=catalog.topics.find(t=>t.id===selected),listing=!!selected;
      const scoped=c=>!year || String(c.year)===year;
      const matcher=window.AnalysisSearch.compile(query,config.glossary);
      const matches=t=>matcher.score(t)>=0;
      const link=(id,extra={})=>'#/guides?'+new URLSearchParams(Object.entries({g:id,y:year,...(id?{catalog:'1'}:{}),...extra}).filter(([,v])=>v));
      const select=$('#guides-year');
      select.replaceChildren(h('option',{value:''},'Все тома'),...S.meta.volumes.map(v=>h('option',{value:v.year},`${v.year} · ${v.dept}`)));
      select.value=year;
      $('#guides-q-label').textContent=listing?'Найти решение в этом разделе':'Найти тему';
      $('#guides-q').placeholder=listing?'Современное название, предмет или участник':'Например: алименты, банкротство, наследство';
      $('#guides-q').value=query;
      const submit=()=>go('guides',{g:requested,y:select.value,q:$('#guides-q').value.trim(),catalog:params.get('catalog')||'',compare:params.get('compare')||''});
      select.onchange=submit;$('#guides-filter').onsubmit=e=>{e.preventDefault();submit();};
      const nav=h('nav',{class:'chips guide-nav','aria-label':'Каталог тем'},
        h('a',{class:'chip',href:link('')},'Все темы'),h('a',{class:'chip',href:link('all')},'Все решения'),
        catalog.unclassified.length?h('a',{class:'chip',href:link('unclassified')},'Требуют уточнения: '+catalog.unclassified.length):null);
      const coverage=`${catalog.topic_count} тем · ${catalog.count} решений · тематически размечено ${catalog.classified}/${catalog.count}.`;
      if(!listing){
        const topics=catalog.topics.filter(t=>t.count && matches([t.title,t.description,...(t.keywords||[])].join(' ')));
        status.textContent=coverage+` Показано тем: ${topics.length}. Одно дело может входить в несколько разделов.`;
        const cards=topics.map(t=>{
          const count=t.decision_ids.filter(id=>scoped(catalog.decisions[id])).length;
          const comp=data.guides.find(g=>g.id===t.comparison_guide)?.comparison;
          return h('article',{class:'card topic-card','data-topic':t.id},h('h3',{},h('a',{href:link(t.id)},t.title)),
            h('p',{},t.description),h('p',{class:'topic-count'},`${count} ${plural(count,'решение','решения','решений')}`+(year?' в выбранном томе':'')),
            h('a',{href:link(t.id)},'Открыть решения →'),
            comp?h('p',{class:'small'},h('a',{href:link(t.id,{compare:'1'})},'Подробное сравнение '+comp.cases.length+' дел')):null);
        });
        box.replaceChildren(nav,h('div',{class:'topic-grid'},...cards),!cards.length?h('p',{class:'empty'},'Такая тема не найдена. Попробуйте другое название или откройте все темы.'):null);
        return;
      }
      if(!topic && !['all','unclassified'].includes(selected)){
        status.textContent=coverage;
        box.replaceChildren(nav,h('p',{class:'empty'},'Тема не найдена. Откройте каталог тем выше.'));return;
      }
      const ids=topic?topic.decision_ids:selected==='all'?Object.keys(catalog.decisions):catalog.unclassified;
      const search=query.trim()?await loadAnalysisSearch():null;
      if(token!==S.guides.token)return;
      const cases=ids.map(id=>catalog.decisions[id]).filter(scoped).filter(c=>matches(c.title+' '+c.summary+' '+S.meta.decisions.find(d=>d.id===c.id).headnote+' '+(search?search.caseText(c.id):'')));
      status.textContent=coverage+` В разделе ${ids.length}, с учётом фильтров ${cases.length}; показано ${Math.min(cases.length,S.guides.shown)}.`;
      const guide=topic&&data.guides.find(g=>g.id===topic.comparison_guide),comp=guide&&guide.comparison;
      const legacyComparison=!params.has('catalog') && data.guides.some(g=>g.id===requested);
      const comparison=comp?h('details',{class:'topic-comparison',open:params.get('compare')==='1'||legacyComparison},
        h('summary',{},'Сравнение выбранных дел (все тома): '+comp.title),comparisonSection(guide)):null;
      const cards=cases.slice(0,S.guides.shown).map(c=>{
        const d=S.meta.decisions.find(x=>x.id===c.id),ev=c.topics.find(t=>t.id===selected)?.evidence;
        const origin={mode:'guides',g:requested,catalog:'1',...(year?{y:year}:{}),...(query?{q:query}:{})};
        return h('article',{class:'card catalog-case','data-id':c.id},
          h('h3',{},h('a',{href:'#/d/'+c.id+'?'+new URLSearchParams(origin)},c.title)),
          h('p',{class:'muted small'},`${c.year} г. № ${d.num} · ${c.department}`),h('p',{},c.summary),
          c.review_note?h('p',{class:'preliminary-note'},c.review_note):null,
          h('div',{class:'chips'},...c.topics.map(t=>h('a',{class:'chip',href:link(t.id)},catalog.topics.find(x=>x.id===t.id).title))),
          ev?sourceEvidence(c.id,ev,origin):null,
          h('p',{},h('a',{href:'#/d/'+c.id+'?'+new URLSearchParams(origin)},'Текст и сканы'),
            S.analyses.data.decisions[c.id]?[' · ',h('a',{href:'#/d/'+c.id+'?mode=analyses'},'Подробный разбор')]:null),
          h('details',{class:'catalog-headnote'},h('summary',{},'Заголовок издания (OCR)'),h('p',{},M(d.headnote))),sourceWarning(d));
      });
      const moreButton=cases.length>S.guides.shown?h('button',{class:'btn',id:'guides-more',onclick:()=>{S.guides.shown+=30;renderGuides(true);}},'Показать ещё'):null;
      const legacy=guide?h('details',{class:'guide-reading'},h('summary',{},'Прежняя смежная подборка: '+guide.title),
        h('p',{class:'muted small'},guide.notice),...guide.groups.map(group=>h('section',{class:'guide-group'},h('h3',{},group.title),
          h('ul',{},...group.decisions.map(id=>{const d=S.meta.decisions.find(x=>x.id===id);return h('li',{},h('a',{href:'#/d/'+id+'?mode=guides&g='+requested},`${d.vol} г. № ${d.num} — ${M(d.headnote)}`));}))))):null;
      box.replaceChildren(nav,h('article',{class:'guide','data-guide':requested},
        h('h2',{},topic?topic.title:selected==='all'?'Все решения корпуса':'Тема требует уточнения'),
        h('p',{},topic?topic.description:selected==='all'?'Все опубликованные решения, включая дела с неуточнённой темой.':'Эти дела доступны для чтения, но надёжная тема пока не выбрана.'),
        topic?h('p',{class:'chips'},h('a',{class:'chip',href:'#/search?'+new URLSearchParams({t:topic.id,...(year?{y:year}:{})})},'Поиск по словам в теме'),
          h('a',{class:'chip',href:'#/sense?'+new URLSearchParams({t:topic.id,q:query,...(year?{y:year}:{})})},'Поиск по смыслу в теме'),
          h('a',{class:'chip',href:'#/analyses?'+new URLSearchParams({t:topic.id,q:query,...(year?{y:year}:{})})},'Искать в разборах')):null,
        comparison,h('div',{class:'catalog-cases'},...cards),!cases.length?h('p',{class:'empty'},'В этом разделе по выбранным фильтрам решений не найдено.'):null,moreButton,legacy));
    } catch(err) {if(token===S.guides.token){status.textContent='';box.replaceChildren(h('p',{class:'empty'},'Не удалось загрузить каталог: '+err.message));}}
  }
  function comparisonSection(guide) {
    const comp=guide.comparison;
    const quote=ev=>sourceEvidence(ev.decision,ev,{mode:'guides',g:guide.id,compare:'1'});
    return h('section',{class:'guide-comparison','aria-label':comp.title},
      h('p',{class:'analysis-label'},comp.label),
      h('p',{},h('a',{class:'btn ghost',href:'#/research?'+new URLSearchParams({q:comp.question,terms:guide.title,ids:comp.cases.map(c=>c.id).join(',')})},'Открыть исследование, сравнить и поделиться')),
      h('p',{class:'muted small'},'Полные тексты прочитаны по контексту. Каждое сопоставление связано с цитатами разных дел. Новая сплошная сверка изображений и независимая юридическая экспертиза не проводились.'),
      h('h3',{},'Что меняет ответ Сената'),
      ...comp.comparisons.map(c=>h('section',{class:'guide-contrast'},h('h4',{},c.heading),h('p',{},c.summary),...c.evidence.map(quote))),
      h('h3',{},'Дела для сравнения'),
      h('div',{class:'comparison-cases'},...comp.cases.map(c=>h('article',{class:'comparison-case','data-decision':c.id},
        h('h4',{},`${c.year} г. № ${Number(c.id.split('-')[1])} · ${c.title}`),
        h('p',{class:'muted small'},c.department),
        ...c.sections.map(s=>h('section',{class:'comparison-case-section'},h('h5',{},s.heading),
          h('p',{class:'analysis-speaker'},s.speaker),h('p',{},s.summary),...s.evidence.map(quote))),
        h('p',{},h('a',{href:'#/d/'+c.id+'?mode=guides&g='+guide.id+'&compare=1'},'Полный текст решения'))))),
      h('aside',{class:'preliminary-note comparison-limits'},h('h3',{},'Пределы сравнения'),h('p',{},comp.limits)));
  }
  async function renderApi() {
    const box=$('#api-results'); box.replaceChildren(h('p',{class:'muted'},'Загрузка статического API…'));
    if (window.LEX_INLINE && location.protocol==='file:') {
      box.replaceChildren(h('p',{},'Офлайн-файл содержит интерфейс и корпус, но не дублирует API-файлы. ',
        h('a',{href:'https://ivseliv.github.io/senat/lex/api/',target:'_blank',rel:'noopener'},'Открыть API на публичном сайте')));
      return;
    }
    try {
      const api=await loadApi(), counts=api.coverage.counts;
      const docs=Object.entries(api.documents).map(([key,url])=>h('a',{href:url,target:'_blank',rel:'noopener'},key));
      const statistics=h('p',{class:'muted'},`${counts.decisions} ${plural(counts.decisions,'решение','решения','решений')} · ${counts.passages} ${plural(counts.passages,'пассаж','пассажа','пассажей')} · ${counts.participants} строк указателя`);
      const cards=api.datasets.map(dataset=>h('article',{class:'card'},h('h3',{},dataset.id),h('p',{},dataset.description),
        dataset.href ? h('a',{href:dataset.href,target:'_blank',rel:'noopener'},'Открыть ресурс') : h('a',{href:dataset.href_template.replace('{year}',dataset.values[0] || '').replace('{act_id}',dataset.values[0] || ''),target:'_blank',rel:'noopener'},'Открыть пример ресурса')));
      box.replaceChildren(h('p',{},'Версия контракта ',h('code',{},api.contract_version),' · снимок ',h('code',{},api.data_revision)),statistics,
        h('p',{},'Это статические JSON-файлы: ключ и сервер не нужны; фильтры представлены готовыми индексами. ',...docs.flatMap((a,i)=>i?[', ',a]:[a])),
        h('div',{class:'grid'},cards),h('p',{class:'muted small'},api.limitations[0]));
    } catch(err) { box.replaceChildren(h('p',{class:'empty'},'Не удалось загрузить API: '+err.message)); }
  }
  async function renderAnalyses(more=false) {
    const box=$('#analyses-results'),token=++S.analyses.token,p=readHash().p;
    const q=p.get('q')||'',filters={year:p.get('y')||'',topic:topicId(p.get('t')||''),kind:p.get('kind')||'',department:p.get('dept')||''};
    const key=JSON.stringify([q,filters]);if(key!==S.analyses.key){S.analyses.key=key;S.analyses.shown=24;}
    if(!more)box.replaceChildren(h('p',{class:'muted'},'Загрузка поиска по разборам…'));
    $('#analyses-more').hidden=true;
    try {
      const engine=await loadAnalysisSearch();if(token!==S.analyses.token||$('#view-analyses').hidden)return;
      fillSelect($('#analyses-year'),S.meta.volumes.map(v=>[String(v.year),String(v.year)+' · '+v.dept]),'Все тома');
      fillSelect($('#analyses-topic'),topicList().map(t=>[t.id,t.title+' ('+t.count+')']),'Все темы');
      fillSelect($('#analyses-kind'),Object.entries(engine.data.kinds),'Все виды разделов');
      fillSelect($('#analyses-department'),[...new Set(S.meta.decisions.map(d=>d.dept))].map(d=>[d,d]),'Все департаменты');
      $('#analyses-q').value=q;$('#analyses-year').value=filters.year;$('#analyses-topic').value=filters.topic;
      $('#analyses-kind').value=filters.kind;$('#analyses-department').value=filters.department;
      const submit=()=>go('analyses',{q:$('#analyses-q').value.trim(),y:$('#analyses-year').value,t:$('#analyses-topic').value,kind:$('#analyses-kind').value,dept:$('#analyses-department').value});
      $('#analyses-filter').onsubmit=e=>{e.preventDefault();submit();};
      for(const id of ['analyses-year','analyses-topic','analyses-kind','analyses-department'])$('#'+id).onchange=submit;
      const result=engine.search(q,filters),visible=result.hits.slice(0,S.analyses.shown);
      $('#analyses-status').textContent=`В поиске ${engine.data.count} разборов. Найдено ${result.decisions} ${plural(result.decisions,'решение','решения','решений')}, ${result.hits.length} ${plural(result.hits.length,'раздел','раздела','разделов')}; показано ${visible.length}.`+(result.concepts.length?' Понятия: '+result.concepts.join(', ')+'.':'');
      box.replaceChildren();
      if(result.unsupportedOperators.length){box.append(h('p',{class:'preliminary-note'},'Поиск разборов не применяет отрицания и операторы. Уберите их или ',h('a',{href:'#/search?'+new URLSearchParams({q,t:filters.topic,y:filters.year})},'откройте поиск по словам'),'.'));return;}
      if(!visible.length){box.append(h('p',{class:'empty'},'Разделов по этому запросу и фильтрам не найдено. Снимите фильтр или уточните формулировку.'));return;}
      // Загружаем только показанные документы с проверкой SHA каждого разбора.
      const ids=[...new Set(visible.map(hit=>hit.case.id))],loaded=new Map(await Promise.all(ids.map(async id=>[id,await loadAnalysis(id)])));
      if(token!==S.analyses.token)return;
      const origin={mode:'analysis',q,...(filters.year?{y:filters.year}:{}),...(filters.topic?{t:filters.topic}:{}),...(filters.kind?{kind:filters.kind}:{}),...(filters.department?{dept:filters.department}:{})};
      for(const hit of visible){
        const c=hit.case,d=S.meta.decisions.find(x=>x.id===c.id),section=loaded.get(c.id)?.sections[hit.row.section];
        if(!section||section.summary!==hit.row.summary||section.evidence.some((ev,i)=>ev.text!==hit.row.quotes[i]))throw Error('Раздел поискового каталога не соответствует проверенному разбору');
        const params={...origin,sec:String(hit.row.section)};
        box.append(h('article',{class:'card analysis-card','data-id':c.id,'data-section':hit.row.section,'data-kind':hit.row.kind},
          h('p',{class:'small muted'},`${c.year} г. № ${d.num} · ${c.department}`),
          h('h3',{},h('a',{href:'#/d/'+c.id+'?'+new URLSearchParams(params)},c.title)),
          h('p',{class:'analysis-section-kind'},engine.data.kinds[hit.row.kind]),h('h4',{},section.heading),
          h('p',{class:'analysis-speaker'},hit.row.kind==='limits'?'Редакционное пояснение о пределах вывода':section.speaker),
          h('p',{class:'analysis-label small'},'Редакционное пояснение, подготовленное с помощью ИИ'),
          h('p',{html:window.Concept.highlight(section.summary,[q])}),
          hit.matchedIn==='quote'?h('p',{class:'small muted'},'Слова запроса найдены в буквальной цитате этого раздела.'):null,
          topicChips(d,'analyses',{q}),...section.evidence.map(ev=>sourceEvidence(c.id,ev,params)),
          h('a',{href:'#/d/'+c.id+'?'+new URLSearchParams(params)},'Открыть раздел в полном разборе →')));
      }
      $('#analyses-more').hidden=result.hits.length<=S.analyses.shown;
      $('#analyses-more').onclick=()=>{S.analyses.shown+=24;renderAnalyses(true);};
    } catch(err){if(token===S.analyses.token)box.replaceChildren(h('p',{class:'empty'},'Не удалось загрузить поиск разборов: '+err.message));}
  }
  function pushSearch() {
    const f = S.f; const params = { q: f.q, y: f.year, o: f.outcome, t: f.topic, c: f.code, s: f.statute, r: f.procedure, p: f.person, u:f.participant, sort: f.sort === 'rel' ? '' : f.sort };
    if(!S.opts.ocr)params.ocr='0';
    for (const facet of FACET_FILTERS) params[facet.param] = f[facet.key];
    go('search', params);
  }
  async function renderCorpus() {
    const box = $('#corpus-table');
    try {
      const config = S.sense.config || await loadJSON('concepts.json');
      box.replaceChildren(h('table', {class:'tbl'},
        h('thead', {}, h('tr', {}, ...['Том','Решений','Пояснения ИИ','Дефекты OCR'].map(t=>h('th',{},t)))),
        h('tbody', {}, S.meta.volumes.map(v=>{
          const coverage=config.volumes.find(c=>c.year===v.year);
          return h('tr', {}, h('td',{},String(v.year)), h('td',{},String(v.decisions)),
            h('td',{},coverage ? `${coverage.enriched} из ${coverage.passages}` : 'Нет: нет проверяемой привязки к листам'),
            h('td',{},String(coverage && coverage.source_warnings || 0)));
        }))), h('p',{class:'muted small'},'Пояснения к фрагментам с дефектами источника видны с предупреждением, но не участвуют в обогащённом поисковом индексе.'));
    } catch (err) { box.textContent='Не удалось загрузить сведения о томах. Повторите открытие раздела.'; }
  }

  /* ---------------------------------------------------------------- поиск */
  function filterFn() {
    const f = S.f;
    return d => (!f.year || String(d.vol) === f.year) && (!f.outcome || d.outcome === f.outcome) && inTopic(d,f.topic) &&
      (!f.code || Object.keys(d.statutes).some(s => statuteCode(s) === f.code)) && (!f.statute || f.statute in d.statutes) &&
      (!f.procedure || (d.procedure || []).includes(f.procedure)) && (!f.person || d.presiding === f.person || d.reporter === f.person || d.prosecutor === f.person) &&
      (!f.participant || (d.participant_ids || []).some(id=>participantMatches(S.participantMap.get(id), f.participant))) &&
      FACET_FILTERS.every(facet => facetMatch(d, facet.key, f[facet.key]));
  }
  function participantLabel(entry) { return (entry.section ? entry.section + ': ' : '') + entry.label; }
  function participantMatches(entry, query) {
    if (!entry) return false;
    const normalize=s=>L.modernize(s).toLowerCase().replace(/ё/g,'е').replace(/[^а-яa-z0-9]+/g,' ').trim();
    const terms=normalize(query).split(' ').filter(Boolean), text=normalize(participantLabel(entry));
    const words=text.split(' ').map(L.stem);
    return terms.length>0 && terms.every(term=>text.includes(term) || words.includes(L.stem(term)));
  }
  function participantLink(entry) {
    return h('a',{href:'#/participants?'+new URLSearchParams({q:participantLabel(entry),y:String(entry.year)})},participantLabel(entry));
  }
  function renderParticipants() {
    const f=S.participants;
    $('#participants-q').value=f.q; $('#participants-year').value=f.year;
    const entries=(S.meta.participants || []).filter(e=>(!f.year || String(e.year)===f.year) && (!f.q || participantMatches(e,f.q)))
      .sort((a,b)=>L.modernize(participantLabel(a)).localeCompare(L.modernize(participantLabel(b)),'ru'));
    const decisions=new Set(entries.flatMap(e=>e.decisions));
    $('#participants-status').textContent=`Записей: ${entries.length} · Решений: ${decisions.size}`;
    $('#participants-results').replaceChildren(...entries.slice(0,f.shown).map(entry=>{
      const refs=entry.decisions.map(id=>h('a',{href:'#/d/'+id+'?'+new URLSearchParams({mode:'participants',q:f.q,y:f.year})},'№ '+Number(id.split('-')[1])));
      const sources=entry.sources.map(source=>{
        const ref={...source,full:source.image,index:true},label=scanLabel({vol:entry.year},ref);
        if (!source.image) return h('span',{class:'muted small',title:'Строка указателя проверяется по OCR и SHA; скан страницы пока не опубликован.'},label+' — строка OCR');
        return window.LEX_INLINE && location.protocol==='file:' ?
          h('a',{href:scanURL(source.image),target:'_blank',rel:'noopener'},label+' — скан (нужен интернет)') :
          h('button',{class:'btn ghost participant-source',onclick:()=>openScan({vol:entry.year},ref)},label+' — скан');
      });
      return h('article',{class:'card participant-entry','data-participant':entry.id},
        h('h3',{},participantLabel(entry)),h('p',{class:'chips'},...refs),h('div',{class:'chips'},...sources));
    }));
    if (!entries.length) $('#participants-results').append(h('p',{class:'muted'},'В разобранном указателе таких записей нет. Можно поискать имя в тексте решений.'));
    $('#participants-more').hidden=entries.length<=f.shown;
  }
  function facetMatch(d, key, selected) {
    if (!selected) return true;
    const values = d.groups && d.groups[key] ? d.groups[key] : [];
    return selected === '__unknown__' ? !values.length : values.includes(selected);
  }
  function groupItems(d) {
    const seen = new Set(), out = [];
    for (const facet of FACET_FILTERS) for (const label of (d.groups && d.groups[facet.key] || [])) {
      if (!seen.has(label)) { seen.add(label); out.push({key:facet.key,label}); }
    }
    return out;
  }
  function selectFacet(key, value) { S.f[key] = value; pushSearch(); }
  let runToken = 0;
  async function runSearch() {
    const my = ++runToken;
    const res = S.engine.search(S.f.q, { gloss: S.opts.gloss, ocr: S.opts.ocr, filter: filterFn() });
    let hits = res.hits;
    if (S.f.sort === 'date') hits = hits.slice().sort((a, b) => (S.meta.decisions[b.i].date || '').localeCompare(S.meta.decisions[a.i].date || '') || a.i - b.i);
    else if (!S.f.q.trim()) hits = hits.slice().sort((a, b) => a.i - b.i);
    S.hits = hits; S.query = res.query; S.shown = 20;
    renderResults(my);
  }
  function queryStems() {
    const q = S.query; if (!q) return [];
    return [...new Set([...q.clauses.flat(2), ...q.phrases.flat()])];
  }

  async function renderResults(token) {
    const box = $('#results'), st = $('#status');
    const total = S.hits.length, q = S.f.q.trim();
    st.replaceChildren(h('strong', {}, `${total} ${plural(total, 'решение', 'решения', 'решений')}`),
      S.query && S.query.expanded.length && S.opts.gloss ? h('span', { class: 'muted' }, ' · также ищем: ' + S.query.expanded.join(', ') + ' ') : '',
      S.query && S.query.expanded.length && S.opts.gloss ? h('a', { href: '#', onclick: e => { e.preventDefault(); $('#gloss').checked = false; S.opts.gloss = false; runSearch(); } }, '(искать только точно)') : '');
    box.replaceChildren();
    if (!total) { box.append(h('p', { class: 'empty' }, 'Ничего не найдено. Попробуйте другое слово, уберите фильтры или включите расширение запроса.')); $('#more').hidden = true; return; }
    const page = S.hits.slice(0, S.shown), qs = queryStems();
    for (const hit of page) {
      const d = S.meta.decisions[hit.i];
      const card = h('article', { class: 'card', tabindex: 0, 'data-id': d.id });
      card.append(
        h('div', { class: 'card-top' }, h('span', { class: 'num' }, `№ ${d.num}`), h('span', { class: 'muted' }, `${fmtDate(d.date, d.date_label)} · ${deptShort(d.dept)}, том ${d.vol}`),
          h('span', { class: 'badge' }, d.outcome)),
        h('h3', {}, h('a', { href: '#/d/' + d.id, onclick: e => { e.preventDefault(); openFromList(d.id); } }, M(d.headnote))),
        h('p', { class: 'snip', 'data-i': d.i }, ''),
        S.an.source_warnings && S.an.source_warnings[d.id] ? h('p',{class:'small source-warning'},'Есть фрагменты с дефектами OCR. Ограничения указаны в карточке решения.') : '',
        ocrNotice(hit),topicChips(d,'search',{q:S.f.q,...(S.f.year?{y:S.f.year}:{})}),
        d.procedure && d.procedure.length ? h('div', { class: 'chips' }, d.procedure.map(p => h('button', { class: 'chip group', title: 'Фильтровать по фокусу кассационного рассуждения', onclick: () => { S.f.procedure = p; pushSearch(); } }, p))) : '',
        h('div', { class: 'chips participant-chips' }, groupItems(d).slice(0, 8).map(g => h('button', { class: 'chip group', title: 'Фильтровать решения по этому признаку', onclick: () => selectFacet(g.key, g.label) }, g.label))));
      card.addEventListener('click', e => { if (!e.target.closest('button,a')) openFromList(d.id); });
      card.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === card) openFromList(d.id); });
      card.append(S.reader.saveButton(d));
      box.append(card);
    }
    $('#more').hidden = total <= S.shown;
    $('#more').textContent = `Показать ещё (осталось ${total - S.shown})`;
    // сниппеты подгружаем лениво
    for (const hit of page) {
      const d = S.meta.decisions[hit.i]; const text = await textOf(d);
      if (token !== runToken) return;
      const el = box.querySelector(`.snip[data-i="${d.i}"]`); if (!el) continue;
      const hitStems=[...new Set([...qs,...correctionTerms(hit).flatMap(L.stems)])];
      let body = text; const cut = body.indexOf('\n\n'); if (!qs.length && cut > 0) body = body;
      el.innerHTML = L.snippet(M(body), hitStems, 300,hit.corrections);
      if (q) {
        try {
          const scans=await loadScans(d.vol); if(token!==runToken)return;
          const matchStems=[...hitStems,...(hit.corrections||[]).flatMap(c=>L.stems(c.from))];
          const p=bestScanPassage(scans,d,text,matchStems);
          if(p) {el.innerHTML=L.snippet(M(p.text),hitStems,300,hit.corrections);el.after(scanStrip(d,scans.passages[p.id]));}
        } catch(err) { /* При отсутствии сканов текстовый поиск остаётся доступен. */ }
      }
    }
  }
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  function openFromList(id) { const { p } = readHash(); location.hash = '#/d/' + id + (p.toString() ? '?' + p.toString() : ''); }

  function sourceEvidence(id, ev, origin) {
    const params=new URLSearchParams({...origin,at:String(ev.start),end:String(ev.end)});
    const page=ev.printed_pages && ev.printed_pages.length ? 'с. '+ev.printed_pages.join(', ') : 'страница не определена';
    const d=S.meta.decisions.find(x=>x.id===id);
    return h('details',{class:'analysis-evidence'},
      h('summary',{},`${d.vol} г. № ${d.num} · Цитата из источника · ${page}`),
      ev.source_warning?h('p',{class:'preliminary-note source-warning'},'Ограничение источника: '+ev.source_warning):'',
      ev.editorial_note?h('p',{class:'preliminary-note editorial-note'},ev.editorial_note):'',
      h('blockquote',{class:'source-quote'},ev.text),
      h('p',{class:'small muted'},h('a',{href:'#/d/'+id+'?'+params.toString()},'Открыть цитату и скан этой страницы')));
  }
  function analysisSection(d, analysis) {
    if (!analysis) return null;
    const sections = analysis.sections.map((section,index) => {
      const p=readHash().p,origin={mode:'analysis',sec:String(index)};
      for(const key of ['q','y','t','kind','dept'])if(p.has(key))origin[key]=p.get(key);
      const evidence = section.evidence.map(ev=>sourceEvidence(d.id,ev,origin));
      return h('section',{class:'analysis-item',id:'analysis-section-'+index,tabindex:'-1'},h('h4',{},section.heading),
        h('p',{class:'analysis-speaker'},['Пределы вывода','Оговорки и пределы'].includes(section.heading)?'Редакционное пояснение о пределах вывода':section.speaker),h('p',{},section.summary),...evidence);
    });
    return h('section',{class:'decision-analysis','aria-label':'Что именно решил Сенат'},
      h('h3',{},'Что именно решил Сенат'),
      h('p',{class:'analysis-label'},'Редакционный разбор, подготовленный с помощью ИИ'),
      h('p',{class:'muted small'},'Каждый тезис связан с полной буквальной цитатой и страницами, на которых она расположена. Разбор проверен по контексту опубликованного текста; независимая юридическая экспертиза и новая сплошная сверка сканов не проводились.'),
      ...sections);
  }

  /* ---------------------------------------------------------------- карточка решения */
  async function openDetail(id) {
    S.reader.clearDetail();
    S.detailId = id;
    const d = S.meta.decisions.find(x => x.id === id); const box = $('#detail-body');
    if (!d) { box.replaceChildren(h('p', {}, 'Решение не найдено')); $('#detail').hidden = false; return; }
    $('#detail').hidden = false; document.body.classList.add('modal');
    box.replaceChildren(h('p',{class:'muted'},'Загрузка решения…'));
    let analysisUnavailable = false;
    const [text, analysis, precedents, guides, catalog, laws] = await Promise.all([textOf(d), loadAnalysis(id).catch(()=>{analysisUnavailable=true;return null;}),
      loadPrecedents().catch(()=>({references:[],unavailable:true})),
      readHash().p.get('mode')==='guides'?loadGuides():null,
      readHash().p.get('mode')==='guides'?loadTopicCatalog():null,
      readHash().p.get('mode')==='laws'&&readHash().p.has('law')?loadLaws():null]);
    if (S.detailId !== id || $('#detail').hidden) return;
    const params = readHash().p, inSense = ['sense','map','places','passage','laws','analysis','guides','quote','research'].includes(params.get('mode'));
    let target = null, senseTerms = [], partialMissing = [], quoteWarning = '', detailHit=null, verifiedGeography=false;
    if (params.get('mode') === 'quote' || params.get('mode') === 'research') {
      if (params.get('mode') === 'research' && !params.has('at')) {
        target = null;
      } else {
      target = await S.reader.resolveQuote(d,text,params);
      if (target.warning) { quoteWarning=target.warning; target=null; }
      if (S.detailId !== id || $('#detail').hidden) return;
      }
    } else if(params.get('mode')==='places') {
      if(params.has('geo')){
        try{
          const mention=await S.places.resolveEvidence(params,id);
          if(mention&&Number.isInteger(mention.start)&&Number.isInteger(mention.end)&&mention.start>=0&&mention.end>mention.start&&
              window.Concept.slice(text,mention.start,mention.end)===mention.quote&&await window.SenatResearch.hash(text)===mention.source_sha256){
            const refs=mention.scans||[];
            target={id:mention.id,start:mention.start,end:mention.end,pages:mention.printed_pages||[],scans:refs,
              sources:mention.sources||refs.map(r=>({file:r.file,page:r.page,page_method:'verified'})),ai:{source_warning:mention.source_warning}};
            senseTerms=[window.SenatPlaces.mentionName(mention)];
            verifiedGeography=true;
          }else quoteWarning='Географическая цитата не подтверждена текущей версией текста. Открыт полный текст решения; вернитесь к географии и выберите ссылку заново.';
        }catch(error){quoteWarning='Не удалось проверить географическую цитату. Полный текст решения остаётся доступен.';}
        if(S.detailId!==id||$('#detail').hidden)return;
      }
    } else if (params.get('mode') === 'laws' && params.has('law')) {
      const row = [...laws.citations, ...(laws.unresolved || []), ...(laws.historical_references || [])].find(r=>r.id===params.get('law') && r.decision_id===id);
      if (row) target = await lawDetailTarget(d, row, params);
      if (S.detailId !== id || $('#detail').hidden) return;
    } else if (params.get('mode') === 'precedent') {
      const ref=precedents.references.find(r=>r.id===params.get('ref') && r.source_id===id);
      if(ref) target={id:ref.passage_id || ref.id,start:ref.start,end:ref.end,pages:ref.pages,sources:ref.sources,precedent:true};
    } else if (params.get('mode') === 'guides' && guides) {
      const selectedTopic=catalog.route_aliases[params.get('g')]||topicId(params.get('g'));
      const topic=catalog.topics.find(t=>t.id===selectedTopic);
      const guide=guides.guides.find(g=>g.id===(topic&&topic.comparison_guide||params.get('g')));
      const comp=guide&&guide.comparison;
      const comparisonEvidence=comp?[...comp.cases.flatMap(c=>c.sections.flatMap(s=>s.evidence)),...comp.comparisons.flatMap(c=>c.evidence)]:[];
      const catalogEvidence=(catalog.decisions[id]?.topics||[]).filter(t=>t.id===selectedTopic).map(t=>t.evidence);
      const evidence=[...comparisonEvidence,...catalogEvidence]
        .find(e=>e.decision===id && String(e.start)===params.get('at') && String(e.end)===params.get('end'));
      if(evidence) target={id:evidence.passage_id,start:evidence.start,end:evidence.end,pages:evidence.printed_pages || [],sources:evidence.sources || [],scans:evidence.scans,editorial_note:evidence.editorial_note,ai:{source_warning:evidence.source_warning}};
    } else if (params.get('mode') === 'analysis' && analysis) {
      if(params.has('at')&&params.has('end')){
        const at=Number(params.get('at')), end=Number(params.get('end'));
        const evidence=analysis.sections.flatMap(s=>s.evidence).find(e=>e.start===at && e.end===end);
        if (evidence) target={id:evidence.passage_id,start:evidence.start,end:evidence.end,pages:evidence.printed_pages || [],sources:evidence.sources || [],scans:evidence.scans,ai:{source_warning:evidence.source_warning}};
      }
    } else if (inSense) {
      await loadSense();
      if (S.detailId !== id || $('#detail').hidden) return;
      target = S.sense.engines.flatMap(e => e.data.passages).find(x => x.decision === id && String(x.start) === params.get('at') && String(x.end) === params.get('end'));
      if (target) {
        const result = window.Concept.searchAll(S.sense.engines.map(e=>e.engine),params.get('q') || '',S.sense.config.method,{partial:params.get('partial')==='1',ocr:params.get('ocr')!=='0',filter:p=>inTopic(S.meta.decisions.find(d=>d.id===p.decision),params.get('t'))}).hits.find(h=>h.passage.id===target.id);
        detailHit=result;
        senseTerms = [params.get('q') || '', ...(result ? result.matched : []),...correctionTerms(result)];
        partialMissing = result && result.partial ? result.missing : [];
        if (result?.context) target={...target,context:result.context};
      }
    }
    const revision=S.an.source_revisions?.[id];
    if (revision && params.has('at') && !['quote','research'].includes(params.get('mode')) && !verifiedGeography && params.get('v')!==revision.version) {
      target=null; senseTerms=[];
      quoteWarning='Порядок колонок и границы этого решения восстановлены. Диапазон в старой ссылке не подтверждён; открыт полный текст. Найдите цитату заново через поиск или разбор решения.';
    }
    const outgoing = precedents.references.filter(r=>r.source_id===id);
    const incoming = precedents.references.filter(r=>r.status==='linked' && r.target_id===id && precedentTarget(r));
    if(!inSense)detailHit=S.hits.find(hit=>S.meta.decisions[hit.i].id===id);
    const qs = inSense ? senseTerms.flatMap(L.stems) : [...queryStems(),...correctionTerms(detailHit).flatMap(L.stems)];
    const paintPiece = t => qs.length ? L.highlightText(M(t), qs,detailHit?.corrections) : L.esc(M(t));
    const paint = (t, field='text') => {
      let offset = 0, first = true;
      return t.split('\n\n').map(par => {
        const length = Array.from(par).length;
        const applies = target && (target.field || 'text') === field;
        const a = applies ? Math.max(0, target.start-offset) : length, b = applies ? Math.min(length, target.end-offset) : 0;
        let html;
        if (a < b) {
          html = paintPiece(window.Concept.slice(par,0,a)) + '<span class="passage-focus"' + (first ? ' id="passage-target" tabindex="-1"' : '') + '>' + paintPiece(window.Concept.slice(par,a,b)) + '</span>' + paintPiece(window.Concept.slice(par,b)); first = false;
        } else html = paintPiece(par);
        const attrs=' data-reader-field="'+field+'" data-reader-start="'+offset+'" data-reader-end="'+(offset+length)+'"';
        offset += length+2; return '<p'+attrs+'>'+html+'</p>';
      }).join('');
    };
    const cite = `Решение ${d.dept === 'Общее собрание' ? 'Общего собрания' : d.dept.replace('кий', 'кого').replace('ый', 'ого')} Правительствующего Сената ${d.vol} г. № ${d.num}` + (target ? ', ' + (target.field==='headnote'?'заголовок издания':pageLabel(target)) : '');
    const body = h('div', { class: 'text', html: paint(text) });
    box.replaceChildren(
      h('div', { class: 'detail-head' },
        h('h2', {}, `№ ${d.num} · ${fmtDate(d.date, d.date_label)}`),
        h('div', { class: 'muted' }, `${d.dept}, том ${d.vol}`),
        h('span', { class: 'badge big' }, d.outcome)),
      target && target.field==='headnote' ? h('div', {class:'headnote',html:paint(d.headnote,'headnote')}) : h('p', { class: 'headnote', 'data-reader-field':'headnote', 'data-reader-start':0, 'data-reader-end':Array.from(d.headnote).length }, M(d.headnote)),
      target && target.law ? h('section',{class:'law-detail','data-law-id':target.law.id},
        target.law.historical_note ? h('p',{class:'preliminary-note law-historical-note'},target.law.historical_note) : '',
        target.law.historical_note && target.law.current_references?.length ? h('p',{class:'law-current-references'},
          'Текущая привязка: ',target.law.current_references.map((r,i)=>h('span',{},i ? '; ' : '',h('a',{href:r.passage_url},r.code+' '+r.article)))) : '',
        h('h3',{},'Законодательная ссылка · '+target.law.article),
        h('p',{class:'law-status small'},lawStatus(target.law)),
        h('blockquote',{class:'source-quote law-exact-quote'},target.quote_original),
        h('p',{class:'muted small'},target.law.citation_status),
        target.law.attribution_note ? h('p',{class:'preliminary-note editorial-note'},target.law.attribution_note) : '',
        lawEvidence(target.law)) : '',
      precedents.unavailable ? h('div',{class:'precedents-unavailable small',role:'status'},
        h('p',{},'Связи с прежними решениями пока недоступны.'),
        h('button',{class:'btn ghost',id:'precedents-retry',onclick:()=>openDetail(id)},'Повторить загрузку связей')) : '',
      partialMissing.length ? h('p',{class:'search-partial-note'},'Частичное совпадение. Не найдена часть запроса: '+partialMissing.map(w=>'«'+w+'»').join(', ')+'.') : '',
      ocrNotice(detailHit),
      h('dl', { class: 'meta' },
        d.presiding ? h('div', {}, h('dt', {}, 'Председательствовал'), h('dd', {}, personLink(d.presiding))) : '',
        d.reporter ? h('div', {}, h('dt', {}, 'Докладывал'), h('dd', {}, personLink(d.reporter))) : '',
        d.prosecutor ? h('div', {}, h('dt', {}, 'Заключение давал'), h('dd', {}, personLink(d.prosecutor))) : ''),
      topicChips(d),
      groupItems(d).length ? h('section', {}, h('h3', {}, 'Участники и социальные группы'),
        h('div', { class: 'chips participant-chips' }, groupItems(d).map(g => h('button', { class: 'chip group', onclick: () => { S.f[g.key] = g.label; pushSearch(); } }, g.label)))) : '',
      d.participant_ids && d.participant_ids.length ? h('section',{},h('h3',{},'Участники по указателю издания'),
        h('p',{class:'muted small'},'Записи печатного указателя, без определения роли в деле.'),
        h('ul',{},d.participant_ids.map(id=>h('li',{},participantLink(S.participantMap.get(id)))))) : '',
      analysisUnavailable ? h('section',{class:'analysis-unavailable preliminary-note',role:'status'},
        h('p',{},'Редакционный разбор не удалось загрузить или проверить. Ниже доступен оригинальный текст. Если ошибка повторяется, обновите страницу.'),
        h('button',{class:'btn ghost',id:'analysis-retry',onclick:()=>openDetail(id)},'Повторить загрузку разбора')) : analysisSection(d, analysis),
      Object.keys(d.statutes).length ? h('section', {}, h('h3', {}, 'Упомянутые статьи'), h('div', { class: 'chips' },
        Object.keys(d.statutes).sort().map(s => h('button', { class: 'chip stat', title: 'Найти все решения с этой статьёй', onclick: () => go('search', { s }) }, statLabel(s))))) : '',
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Орфография текста' },
          h('button', { class: 'seg-b', 'aria-pressed': String(!S.opts.modern), onclick: () => setModern(false) }, 'Дореформенная'),
          h('button', { class: 'seg-b', 'aria-pressed': String(S.opts.modern), onclick: () => setModern(true) }, 'Современная')),
        h('button', { class: 'btn', onclick: e => { const btn = e.target; const txt = cite + '\n' + location.href; const done = ok => { btn.textContent = ok ? 'Скопировано ✓' : 'Не удалось скопировать — выделите текст вручную'; setTimeout(() => btn.textContent = 'Скопировать ссылку и цитату', 2000); }; try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (err) { done(false); } } }, 'Скопировать ссылку и цитату')),
      target && target.ai && target.ai.source_warning ? h('p',{class:'preliminary-note source-warning'},'Ограничение источника: '+target.ai.source_warning) : sourceWarning(d),
      target && target.editorial_note ? h('p',{class:'preliminary-note editorial-note'},target.editorial_note) : '',
      quoteWarning ? h('p',{class:'preliminary-note reader-source-warning',role:'status'},quoteWarning) : '',
      target?.context ? contextEvidence(d,text,target.context,senseTerms,detailHit?.corrections) : '',
      body,
      h('p', { class: 'muted small' }, 'Текст получен автоматическим распознаванием скана и может содержать ошибки: числа, номера статей и фамилии сверяйте с изданием. Современная орфография — автоматическая, для удобства чтения.'),
      outgoing.length ? h('section', {class:'precedents-out'}, h('h3', {}, 'Ссылки на прежние решения'),
        h('p',{class:'muted small'},'Переход установлен только при совпадении департамента, года и номера. Цитата показывает упоминание, а не обязательное согласие Сената с ним.'),
        h('ul',{},precedentGroups(outgoing).map(refs=>precedentEntry(refs,false)))) : '',
      incoming.length ? h('section', {class:'precedents-in'}, h('h3', {}, 'Упоминается в других решениях'),
        h('p',{class:'muted small'},'Наличие ссылки не означает согласия Сената с процитированным доводом. Сверяйте контекст.'),
        h('ul',{},precedentGroups(incoming,true).map(refs=>precedentEntry(refs,true)))) : '',
      d.similar.length ? h('section', {}, h('h3', {}, 'Похожие решения'), h('ul', {}, d.similar.map(([j, sc]) => { const x = S.meta.decisions[j]; return h('li', {}, h('a', { href: '#/d/' + x.id }, `${x.vol} г. № ${x.num} — ${M(x.headnote).slice(0, 100)}…`), h('span', { class: 'muted' }, ` (сходство ${Math.round(sc * 100)}%)`)); }))) : '');
    const scanSection=h('details',{class:'detail-scans'},h('summary',{},target?(target.field==='headnote'?'Сканы заголовка издания':'Сканы найденного фрагмента'):'Страницы решения в издании'));
    scanSection.addEventListener('toggle',async()=>{
      if(!scanSection.open || scanSection.dataset.loaded)return;
      try {
        const scans=await loadScans(d.vol);
        let refs=target?(target.scans || scans.passages[target.id]):(scans.decisions[d.id]||[]).map(file=>({...scans.pages[file],kind:'page'}));
        if(target && target.precedent && refs) refs=refs.filter(r=>target.sources.some(s=>s.file===r.file));
        if(target && (!refs || !refs.length)) refs=(target.sources || []).map(s=>scans.pages[s.file]).filter(Boolean).map(p=>({...p,kind:'page'}));
        if(refs && refs.length) {scanSection.append(scanStrip(d,refs));scanSection.dataset.loaded='1';}
        else scanSection.append(h('p',{class:'small'},'Сканы этого места пока недоступны.'));
      } catch(err) {scanSection.append(h('p',{class:'small'},'Не удалось загрузить список страниц. Закройте и откройте этот раздел для повторной попытки.'));}
    });
    body.before(scanSection);
    S.reader.attachDetail({d,text,body,headnote:box.querySelector('.headnote'),target});
    $('#detail').scrollTop = 0;
    if (target) {
      const anchor = $('#passage-target');
      if (anchor) { anchor.scrollIntoView({block:'start'}); anchor.focus({preventScroll:true}); }
    } else if(params.get('mode')==='analysis'&&/^\d+$/.test(params.get('sec')||'')) {
      const anchor=$('#analysis-section-'+params.get('sec'));
      if(anchor){anchor.scrollIntoView({block:'start'});anchor.focus({preventScroll:true});}
    }
  }
  function setModern(v) {
    S.opts.modern = v;
    try { localStorage.setItem('lex.modern', v ? '1' : '0'); } catch (e) { /* хранилище недоступно */ }
    for (const r of document.querySelectorAll('input[name=orth], input[name=sense-orth]')) r.checked = (r.value === 'new') === v;
    if (!$('#view-search').hidden) { runToken++; renderResults(runToken); }
    if (!$('#view-sense').hidden) runSense();
    if (!$('#detail').hidden && S.detailId) { const top = $('#detail').scrollTop; openDetail(S.detailId).then(() => { $('#detail').scrollTop = top; }); }
  }
  function personLink(name) { return h('a', { href: '#/search?p=' + encodeURIComponent(name) }, name); }
  function closeDetail() { S.reader.clearDetail(); $('#detail').hidden = true; document.body.classList.remove('modal'); }

  /* ---------------------------------------------------------------- элементы управления */
  function fillSelect(sel, items, first) {
    sel.replaceChildren(h('option', { value: '' }, first), ...items.map(([v, t]) => h('option', { value: v }, t)));
  }
  function syncControls() {
    $('#q').value = S.f.q; $('#f-year').value = S.f.year; $('#f-outcome').value = S.f.outcome; $('#f-topic').value = S.f.topic;
    $('#f-code').value = S.f.code; $('#f-statute').value = S.f.statute; $('#f-procedure').value = S.f.procedure; $('#f-person').value = S.f.person; $('#f-participant').value=S.f.participant; $('#f-sort').value = S.f.sort;
    for (const facet of FACET_FILTERS) $('#' + facet.id).value = S.f[facet.key];
    const act = ['year', 'outcome', 'topic', 'code', 'statute', 'procedure', 'person', 'participant', ...FACET_FILTERS.map(f=>f.key)].filter(k => S.f[k]).length + (S.f.sort !== 'rel' ? 1 : 0);
    $('#fcount').textContent = act ? `· выбрано: ${act}` : '';
    const box = $('#fbox'); if (!box.dataset.init || act) { box.open = act > 0 || innerWidth >= 700; box.dataset.init = '1'; }
  }
  function setupControls() {
    const dec = S.meta.decisions, an = S.an;
    $('#participant-options').replaceChildren(...[...new Set((S.meta.participants || []).map(e=>L.modernize(participantLabel(e))))].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>h('option',{value})));
    fillSelect($('#participants-year'), [...new Set((S.meta.participants || []).map(e=>e.year))].map(y=>[String(y),String(y)]), 'Все разобранные указатели');
    $('#participants-form').addEventListener('submit',e=>{e.preventDefault();go('participants',{q:$('#participants-q').value,y:$('#participants-year').value});});
    $('#participants-more').addEventListener('click',()=>{S.participants.shown+=60;renderParticipants();});
    fillSelect($('#f-year'), S.meta.volumes.map(v => [String(v.year), String(v.year)]), 'Все годы');
    fillSelect($('#f-outcome'), Object.entries(an.outcomes).map(([k, n]) => [k, `${k} (${n})`]), 'Любой исход');
    fillSelect($('#f-topic'), topicList().map(t=>[t.id,`${t.title} (${t.count})`]), 'Любая тема');
    fillSelect($('#f-code'), Object.entries(an.statute_codes).map(([c, n]) => [c, `${codeLabel(c)} (${n})`]), 'Любой кодекс / акт');
    const stat = {}; dec.forEach(d => Object.keys(d.statutes).forEach(s => stat[s] = (stat[s] || 0) + 1));
    fillSelect($('#f-statute'), Object.entries(stat).filter(([s]) => !s.startsWith('?')).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 250).map(([s, n]) => [s, `${statLabel(s)} (${n})`]), 'Любая статья');
    fillSelect($('#f-procedure'), Object.entries(an.procedures).map(([p, n]) => [p, `${p} (${n})`]), 'Любой фокус рассуждения');
    const per = {}; dec.forEach(d => [d.presiding, d.reporter, d.prosecutor].forEach(p => p && (per[p] = (per[p] || 0) + 1)));
    fillSelect($('#f-person'), Object.entries(per).sort((a, b) => a[0].localeCompare(b[0])).map(([p, n]) => [p, `${p} (${n})`]), 'Любой сенатор / прокурор');
    for (const facet of FACET_FILTERS) {
      const data = an.participant_facets[facet.key];
      const items = Object.entries(data.values).map(([v,n]) => [v, `${v} (${n})`]);
      if (data.unknown) items.push(['__unknown__', `Не указано в заголовке (${data.unknown})`]);
      fillSelect($('#' + facet.id), items, facet.any);
    }
    $('#form').addEventListener('submit', e => { e.preventDefault(); S.f.q = $('#q').value; S.f.participant=$('#f-participant').value; pushSearchOrRun(); });
    for (const [id, key] of [['f-year', 'year'], ['f-outcome', 'outcome'], ['f-topic', 'topic'], ['f-code', 'code'], ['f-statute', 'statute'], ['f-procedure', 'procedure'], ['f-person', 'person'], ['f-participant','participant'], ['f-sort', 'sort']])
      $('#' + id).addEventListener('change', e => { S.f[key] = e.target.value; S.f.q = $('#q').value; pushSearchOrRun(); });
    for (const facet of FACET_FILTERS) $('#' + facet.id).addEventListener('change', e => {
      S.f[facet.key] = e.target.value; S.f.q = $('#q').value; pushSearchOrRun();
    });
    try { S.opts.modern = localStorage.getItem('lex.modern') === '1'; } catch (e) { /* по умолчанию оригинал */ }
    for (const r of document.querySelectorAll('input[name=orth], input[name=sense-orth]')) { r.checked = (r.value === 'new') === S.opts.modern; r.addEventListener('change', e => setModern(e.target.value === 'new')); }
    $('#gloss').addEventListener('change', e => { S.opts.gloss = e.target.checked; runSearch(); });
    $('#search-ocr').addEventListener('change',e=>{S.opts.ocr=e.target.checked;pushSearch();});
    $('#more').addEventListener('click', () => { S.shown += 20; renderResults(++runToken); });
    $('#reset').addEventListener('click', () => go('search'));
    $('#detail-close').addEventListener('click', () => {
      const { p } = readHash(); const requested = p.get('mode');
      if (requested==='research') {location.hash='#/research'+(p.get('back')?'?'+new URLSearchParams({share:p.get('back')}):'');return;}
      const mode = requested === 'quote' ? 'reader' : requested === 'passage' ? 'sense' : (requested === 'analysis' ? 'analyses' : (['sense','participants','map','places','laws','guides','analyses','api','reader'].includes(requested) ? requested : 'search')); p.delete('at'); p.delete('end'); p.delete('mode'); p.delete('ref'); p.delete('law'); p.delete('field'); p.delete('sha'); p.delete('sec'); p.delete('geo'); location.hash = '#/' + mode + (p.toString() ? '?' + p.toString() : '');
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('.scan-dialog[open]') && !$('#detail').hidden) $('#detail-close').click(); });
    $('#examples').append(...['недействительность сделки', 'возмещение убытков', 'исковая давность', 'договор аренды', 'банкротство', 'страховое возмещение', 'перевозка грузов', 'исполнитель завещания']
      .map(x => h('button', { class: 'chip', onclick: () => go('search', { q: x }) }, x)));
    fillSelect($('#sense-topic'),topicList().map(t=>[t.id,`${t.title} (${t.count})`]),'Все темы');
    fillSelect($('#sense-year'),S.meta.volumes.map(v=>[String(v.year),String(v.year)+' · '+v.dept]),'Все тома');
    const submitSense=()=>go('sense',{q:$('#sense-q').value.trim(),t:$('#sense-topic').value,y:$('#sense-year').value,...(!$('#sense-ocr').checked?{ocr:'0'}:{})});
    $('#sense-form').addEventListener('submit',e=>{e.preventDefault();submitSense();});
    for(const id of ['sense-topic','sense-year','sense-ocr'])$('#'+id).addEventListener('change',submitSense);
    $('#sense-examples').append(...['фиктивные сделки', 'неосновательное обогащение', 'добросовестный приобретатель', 'бремя доказывания', 'уступка права требования', 'срок принятия наследства', 'возмещение вреда здоровью', 'производственная травма'].map(q => h('button', {class:'chip', onclick:()=>go('sense',{q,t:S.sense.topic,y:S.sense.year})}, q)));
    for (const id of ['search-concepts', 'sense-concepts']) {
      const box = $('#' + id);
      box.querySelector('.concept-catalog').append(...MODERN_CONCEPTS.map(([title, queries]) => h('section', {},
        h('h3', {}, title), h('div', {class:'chips'}, queries.map(q => h('button', {class:'chip', onclick:()=>{
          box.open = false; go('sense', {q,t:id==='sense-concepts'?S.sense.topic:S.f.topic,y:id==='sense-concepts'?S.sense.year:S.f.year});
        }}, q))))));
    }
    $('#sense-more').addEventListener('click', () => { S.sense.shown += 10; renderSense(++S.sense.token); });
    fillSelect($('#map-topic'), topicList().map(t=>[t.id,`${t.title} (${t.count})`]), 'Все темы');
    $('#map-form').addEventListener('submit', e => { e.preventDefault(); go('map', {q:$('#map-q').value.trim(),t:$('#map-topic').value}); });
    $('#map-reset').addEventListener('click', () => go('map'));
    $('#map-concepts .concept-catalog').append(...MODERN_CONCEPTS.map(([title, queries]) => h('section', {},
      h('h3', {}, title), h('div', {class:'chips'}, queries.map(q => h('button', {class:'chip', onclick:()=>go('map',{q,t:S.map.topic})}, q))))));
    $('#laws-form').addEventListener('submit', e => { e.preventDefault(); go('laws', {q:$('#laws-q').value.trim(),c:$('#laws-code').value}); });
    $('#laws-reset').addEventListener('click', () => go('laws'));
    $('#laws-code').addEventListener('change', () => go('laws', {q:$('#laws-q').value.trim(),c:$('#laws-code').value}));
    $('#theme').addEventListener('click', () => { const r = document.documentElement; const dark = r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); r.dataset.theme = dark ? 'light' : 'dark'; });
  }
  function pushSearchOrRun() { const { path } = readHash(); if (path.startsWith('d/')) { closeDetail(); } pushSearch(); if (!location.hash.startsWith('#/search')) return; runSearch(); }


  /* ---------------------------------------------------------------- понятийный поиск */
  async function loadSense() {
    if (!S.sense.promise) S.sense.promise = (async () => {
      const config = await loadJSON('concepts.json');
      const data = await Promise.all(config.volumes.map(v=>loadJSON(v.file)));
      const shared = window.Concept.makeEngines(data, config.glossary);
      const engines = data.map((volume,i)=>({data:volume, engine:shared[i]}));
      S.sense.config = config; S.sense.engines = engines;
    })().catch(err => { S.sense.promise = null; throw err; });
    return S.sense.promise;
  }
  async function runSense() {
    const token = ++S.sense.token;
    $('#sense-more').hidden = true;
    if (!S.sense.q.trim()) {
      if(S.sense.topic||S.sense.year){
        const docs=S.meta.decisions.filter(d=>inTopic(d,S.sense.topic)&&(!S.sense.year||String(d.vol)===S.sense.year));
        $('#sense-status').textContent=`${docs.length} ${plural(docs.length,'решение','решения','решений')} в выбранной области. Введите понятие, чтобы искать фрагменты этих решений.`;
        $('#sense-results').replaceChildren(...docs.map(d=>h('article',{class:'card','data-id':d.id},
          h('h3',{},h('a',{href:'#/d/'+d.id+'?'+new URLSearchParams({mode:'sense',t:S.sense.topic,y:S.sense.year})},`${d.vol} г. № ${d.num}`)),
          h('p',{},M(d.headnote)),topicChips(d,'sense',{y:S.sense.year}))));
      }else{$('#sense-status').textContent = 'Введите современное понятие или выберите пример.';$('#sense-results').replaceChildren();}
      return;
    }
    $('#sense-status').textContent = 'Ищем фрагменты…';
    $('#sense-results').replaceChildren();
    try {
      await loadSense(); if (token !== S.sense.token) return;
      const filter=p=>{const d=S.meta.decisions.find(x=>x.id===p.decision);return inTopic(d,S.sense.topic)&&(!S.sense.year||String(d.vol)===S.sense.year);};
      const result = window.Concept.searchAll(S.sense.engines.map(e=>e.engine),S.sense.q,S.sense.config.method,{partial:true,ocr:S.opts.ocr,filter});
      const scoped=result.hits;
      const optedIn = readHash().p.get('partial') === '1';
      S.sense.partial = result.partial && optedIn;
      S.sense.suggested = result.partial && !optedIn ? scoped.length : 0;
      S.sense.hits = result.partial && !optedIn ? [] : scoped;
      S.sense.concepts = result.concepts;
      S.sense.unsupported=result.query?.unsupportedOperators||[];
      S.sense.shown = 10;
      await renderSense(token);
    } catch (err) {
      if (token === S.sense.token) $('#sense-status').textContent = 'Не удалось загрузить поиск по смыслу: ' + err.message + '. Повторите запрос.';
    }
  }
  function pageLabel(p) {
    const recovered = p.sources.some(s=>s.page_method==='neighbors');
    const partial = p.pages.length && p.sources.some(s=>s.page===null);
    return (p.pages.length ? 'с. ' + p.pages.join(', ') : 'страница не определена') + (recovered ? ' (номер восстановлен по соседним колонтитулам)' : '') + (partial ? ' (часть страниц не определена)' : '');
  }
  function contextEvidence(d,text,passages,terms,corrections=[]) {
    return h('details',{class:'search-context'},
      h('summary',{},'Часть совпадений найдена в соседнем фрагменте этого решения'),
      h('p',{class:'small muted'},'Совпадение относится к небольшому контексту; отдельный фрагмент может содержать лишь часть слов запроса.'),
      ...passages.map(p=>h('section',{},
        h('blockquote',{class:'source-quote',html:window.Concept.highlight(M(window.Concept.slice(text,p.start,p.end)),terms,corrections)}),
        h('a',{href:'#/d/'+d.id+'?'+new URLSearchParams({mode:'passage',at:p.start,end:p.end})},'Открыть соседний фрагмент · '+pageLabel(p)))));
  }
  async function renderSense(token) {
    const box = $('#sense-results'); box.replaceChildren();
    const hits = S.sense.hits;
    $('#sense-status').replaceChildren(h('strong', {}, `${hits.length} ${plural(hits.length,'фрагмент','фрагмента','фрагментов')}`),
      h('span', {class:'muted'}, S.sense.concepts && S.sense.concepts.length ? ' · понятия: '+S.sense.concepts.map(c=>c.concept).join(', ') : ''),
      S.sense.partial ? h('span',{class:'search-partial-note'},' · частичные совпадения') : '');
    if(S.sense.topic)$('#sense-status').append(h('span',{class:'muted'},' · тема: '+topicTitle(S.sense.topic)));
    if(S.sense.unsupported?.length)$('#sense-status').append(h('p',{class:'preliminary-note'},'Поиск по смыслу не применяет отрицания и операторы. ',h('a',{href:'#/search?'+new URLSearchParams({q:S.sense.q,t:S.sense.topic,y:S.sense.year})},'Используйте поиск по словам.')));
    if(hits.length)$('#sense-status').append(h('p',{},h('a',{class:'btn ghost',href:'#/research?'+new URLSearchParams({q:S.sense.q,terms:S.sense.q})},'Собрать справку и сравнить дела')));
    if (!hits.length) {
      box.append(h('p', {class:'empty'}, 'Подходящие фрагменты в доступных томах не найдены. Это не доказывает отсутствия такой практики: попробуйте другое понятие или обычный поиск.'));
      if (S.sense.suggested) box.append(h('p',{class:'small'},'Есть фрагменты, в которых совпадает всё, кроме одной части запроса.'),
        h('button',{class:'btn ghost',id:'sense-partial',onclick:()=>go('sense',{q:S.sense.q,t:S.sense.topic,y:S.sense.year,partial:'1',...(!S.opts.ocr?{ocr:'0'}:{})})},'Показать частичные совпадения ('+S.sense.suggested+')'));
      return;
    }
    if (S.sense.partial) box.append(h('p',{class:'search-partial-note'},'Совпадений по всему запросу нет. Ниже — фрагменты, где не совпала одна часть запроса; она указана в каждой карточке.'),
      h('button',{class:'btn ghost',id:'sense-strict',onclick:()=>go('sense',{q:S.sense.q,t:S.sense.topic,y:S.sense.year,...(!S.opts.ocr?{ocr:'0'}:{})})},'Вернуться к полному запросу'));
    for (const hit of hits.slice(0,S.sense.shown)) {
      const p=hit.passage, d=S.meta.decisions.find(x=>x.id===p.decision);
      const text=await textOf(d); if(token!==S.sense.token) return;
      const original=window.Concept.slice(text,p.start,p.end);
      const terms=[S.sense.q,...hit.matched,...correctionTerms(hit)];
      const link='#/d/'+d.id+'?'+new URLSearchParams({mode:'sense',q:S.sense.q,t:S.sense.topic,y:S.sense.year,at:String(p.start),end:String(p.end),...(!S.opts.ocr?{ocr:'0'}:{}),...(hit.partial ? {partial:'1'} : {})});
      box.append(h('article', {class:'card passage', 'data-passage':p.id},
        ocrNotice(hit),
        hit.context ? h('p',{class:'small search-context-label'},'Совпадение с учётом соседнего контекста') : '',
        hit.partial ? h('p',{class:'search-partial-note'},'Частичное совпадение. Не найдена часть запроса: '+hit.missing.map(w=>'«'+w+'»').join(', ')+'.') : '',
        p.ai && p.ai.source_warning ? h('p',{class:'preliminary-note source-warning'},'Ограничение источника: '+p.ai.source_warning) : '',
        h('div', {class:'passage-text',html:(p.start ? '… ' : '') + window.Concept.highlightEvidence(M(original),terms,p.ai ? M(p.ai.evidence) : '',hit.corrections) + (p.end < Array.from(text).length ? ' …' : '')}),
        p.ai ? h('div', {class:'ai-note'}, h('strong', {}, 'Пояснение ИИ: '), p.ai.summary,
          h('details', {}, h('summary', {}, 'Цитата, на которой основано пояснение'), h('p', {}, '«… ' + M(p.ai.evidence) + ' …»'))) : '',
        hit.context ? contextEvidence(d,text,hit.context,terms,hit.corrections) : '',
        h('div', {class:'card-top'}, h('span', {class:'num'}, `№ ${d.num}`), h('span', {class:'muted'}, `${fmtDate(d.date, d.date_label)} · том ${d.vol} · ${pageLabel(p)}`), h('span', {class:'badge'}, d.outcome)),
        topicChips(d,'sense',{q:S.sense.q,y:S.sense.year}),h('p', {class:'small'}, h('a', {href:link}, 'Открыть в карточке на этом месте'))));
      try {
        const scans=await loadScans(d.vol);if(token!==S.sense.token)return;
        const refs=scans.passages[p.id];if(refs)box.lastElementChild.append(scanStrip(d,refs));
      } catch(err) { /* Скан не является условием доступа к первоисточнику. */ }
    }
    $('#sense-more').hidden=hits.length<=S.sense.shown;
  }

  /* ---------------------------------------------------------------- юридическая карта */
  function mapNode(title, note, content, key) {
    return h('section', {class:'map-node', 'data-map-node':key}, h('h3',{},title),
      note ? h('p',{class:'muted small'},note) : '', content);
  }
  function mapDecisionHref(d, hit) {
    const params={mode:'map',q:S.map.q,t:S.map.topic};
    if (hit) { params.at=String(hit.passage.start); params.end=String(hit.passage.end); }
    return '#/d/'+d.id+'?'+new URLSearchParams(params);
  }
  function mapDecisionList(items) {
    return h('ol',{class:'map-list'},items.map(({d,hit})=>h('li',{},
      h('a',{href:mapDecisionHref(d,hit)},`№ ${d.num}, ${d.vol} г.`), ' · ', M(d.headnote.slice(0,150))+(d.headnote.length>150?'…':''),
      topicChips(d,'map',{q:S.map.q}))));
  }
  async function renderMap() {
    const token=++S.map.token, q=S.map.q.trim(), topic=S.map.topic;
    const status=$('#map-status'), box=$('#map-results'); box.replaceChildren();
    if (!q && !topic) {
      status.textContent='Выберите тему или введите современное понятие.';
      box.append(mapNode('Темы корпуса','Редакционные темы подготовлены с помощью ИИ и подтверждены цитатами. Во всех разделах используется один каталог.',
        h('div',{class:'chips'},...topicList().slice().sort((a,b)=>b.count-a.count).map(t=>h('button',{class:'chip',onclick:()=>go('map',{t:t.id})},`${t.title} (${t.count})`))),'themes'));
      return;
    }
    status.textContent='Собираем связи по первоисточникам…';
    let matched=[], concepts=[];
    if (q) {
      try {
        await loadSense(); if(token!==S.map.token)return;
        const result=window.Concept.searchAll(S.sense.engines.map(e=>e.engine),q,S.sense.config.method,{ocr:S.opts.ocr,filter:p=>inTopic(S.meta.decisions.find(d=>d.id===p.decision),topic)});
        concepts=result.concepts;
        matched=result.hits;
        if(topic) matched=matched.filter(hit=>inTopic(S.meta.decisions.find(d=>d.id===hit.passage.decision),topic));
        if(result.query?.unsupportedOperators?.length)box.append(h('p',{class:'preliminary-note'},'Поиск карты не применяет отрицания и операторы. ',h('a',{href:'#/search?'+new URLSearchParams({q,t:topic})},'Используйте поиск по словам.')));
        // У карты есть граница релевантности: связи выводятся из верхних фрагментов,
        // а не из каждого случайного совпадения в полном тексте.
        matched=matched.slice(0,50);
      } catch(err) {
        if(token===S.map.token)status.textContent='Не удалось загрузить поиск по смыслу: '+err.message+'. Повторите запрос.';
        return;
      }
    }
    const byDecision=new Map();
    for(const hit of matched) {
      const d=S.meta.decisions.find(x=>x.id===hit.passage.decision);
      if(!byDecision.has(d.id) || byDecision.get(d.id).hit.score<hit.score) byDecision.set(d.id,{d,hit});
    }
    let decisions=q ? [...byDecision.values()].sort((a,b)=>b.hit.score-a.hit.score || a.d.i-b.d.i) :
      S.meta.decisions.filter(d=>inTopic(d,topic)).map(d=>({d,hit:null}));
    const statutes={}, participants=new Map(), topicCounts={};
    for(const {d} of decisions) {
      Object.entries(d.statutes).forEach(([s,n])=>statutes[s]=(statutes[s]||0)+n);
      (d.participant_ids||[]).forEach(id=>{const entry=S.participantMap.get(id);if(entry)participants.set(id,entry);});
      topicIds(d).forEach(t=>topicCounts[t]=(topicCounts[t]||0)+1);
    }
    const sources=matched.slice(0,8), topDecisions=q?decisions.slice(0,25):decisions;
    const hasSources=Boolean(q);
    status.replaceChildren(h('strong',{},`${decisions.length} ${plural(decisions.length,'решение','решения','решений')}`),
      h('span',{class:'muted'},hasSources ? ` · связи по ${matched.length} ${plural(matched.length,'фрагменту','фрагментам','фрагментам')} в ранжированной выдаче` : ` · тема: ${topicTitle(topic)}`),
      concepts.length ? h('span',{class:'muted'},' · справочник: '+concepts.map(c=>c.concept).join(', ')) : '');
    if(!decisions.length) {
      box.append(h('p',{class:'empty'},'Связей не найдено. Это не доказывает отсутствия практики: смените понятие или снимите тематический фильтр.'));
      return;
    }
    const grid=h('div',{class:'map-grid'});
    if(hasSources) {
      const sourceItems=[];
      for(const hit of sources) {
        const p=hit.passage,d=S.meta.decisions.find(x=>x.id===p.decision),text=await textOf(d); if(token!==S.map.token)return;
        const original=window.Concept.slice(text,p.start,p.end), link=mapDecisionHref(d,hit);
        sourceItems.push(h('li',{},h('a',{href:link},`№ ${d.num}, ${d.vol} г. · ${pageLabel(p)}`),
          ocrNotice(hit),
          hit.context ? h('p',{class:'small search-context-label'},'Совпадение с учётом соседнего контекста') : '',
          h('div',{class:'small',html:'«… '+window.Concept.highlightEvidence(M(original),[q,...hit.matched,...correctionTerms(hit)],p.ai ? M(p.ai.evidence) : '',hit.corrections)+' …»'})));
      }
      grid.append(mapNode('Фрагменты первоисточника','Каждая связь начинается с ранжированного фрагмента; ссылка открывает точное место и его скан.',h('ol',{class:'map-list map-sources'},sourceItems),'sources'));
    }
    grid.append(mapNode('Решения',q?'Показаны до 25 решений по найденным фрагментам. Темы и прямые ссылки сохранены.':'Все решения выбранной редакционной темы. Состав совпадает с каталогом и поиском.',mapDecisionList(topDecisions),'decisions'));
    const statRows=Object.entries(statutes).filter(([s])=>!s.startsWith('?')).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,20);
    grid.append(mapNode('Упомянутые нормы','Это извлечённые ссылки из найденных решений. Номер акта нужно сверять с изданием.', statRows.length ?
      h('div',{class:'chips'},...statRows.map(([s,n])=>h('a',{class:'chip stat',href:'#/search?'+new URLSearchParams({s})},`${statLabel(s)} (${n})`))) : h('p',{class:'muted'},'Определённых ссылок на статьи нет.'),'statutes'));
    const entries=[...participants.values()].sort((a,b)=>participantLabel(a).localeCompare(participantLabel(b),'ru')).slice(0,30);
    grid.append(mapNode('Участники','Записи печатных указателей, связанные с найденными решениями. Они не устанавливают процессуальную роль или биографию.',entries.length ?
      h('ul',{class:'map-list'},entries.map(entry=>h('li',{},participantLink(entry)))) : h('p',{class:'muted'},'В печатных указателях для этих решений записей нет.'),'participants'));
    const relatedTopics=Object.entries(topicCounts).sort((a,b)=>b[1]-a[1]);
    grid.append(mapNode('Темы в выборке','Темы единого редакционного каталога — вход в другую ветвь карты.',h('div',{class:'chips'},...relatedTopics.map(([t,n])=>h('button',{class:'chip',onclick:()=>go('map',{q:S.map.q,t})},`${topicTitle(t)} (${n})`))),'related-topics'));
    box.append(grid);
  }

  /* ---------------------------------------------------------------- законодательство */
  async function loadLaws() {
    if (!S.laws.promise) S.laws.promise = loadJSON('laws.json').then(data => {
      S.laws.data = data;
      const select = $('#laws-code');
      if (select.options.length <= 1) fillSelect(select,
        [...data.acts.map(act => [act.code, `${act.code} · ${act.short_title}`]), ['?', 'Акт не установлен']], 'Все акты и неопределённые ссылки');
      return data;
    }).catch(err => { S.laws.promise = null; throw err; });
    return S.laws.promise;
  }
  function lawText(value) {
    return L.modernize(String(value || '')).toLowerCase().replace(/ё/g, 'е').replace(/[^а-я0-9]+/g, ' ').trim();
  }
  function lawTerms(query) {
    return lawText(query).split(' ').filter(term=>term && !['ст','статья','статьи'].includes(term));
  }
  function lawActText(act) { return lawText(act ? [act.code, act.title, act.short_title, ...(act.aliases || [])].join(' ') : 'Акт не установлен неопределённая ссылка'); }
  function lawCitationMatches(row, act, terms) {
    const hay = lawActText(act) + ' ' + lawText([row.article, row.year, row.decision_number, row.decision_id, row.context_original].join(' '));
    return terms.every(term => hay.includes(term));
  }
  function lawStatus(row) {
    if (row.historical_note) return 'Ссылка предыдущей версии: акт мог быть уточнён';
    return row.verification_status==='context_verified' ? 'Акт подтверждён по контексту' :
      row.verification_status==='act_unknown' ? 'Акт не установлен' : 'Прежняя привязка: акт отдельно не проверен';
  }
  function lawRangeURL(row, span) {
    const params = new URLSearchParams((row.passage_url || '').split('?')[1] || '');
    params.set('mode','laws'); params.set('law',row.id); params.set('c',row.code); params.set('q',row.article);
    params.set('at',String(span.start)); params.set('end',String(span.end));
    if (span.field && span.field !== row.field) params.set('field',span.field);
    return '#/d/'+row.decision_id+'?'+params;
  }
  function lawProofs(row) {
    const proofs = [ ...(row.evidence || []), ...(row.occurrences || []).flatMap(o=>o.evidence || []) ];
    return [...new Map(proofs.map(proof=>[JSON.stringify([proof.kind,proof.path,proof.field,proof.start,proof.end]),proof])).values()];
  }
  function lawProof(row, proof) {
    const printed = proof.kind==='printed_index';
    return h('section',{class:'law-proof','data-kind':proof.kind},
      h('p',{class:'small'},printed ? 'Печатный указатель законов' : proof.role==='act_identity' ? 'Уточнение акта и территории по контексту' : proof.kind==='repeat' ? 'Повторная ссылка на тот же акт' : 'Прямое название акта в источнике',
        !printed && proof.field==='headnote' ? ' · заголовок издания (OCR)' : ''),
      printed && proof.heading ? h('div',{},h('p',{class:'small muted'},'Рубрика указателя (буквально):'),
        h('blockquote',{class:'source-quote law-index-heading'},proof.heading.quote_original)) : '',
      printed && proof.edition_continuation ? h('div',{},h('p',{class:'small muted'},'Продолжение рубрики / указание издания (буквально):'),
        h('blockquote',{class:'source-quote law-index-edition'},typeof proof.edition_continuation==='string'?proof.edition_continuation:(proof.edition_continuation.quote_original || proof.edition_continuation.quote || proof.edition_continuation.line))) : '',
      h('blockquote',{class:'source-quote law-proof-quote'},proof.quote_original),
      h('p',{class:'small'},printed ? h('a',{class:'law-index-source',href:(window.LEX_INLINE?'https://ivseliv.github.io/senat/lex/':'')+proof.path,target:'_blank',rel:'noopener'},'Открыть полный OCR печатного указателя') :
        h('a',{class:'law-proof-source',href:lawRangeURL(row,proof)},'Показать это основание в решении')));
  }
  function lawEvidence(row) {
    const proofs = lawProofs(row), occurrences = row.occurrences || [];
    const detail = h('details',{class:'analysis-evidence law-evidence'},
      h('summary',{},proofs.length ? 'Основания привязки и буквальные цитаты' : row.verification_status==='act_unknown' ? 'Буквальная ссылка и доступные места в источнике' : 'Буквальная ссылка · основание акта требует проверки'));
    detail.addEventListener('toggle',()=>{
      if (!detail.open || detail.dataset.loaded) return;
      detail.dataset.loaded='1';
      detail.append(h('p',{class:'small muted'},row.field==='headnote'?'Цитата статьи в заголовке издания (OCR):':'Цитата статьи в тексте решения (OCR):'),
        h('blockquote',{class:'source-quote law-citation-quote'},row.quote_original),
        h('p',{class:'small'},h('a',{class:'law-citation-source',href:row.passage_url || row.decision_url},'Открыть точное место ссылки в решении')),
        ...proofs.map(proof=>lawProof(row,proof)));
      if (occurrences.length>1) detail.append(h('details',{class:'law-occurrences'},
        h('summary',{},'Другие места этой ссылки в источнике'),
        h('ul',{},occurrences.filter(o=>o.field!==row.field || o.start!==row.start || o.end!==row.end).map(o=>
          h('li',{},h('a',{href:lawRangeURL(row,o)},o.field==='headnote'?'Заголовок издания':'Текст решения'),
            h('blockquote',{class:'source-quote'},o.quote_original))))));
    });
    return detail;
  }
  async function lawDetailTarget(d, row, params) {
    const at=Number(params.get('at')), end=Number(params.get('end'));
    const spans=[row,...(row.occurrences || []),...lawProofs(row).filter(e=>e.kind!=='printed_index')];
    const span=spans.find(s=>s.start===at && s.end===end && (!params.has('field') || s.field===params.get('field')));
    if (!span) return null;
    const field=span.field || row.field || 'text';
    const target={id:row.passage_id || row.id,start:at,end,field,pages:[],sources:[],scans:[],law:row,quote_original:span.quote_original,ai:{source_warning:row.source_warning}};
    if (field==='headnote') return target;
    if (span===row) return {...target,pages:row.printed_pages || [],sources:row.sources || [],scans:row.scans || []};
    // Additional occurrences and direct proofs have their own exact ranges.
    // Their pages come from source spans, never from the primary citation.
    try {
      if (!S.laws.passages[d.vol]) S.laws.passages[d.vol]=loadJSON(`passages-${d.vol}.json`).catch(err=>{delete S.laws.passages[d.vol];throw err;});
      const [data, scans]=await Promise.all([S.laws.passages[d.vol],loadScans(d.vol)]);
      const passages=data.passages.filter(p=>p.decision===d.id && p.start<end && p.end>at);
      target.sources=passages.flatMap(p=>p.sources || []).filter(s=>s.start<end && s.end>at);
      target.pages=[...new Set(target.sources.map(s=>s.page).filter(p=>p!=null))];
      target.scans=[...new Set(target.sources.map(s=>s.file))].map(file=>scans.pages[file]).filter(Boolean).map(s=>({...s,kind:'page'}));
    } catch (err) { /* Exact text remains available when the page manifest is absent. */ }
    return target;
  }
  function lawCitationItem(row) {
    const source = row.field==='headnote' ? 'заголовок издания (OCR); страница не установлена' : row.scan_available ? 'скан точного места доступен' : 'скан этого места не опубликован';
    return h('li', {class:'law-citation','data-law-id':row.id,'data-verification':row.verification_status,'data-year':String(row.year)},
      h('a', {class:'law-open',href:row.passage_url || row.decision_url}, `${row.year} г. № ${row.decision_number} · ${row.code==='?'?'акт не установлен':row.code} · ${row.article}`),
      h('p',{class:'law-status small'},lawStatus(row)),
      h('div', {class:'law-quote'}, '«' + row.context_original + '»'),
      row.source_warning ? h('p',{class:'preliminary-note source-warning'},'Ограничение источника: '+row.source_warning) : '',
      row.attribution_note ? h('p',{class:'preliminary-note editorial-note'},row.attribution_note) : '',
      h('p', {class:'muted small'}, row.association + ' · ' + source),lawEvidence(row));
  }
  function lawSummary(data) {
    const summary=data.attribution_summary;
    return h('div',{class:'law-summary'},
      h('p',{class:'small'},'Единица счёта — уникальная пара «решение + обозначение статьи»; повторные упоминания внутри решения не увеличивают эти числа.'),
      summary ? h('p',{class:'small'},`Из ${summary.baseline_unknown} исходных неопределённых пар акт установлен для ${summary.resolved_unknown}; осталось ${summary.remaining_unknown}. Подтверждено по контексту: ${summary.confirmed_citations}; прежних отдельно не проверенных привязок: ${summary.legacy_unverified_citations}. Исправлено прежних привязок: ${summary.corrected_known}.`) : '',
      h('p',{class:'muted small'},`Известный акт, но точное место статьи в OCR не найдено: ${data.unlocated_known_mentions || 0} пар. Эти пары не входят в список цитат ниже.`));
  }
  async function renderLaws() {
    const token = ++S.laws.token, status = $('#laws-status'), box = $('#laws-results');
    box.replaceChildren(); status.textContent = 'Загружаем указатель законодательства…';
    let data;
    try { data = await loadLaws(); } catch (err) { if (token === S.laws.token) status.textContent = 'Не удалось загрузить указатель: ' + err.message; return; }
    if (token !== S.laws.token) return;
    $('#laws-code').value = S.laws.code;
    const terms=lawTerms(S.laws.q), byCode=new Map(data.acts.map(act=>[act.code,act]));
    const all=[...data.citations,...(data.unresolved || [])];
    const rows=all.filter(row=>(!S.laws.code || row.code===S.laws.code) && lawCitationMatches(row,byCode.get(row.code),terms));
    const hasQuery=Boolean(terms.length || S.laws.code), decisionCount=new Set(rows.map(row=>row.decision_id)).size;
    const pages=Math.max(1,Math.ceil(rows.length/80)); S.laws.page=Math.min(S.laws.page,pages);
    status.replaceChildren(h('strong',{},`${rows.length} ${plural(rows.length,'пара','пары','пар')} «решение + статья»`),
      h('span',{class:'muted'},` · в ${decisionCount} ${plural(decisionCount,'решении','решениях','решениях')}`));
    box.append(lawSummary(data));
    const matchingActs=data.acts.filter(act=>(!S.laws.code || S.laws.code===act.code) && (!hasQuery || rows.some(row=>row.code===act.code)));
    const sources=new Map(data.sources.map(source=>[source.id,source])), grid=h('div',{class:'map-grid law-grid'});
    for (const act of matchingActs) {
      const selected=rows.filter(row=>row.code===act.code), confirmed=selected.filter(row=>row.verification_status==='context_verified').length;
      const articles=(hasQuery?act.articles.filter(item=>selected.some(row=>row.article===item.article)):act.articles).slice(0,18);
      const links=(act.source_ids || []).map(id=>sources.get(id)).filter(Boolean).map(source=>h('a',{href:source.url,target:'_blank',rel:'noopener'},source.title));
      grid.append(mapNode(`${act.code} · ${act.short_title}`,`${act.decisions} решений · ${act.citations} пар «решение + статья»`,[
        h('p',{class:'muted small'},act.edition_note),
        h('p',{class:'small law-sources'},'Источники названия акта: ',links.flatMap((link,i)=>i?[' · ',link]:[link])),
        h('p',{class:'small'},`В выборке подтверждено по контексту: ${confirmed}; прежних непроверенных привязок: ${selected.length-confirmed}.`),
        h('p',{},h('a',{class:'law-act-open',href:'#/laws?'+new URLSearchParams({c:act.code,q:S.laws.q})},'Показать ссылки на этот акт')),
        articles.length ? h('div',{class:'chips'},articles.map(item=>h('a',{class:'chip stat',href:'#/laws?'+new URLSearchParams({c:act.code,q:item.article})},`${item.article} (${item.decisions})`))) : h('p',{class:'muted small'},'В привязанных ссылках статьи не выделены.')
      ],'law-'+act.code));
    }
    const unknown=rows.filter(row=>row.code==='?');
    if ((!S.laws.code || S.laws.code==='?') && (!hasQuery || unknown.length)) grid.append(mapNode('Акт не установлен',`${unknown.length} пар «решение + статья»`,[
      h('p',{class:'small muted'},'Номер статьи сохранён из OCR. Опубликованных оснований недостаточно для привязки к конкретному акту.'),
      h('a',{class:'law-unknown-open',href:'#/laws?'+new URLSearchParams({c:'?',q:S.laws.q})},'Посмотреть неопределённые ссылки')
    ],'law-unknown'));
    if (grid.childElementCount) box.append(grid);
    if (!rows.length) box.append(h('p',{class:'empty'},'Не найдено. Ищите номер статьи, акт, год, номер решения или слова из контекста.'));
    if (hasQuery && rows.length) {
      const first=(S.laws.page-1)*80;
      box.append(h('h3',{},S.laws.code==='?'?'Неопределённые ссылки':'Ссылки в решениях'),
        h('ol',{class:'map-list law-citations',start:String(first+1)},rows.slice(first,first+80).map(lawCitationItem)));
      if (pages>1) {
        const change=page=>go('laws',{q:S.laws.q,c:S.laws.code,page:String(page)});
        box.append(h('nav',{class:'law-pagination','aria-label':'Страницы законодательных ссылок'},
          h('button',{class:'btn ghost',id:'laws-prev',disabled:S.laws.page===1,onclick:()=>change(S.laws.page-1)},'Назад'),
          h('p',{class:'small'},`Страница ${S.laws.page} из ${pages} · показаны пары ${first+1}–${Math.min(first+80,rows.length)}`),
          h('button',{class:'btn ghost',id:'laws-next',disabled:S.laws.page===pages,onclick:()=>change(S.laws.page+1)},'Далее')));
      }
    }
    box.append(h('p',{class:'muted small law-note'},data.note));
  }

  /* ---------------------------------------------------------------- аналитика */
  function bars(rows, opts) {
    opts = opts || {}; const max = Math.max(1, ...rows.map(r => r[1]));
    return h('div', { class: 'bars', role: 'list' }, rows.map(r => {
      const row = h(opts.click ? 'button' : 'div', { class: 'bar-row', role: 'listitem', title: `${r[0]}: ${r[1]}`, onclick: opts.click ? () => opts.click(r) : null },
        h('span', { class: 'bar-label' }, opts.label ? opts.label(r) : r[0]),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${Math.max(1.5, 100 * r[1] / max)}%` })),
        h('span', { class: 'bar-val' }, String(r[1])));
      return row;
    }));
  }
  function card(title, note, body) { return h('section', { class: 'panel' }, h('h3', {}, title), note ? h('p', { class: 'muted small' }, note) : '', body); }
  function renderAnalytics() {
    const an = S.an, dec = S.meta.decisions, root = $('#analytics-body');
    const years = Object.keys(an.by_year);
    const kpi = h('div', { class: 'kpis' },
      ...[[dec.length, 'решений в корпусе'], [years.length, plural(years.length, 'том', 'тома', 'томов') + ': ' + years.join(', ')], [Math.round(an.total_words / 1000) + ' тыс.', 'слов текста'], [an.words_median, 'слов в типичном решении']]
        .map(([v, t]) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-v' }, String(v)), h('div', { class: 'muted' }, t))));
    const months = Object.entries(an.by_month).filter(([m]) => m);
    const monthCols = h('div', { class: 'cols', role: 'list' }, months.map(([m, n]) => h('div', { class: 'col', role: 'listitem', title: `${m}: ${n}` },
      h('span', { class: 'col-v' }, String(n)), h('span', { class: 'col-fill', style: `height:${Math.max(2, 100 * n / Math.max(...months.map(x => x[1])))}%` }), h('span', { class: 'col-l' }, m.slice(5) + '.' + m.slice(2, 4)))));
    const trend = h('div', {}, h('form', { class: 'row', onsubmit: e => { e.preventDefault(); drawTrend($('#trend-q').value); } },
      h('input', { id: 'trend-q', type: 'search', placeholder: 'слово или термин, например: вексель', value: 'железная дорога' }), h('button', { class: 'btn', type: 'submit' }, 'Показать')), h('div', { id: 'trend-out' }));
    const people = role => bars(an[role].slice(0, 10), { click: r => go('search', { p: r[0] }) });
    root.replaceChildren(kpi,
      h('div', { class: 'grid' },
        card('Как решались просьбы', 'Исход определён автоматически по резолютивной части решения.', bars(Object.entries(an.outcomes), { click: r => go('search', { o: r[0] }) })),
        card('Фокус кассационного рассуждения', 'Автоматические метки по тексту: они показывают обсуждаемую тему, а не установленное основание решения.', bars(Object.entries(an.procedures), { click: r => go('search', { r: r[0] }) })),
        card('О чём решения', 'Единый редакционный каталог: 26 тем с подтверждающими цитатами. Одно дело может входить в несколько тем. Разметка подготовлена с помощью ИИ.', bars(topicList().map(t=>[t.title,t.count,t.id]), { click: r => go('search', { t: r[2] }) })),
        ...FACET_FILTERS.map(facet => {
          const data = an.participant_facets[facet.key], rows = Object.entries(data.values);
          if (data.unknown) rows.push(['Не указано в заголовке', data.unknown, '__unknown__']);
          return card(data.label, 'Признак ставится только по прямой формулировке в заголовке дела; одно решение может входить в несколько групп.',
            bars(rows, {click:r=>go('search',{[facet.param]:r[2] || r[0]})}));
        }),
        card('Самые часто упоминаемые статьи', 'Число решений, где статья названа. Кодекс определён автоматически там, где он указан рядом со статьёй. Нажмите, чтобы найти решения.',
          bars(an.statutes.slice(0, 15), { label: r => statLabel(r[0]), click: r => go('search', { s: r[0] }) })),
        card('Кодексы и акты', 'Кодекс определяется по соседней формулировке в тексте; «не определён» означает, что номер статьи виден, но акт не установлен.',
          bars(Object.entries(an.statute_codes), { label: r => codeLabel(r[0]), click: r => go('search', { c: r[0] }) })),
        card('Решения по месяцам', 'Дата — день заседания по заголовку решения.', monthCols),
        card('Кто председательствовал', 'Чаще всего в этом составе.', people('presiding')),
        card('Кто докладывал дело', '', people('reporter')),
        card('Кто давал заключение (прокуратура)', '', people('prosecutor')),
        card('Ссылки на прежние решения', 'Число решений, в которых встречается ссылка. Учреждения учитываются отдельно; ссылки без установленного департамента в эту таблицу не объединяются. Частота упоминаний сама по себе не определяет значение решения.',
          h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Решение'), h('th', {}, 'Упоминается в'))), h('tbody', {}, (an.cited_decisions || []).slice(0, 12).map(ref=>h('tr',{},h('td',{},precedentTarget(ref) ? h('a',{href:'#/d/'+ref.target_id},precedentLabel(ref)) : precedentLabel(ref)),h('td',{},String(ref.decisions))))))),
        card('Как менялась частота слова по годам', 'Сколько раз слово встречается на 10 тысяч слов текста. Пока в корпусе мало томов — график станет содержательным по мере добавления.', trend)));
    drawTrend('железная дорога');
  }
  function drawTrend(q) {
    const out = $('#trend-out'); if (!out) return;
    const st = L.stems(q); if (!st.length) { out.replaceChildren(); return; }
    const words = {}, hits = {};
    for (const d of S.meta.decisions) words[d.vol] = (words[d.vol] || 0) + S.index.len[d.i];
    const sets = st.map(s => S.engine.post(s, 'b'));
    for (const d of S.meta.decisions) { let tf = Infinity; for (const p of sets) tf = Math.min(tf, p && p.has(d.i) ? p.get(d.i) : 0); if (tf > 0 && tf !== Infinity) hits[d.vol] = (hits[d.vol] || 0) + tf; }
    const rows = S.meta.volumes.map(v => [String(v.year), Math.round(10000 * (hits[v.year] || 0) / (words[v.year] || 1) * 10) / 10]);
    out.replaceChildren(bars(rows), h('p', { class: 'muted small' }, `Слов текста в корпусе: ${Object.values(words).reduce((a, b) => a + b, 0)}.`));
  }

  /* ---------------------------------------------------------------- запуск */
  async function main() {
    try {
      const [meta, index, an] = await Promise.all([loadJSON('meta.json'), loadJSON('index.json'), loadJSON('analytics.json')]);
      S.meta = meta; S.index = index; S.an = an; S.volStart = {};
      S.participantMap = new Map((meta.participants || []).map(e=>[e.id,e]));
      meta.decisions.forEach(d => { if (S.volStart[d.vol] == null) S.volStart[d.vol] = d.i; });
      $('#corpus-summary').textContent = `В корпусе: ${meta.volumes.map(v=>v.year).join(', ')} · ${meta.decisions.length} ${plural(meta.decisions.length,'решение','решения','решений')}`;
      $('#corpus-summary').hidden = false;
      S.engine = L.makeEngine(index, meta.decisions);
      S.places=window.SenatPlaces.create({meta,loadJSON,topicList,topicId,sourceEvidence,modernize:M});
      S.reader=window.SenatReaderUI.create({meta,textOf,loadJSON,loadScans,formatDate:fmtDate,setModern,isModern:()=>S.opts.modern,warningOf:d=>(S.an.source_warnings?.[d.id]?.messages||[]).join(' ')});
      S.research=window.SenatResearchUI.create({meta,analytics:an,reader:S.reader,prepare:async()=>{
        await loadSense();const [catalog,guides]=await Promise.all([loadAnalysesIndex(),loadGuides()]);
        return {engines:S.sense.engines,config:S.sense.config,context:window.SenatResearch.context({meta,analytics:an,analyses:{decisions:{}},analyses_revision:catalog.revision,analysisOf:loadAnalysis,guides,config:S.sense.config,
          volumes:S.sense.engines.map(e=>e.data),textOf,loadScans})};
      }});
      $('#loading').hidden = true; setupControls(); route(); addEventListener('hashchange', route);
    } catch (e) {
      $('#loading').textContent = 'Не удалось загрузить данные: ' + e.message + '. Откройте страницу через веб-сервер (например, `python3 -m http.server` в папке lex).';
    }
  }
  main();
})();
