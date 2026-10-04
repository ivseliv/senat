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
    meta: null, index: null, an: null, engine: null, texts: {}, stemCache: new Map(),
    opts: { modern: false, gloss: true }, detailId: null,
    sense: { config: null, engines: [], promise: null, q: '', hits: [], shown: 10, token: 0 },
    map: { q: '', topic: '', token: 0 },
    participants: {q:'', year:'', shown:60}, participantMap: new Map(),
    f: { q: '', year: '', outcome: '', topic: '', code: '', statute: '', procedure: '', person: '', participant: '', gender: '', age: '', family: '', estate: '', entity: '', role: '', sort: 'rel' }, shown: 20, hits: [], sentinel: 0,
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v; else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
    return el;
  }
  const M = t => S.opts.modern ? L.modernize(t) : t;
  const fmtDate = (iso, label) => { if (!iso) return label ? M(label) : ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const CODE = () => S.an.codes;
  const statuteCode = s => s.split(' ', 1)[0];
  const codeLabel = code => code === '?' ? 'Кодекс не определён' : (CODE()[code] || 'Иной акт');
  const statLabel = s => { const [code, ...rest] = s.split(' '); return codeLabel(code) + ', ' + rest.join(' '); };
  const deptShort = d => d.replace(' департамент', '').replace('Гражданский кассационный', 'Гражд. касс. деп.');

  async function loadJSON(name) { if (window.LEX_INLINE && window.LEX_INLINE[name]) return window.LEX_INLINE[name]; const r = await fetch(DATA + name); if (!r.ok) throw new Error(name + ': ' + r.status); return r.json(); }
  async function loadVol(y) { if (!S.texts[y]) S.texts[y] = loadJSON(`text-${y}.json`); return S.texts[y]; }
  async function textOf(d) { return (await loadVol(d.vol))[localIndex(d)]; }
  function localIndex(d) { return d.i - S.volStart[d.vol]; }
  async function stemsOf(d) {
    if (!S.stemCache.has(d.i)) S.stemCache.set(d.i, L.stems(d.headnote + '\n' + await textOf(d)));
    return S.stemCache.get(d.i);
  }

  /* Сканы: метаданные по томам, картинки только при показе/открытии. */
  const scanData = new Map();
  function loadScans(year) {
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
    const requested = path.startsWith('d/') ? (['sense','participants','map'].includes(p.get('mode')) ? p.get('mode') : 'search') : (path.split('/')[0] || 'search');
    const tab = ['search','sense','map','participants','analytics','about'].includes(requested) ? requested : 'search';
    for (const t of ['search','sense','map','participants','analytics','about']) {
      $('#view-' + t).hidden = t !== tab;
      $('#tab-' + t).setAttribute('aria-current', t === tab ? 'page' : 'false');
    }
    if (tab === 'search') {
      Object.assign(S.f, { q: p.get('q') || '', year: p.get('y') || '', outcome: p.get('o') || '', topic: p.get('t') || '',
        code: p.get('c') || '', statute: p.get('s') || '', procedure: p.get('r') || '', person: p.get('p') || '', participant: p.get('u') || '', sort: p.get('sort') || 'rel' },
        Object.fromEntries(FACET_FILTERS.map(f => [f.key, p.get(f.param) || ''])));
      syncControls(); runSearch();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'sense') {
      S.sense.q = p.get('q') || ''; $('#sense-q').value = S.sense.q; runSense();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'map') {
      S.map.q = p.get('q') || ''; S.map.topic = p.get('t') || '';
      $('#map-q').value = S.map.q; $('#map-topic').value = S.map.topic; renderMap();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else if (tab === 'participants') {
      Object.assign(S.participants, {q:p.get('q') || '', year:p.get('y') || '', shown:60});
      renderParticipants();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else closeDetail();
    if (tab === 'analytics') renderAnalytics();
    if (tab === 'about') renderCorpus();
    window.scrollTo(0, path.startsWith('d/') ? window.scrollY : 0);
  }
  function pushSearch() {
    const f = S.f; const params = { q: f.q, y: f.year, o: f.outcome, t: f.topic, c: f.code, s: f.statute, r: f.procedure, p: f.person, u:f.participant, sort: f.sort === 'rel' ? '' : f.sort };
    for (const facet of FACET_FILTERS) params[facet.param] = f[facet.key];
    go('search', params);
  }
  async function renderCorpus() {
    const box = $('#corpus-table');
    try {
      const config = S.sense.config || await loadJSON('concepts.json');
      box.replaceChildren(h('table', {class:'tbl'},
        h('thead', {}, h('tr', {}, ...['Том','Решений','Фрагментов с пояснением ИИ'].map(t=>h('th',{},t)))),
        h('tbody', {}, S.meta.volumes.map(v=>{
          const coverage=config.volumes.find(c=>c.year===v.year);
          return h('tr', {}, h('td',{},String(v.year)), h('td',{},String(v.decisions)),
            h('td',{},coverage ? `${coverage.enriched} из ${coverage.passages}` : 'Сведения недоступны'));
        }))));
    } catch (err) { box.textContent='Не удалось загрузить сведения о томах. Повторите открытие раздела.'; }
  }

  /* ---------------------------------------------------------------- поиск */
  function filterFn() {
    const f = S.f;
    return d => (!f.year || String(d.vol) === f.year) && (!f.outcome || d.outcome === f.outcome) && (!f.topic || d.topics.includes(f.topic)) &&
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
    const res = S.engine.search(S.f.q, { gloss: S.opts.gloss, filter: filterFn() });
    let hits = res.hits;
    if (res.query.phrases.length && hits.length) {
      const keep = [];
      for (const hit of hits) {
        const st = await stemsOf(S.meta.decisions[hit.i]);
        if (my !== runToken) return;
        if (res.query.phrases.every(p => containsSeq(st, p))) keep.push(hit);
      }
      hits = keep;
    }
    if (S.f.sort === 'date') hits = hits.slice().sort((a, b) => (S.meta.decisions[b.i].date || '').localeCompare(S.meta.decisions[a.i].date || '') || a.i - b.i);
    else if (!S.f.q.trim()) hits = hits.slice().sort((a, b) => a.i - b.i);
    S.hits = hits; S.query = res.query; S.shown = 20;
    renderResults(my);
  }
  function containsSeq(arr, seq) {
    outer: for (let i = 0; i + seq.length <= arr.length; i++) { for (let j = 0; j < seq.length; j++) if (arr[i + j] !== seq[j]) continue outer; return true; }
    return false;
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
        h('div', { class: 'chips' }, d.topics.map(t => h('button', { class: 'chip', onclick: () => { S.f.topic = t; pushSearch(); } }, t))),
        d.procedure && d.procedure.length ? h('div', { class: 'chips' }, d.procedure.map(p => h('button', { class: 'chip group', title: 'Фильтровать по фокусу кассационного рассуждения', onclick: () => { S.f.procedure = p; pushSearch(); } }, p))) : '',
        h('div', { class: 'chips participant-chips' }, groupItems(d).slice(0, 8).map(g => h('button', { class: 'chip group', title: 'Фильтровать решения по этому признаку', onclick: () => selectFacet(g.key, g.label) }, g.label))));
      card.addEventListener('click', e => { if (!e.target.closest('button,a')) openFromList(d.id); });
      card.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === card) openFromList(d.id); });
      box.append(card);
    }
    $('#more').hidden = total <= S.shown;
    $('#more').textContent = `Показать ещё (осталось ${total - S.shown})`;
    // сниппеты подгружаем лениво
    for (const hit of page) {
      const d = S.meta.decisions[hit.i]; const text = await textOf(d);
      if (token !== runToken) return;
      const el = box.querySelector(`.snip[data-i="${d.i}"]`); if (!el) continue;
      let body = text; const cut = body.indexOf('\n\n'); if (!qs.length && cut > 0) body = body;
      el.innerHTML = L.snippet(M(body), qs, 300);
      if (q) {
        try {
          const scans=await loadScans(d.vol); if(token!==runToken)return;
          const p=bestScanPassage(scans,d,text,qs);
          if(p) {el.innerHTML=L.snippet(M(p.text),qs,300);el.after(scanStrip(d,scans.passages[p.id]));}
        } catch(err) { /* При отсутствии сканов текстовый поиск остаётся доступен. */ }
      }
    }
  }
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  function openFromList(id) { const { p } = readHash(); location.hash = '#/d/' + id + (p.toString() ? '?' + p.toString() : ''); }

  /* ---------------------------------------------------------------- карточка решения */
  async function openDetail(id) {
    S.detailId = id;
    const d = S.meta.decisions.find(x => x.id === id); const box = $('#detail-body');
    if (!d) { box.replaceChildren(h('p', {}, 'Решение не найдено')); $('#detail').hidden = false; return; }
    $('#detail').hidden = false; document.body.classList.add('modal');
    box.replaceChildren(h('p',{class:'muted'},'Загрузка решения…'));
    const text = await textOf(d);
    if (S.detailId !== id || $('#detail').hidden) return;
    const params = readHash().p, inSense = ['sense','map','passage'].includes(params.get('mode'));
    let target = null, senseTerms = [];
    if (inSense) {
      await loadSense();
      if (S.detailId !== id || $('#detail').hidden) return;
      target = S.sense.engines.flatMap(e => e.data.passages).find(x => x.decision === id && String(x.start) === params.get('at') && String(x.end) === params.get('end'));
      if (target) {
        const result = S.sense.engines.flatMap(e => e.engine.search(params.get('q') || '', S.sense.config.method).hits).find(h => h.passage.id === target.id);
        senseTerms = [params.get('q') || '', ...(result ? result.matched : [])];
      }
    }
    const cited = S.meta.decisions.filter(x => x.cites.some(c => c[0] === d.vol && c[1] === d.num));
    const inCorpus = ([y, n]) => S.meta.decisions.find(x => x.vol === y && x.num === n);
    const qs = inSense ? senseTerms.flatMap(L.stems) : queryStems();
    const paintPiece = t => qs.length ? highlight(M(t), qs) : L.esc(M(t));
    const paint = t => {
      let offset = 0, first = true;
      return t.split('\n\n').map(par => {
        const length = Array.from(par).length;
        const a = target ? Math.max(0, target.start-offset) : length, b = target ? Math.min(length, target.end-offset) : 0;
        let html;
        if (a < b) {
          html = paintPiece(window.Concept.slice(par,0,a)) + '<span class="passage-focus"' + (first ? ' id="passage-target" tabindex="-1"' : '') + '>' + paintPiece(window.Concept.slice(par,a,b)) + '</span>' + paintPiece(window.Concept.slice(par,b)); first = false;
        } else html = paintPiece(par);
        offset += length+2; return '<p>'+html+'</p>';
      }).join('');
    };
    const cite = `Решение ${d.dept === 'Общее собрание' ? 'Общего собрания' : d.dept.replace('кий', 'кого').replace('ый', 'ого')} Правительствующего Сената ${d.vol} г. № ${d.num}` + (target ? ', ' + pageLabel(target) : '');
    const body = h('div', { class: 'text', html: paint(text) });
    box.replaceChildren(
      h('div', { class: 'detail-head' },
        h('h2', {}, `№ ${d.num} · ${fmtDate(d.date, d.date_label)}`),
        h('div', { class: 'muted' }, `${d.dept}, том ${d.vol}`),
        h('span', { class: 'badge big' }, d.outcome)),
      h('p', { class: 'headnote' }, M(d.headnote)),
      h('dl', { class: 'meta' },
        d.presiding ? h('div', {}, h('dt', {}, 'Председательствовал'), h('dd', {}, personLink(d.presiding))) : '',
        d.reporter ? h('div', {}, h('dt', {}, 'Докладывал'), h('dd', {}, personLink(d.reporter))) : '',
        d.prosecutor ? h('div', {}, h('dt', {}, 'Заключение давал'), h('dd', {}, personLink(d.prosecutor))) : ''),
      h('div', { class: 'chips' }, d.topics.map(t => h('button', { class: 'chip', onclick: () => { S.f.topic = t; go('search', { t }); } }, t))),
      groupItems(d).length ? h('section', {}, h('h3', {}, 'Участники и социальные группы'),
        h('div', { class: 'chips participant-chips' }, groupItems(d).map(g => h('button', { class: 'chip group', onclick: () => { S.f[g.key] = g.label; pushSearch(); } }, g.label)))) : '',
      d.participant_ids && d.participant_ids.length ? h('section',{},h('h3',{},'Участники по указателю издания'),
        h('p',{class:'muted small'},'Записи печатного указателя, без определения роли в деле.'),
        h('ul',{},d.participant_ids.map(id=>h('li',{},participantLink(S.participantMap.get(id)))))) : '',
      Object.keys(d.statutes).length ? h('section', {}, h('h3', {}, 'Упомянутые статьи'), h('div', { class: 'chips' },
        Object.keys(d.statutes).sort().map(s => h('button', { class: 'chip stat', title: 'Найти все решения с этой статьёй', onclick: () => go('search', { s }) }, statLabel(s))))) : '',
      h('div', { class: 'toolbar' },
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Орфография текста' },
          h('button', { class: 'seg-b', 'aria-pressed': String(!S.opts.modern), onclick: () => setModern(false) }, 'Дореформенная'),
          h('button', { class: 'seg-b', 'aria-pressed': String(S.opts.modern), onclick: () => setModern(true) }, 'Современная')),
        h('button', { class: 'btn', onclick: e => { const btn = e.target; const txt = cite + '\n' + location.href; const done = ok => { btn.textContent = ok ? 'Скопировано ✓' : 'Не удалось скопировать — выделите текст вручную'; setTimeout(() => btn.textContent = 'Скопировать ссылку и цитату', 2000); }; try { navigator.clipboard.writeText(txt).then(() => done(true), () => done(false)); } catch (err) { done(false); } } }, 'Скопировать ссылку и цитату')),
      body,
      h('p', { class: 'muted small' }, 'Текст получен автоматическим распознаванием скана (модель ИИ) и может содержать ошибки: числа, номера статей и фамилии сверяйте с изданием. Современная орфография — автоматическая, для удобства чтения.'),
      d.cites.length ? h('section', {}, h('h3', {}, 'Ссылается на решения'), h('ul', {}, d.cites.map(c => { const t = inCorpus(c); return h('li', {}, t ? h('a', { href: '#/d/' + t.id }, `${c[0]} г. № ${c[1]} — ${M(t.headnote).slice(0, 90)}…`) : `${c[0]} г. № ${c[1]} (нет в корпусе)`); }))) : '',
      cited.length ? h('section', {}, h('h3', {}, 'Цитируется в'), h('ul', {}, cited.map(x => h('li', {}, h('a', { href: '#/d/' + x.id }, `${x.vol} г. № ${x.num} — ${M(x.headnote).slice(0, 90)}…`))))) : '',
      d.similar.length ? h('section', {}, h('h3', {}, 'Похожие решения'), h('ul', {}, d.similar.map(([j, sc]) => { const x = S.meta.decisions[j]; return h('li', {}, h('a', { href: '#/d/' + x.id }, `${x.vol} г. № ${x.num} — ${M(x.headnote).slice(0, 100)}…`), h('span', { class: 'muted' }, ` (сходство ${Math.round(sc * 100)}%)`)); }))) : '');
    const scanSection=h('details',{class:'detail-scans'},h('summary',{},target?'Сканы найденного фрагмента':'Страницы решения в издании'));
    scanSection.addEventListener('toggle',async()=>{
      if(!scanSection.open || scanSection.dataset.loaded)return;
      try {
        const scans=await loadScans(d.vol);
        const refs=target?scans.passages[target.id]:(scans.decisions[d.id]||[]).map(file=>({...scans.pages[file],kind:'page'}));
        if(refs && refs.length) {scanSection.append(scanStrip(d,refs));scanSection.dataset.loaded='1';}
        else scanSection.append(h('p',{class:'small'},'Сканы этого места пока недоступны.'));
      } catch(err) {scanSection.append(h('p',{class:'small'},'Не удалось загрузить список страниц. Закройте и откройте этот раздел для повторной попытки.'));}
    });
    body.before(scanSection);
    $('#detail').scrollTop = 0;
    if (target) {
      const anchor = $('#passage-target');
      if (anchor) { anchor.scrollIntoView({block:'start'}); anchor.focus({preventScroll:true}); }
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
  function highlight(par, qs) {
    const set = new Set(qs); const re = /[А-Яа-яЁёѢѣІіѲѳѴѵъь0-9]+/g; let out = '', pos = 0, m;
    while ((m = re.exec(par))) { out += L.esc(par.slice(pos, m.index)); const w = m[0]; out += set.has(L.stem(L.modernize(w).toLowerCase().replace(/ё/g, 'е'))) ? '<mark>' + L.esc(w) + '</mark>' : L.esc(w); pos = m.index + w.length; }
    return out + L.esc(par.slice(pos));
  }
  function personLink(name) { return h('a', { href: '#/search?p=' + encodeURIComponent(name) }, name); }
  function closeDetail() { $('#detail').hidden = true; document.body.classList.remove('modal'); }

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
    fillSelect($('#f-topic'), Object.entries(an.topics).map(([k, n]) => [k, `${k} (${n})`]), 'Любая тема');
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
    $('#more').addEventListener('click', () => { S.shown += 20; renderResults(++runToken); });
    $('#reset').addEventListener('click', () => go('search'));
    $('#detail-close').addEventListener('click', () => { const { p } = readHash(); const requested = p.get('mode'); const mode = requested === 'passage' ? 'sense' : (['sense','participants','map'].includes(requested) ? requested : 'search'); p.delete('at'); p.delete('end'); p.delete('mode'); location.hash = '#/' + mode + (p.toString() ? '?' + p.toString() : ''); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.querySelector('.scan-dialog[open]') && !$('#detail').hidden) $('#detail-close').click(); });
    $('#examples').append(...['недействительность сделки', 'возмещение убытков', 'исковая давность', 'договор аренды', 'банкротство', 'страховое возмещение', 'перевозка грузов', 'исполнитель завещания']
      .map(x => h('button', { class: 'chip', onclick: () => go('search', { q: x }) }, x)));
    $('#sense-form').addEventListener('submit', e => {
      e.preventDefault(); const q = $('#sense-q').value.trim(), current = readHash();
      if (current.path === 'sense' && (current.p.get('q') || '') === q) { S.sense.q = q; runSense(); }
      else go('sense', {q});
    });
    $('#sense-examples').append(...['фиктивные сделки', 'неосновательное обогащение', 'добросовестный приобретатель', 'бремя доказывания', 'уступка права требования', 'срок принятия наследства', 'возмещение вреда здоровью', 'производственная травма'].map(q => h('button', {class:'chip', onclick:()=>go('sense',{q})}, q)));
    for (const id of ['search-concepts', 'sense-concepts']) {
      const box = $('#' + id);
      box.querySelector('.concept-catalog').append(...MODERN_CONCEPTS.map(([title, queries]) => h('section', {},
        h('h3', {}, title), h('div', {class:'chips'}, queries.map(q => h('button', {class:'chip', onclick:()=>{
          box.open = false; go('sense', {q});
        }}, q))))));
    }
    $('#sense-more').addEventListener('click', () => { S.sense.shown += 10; renderSense(++S.sense.token); });
    fillSelect($('#map-topic'), Object.entries(an.topics).map(([k, n]) => [k, `${k} (${n})`]), 'Все темы');
    $('#map-form').addEventListener('submit', e => { e.preventDefault(); go('map', {q:$('#map-q').value.trim(),t:$('#map-topic').value}); });
    $('#map-reset').addEventListener('click', () => go('map'));
    $('#map-concepts .concept-catalog').append(...MODERN_CONCEPTS.map(([title, queries]) => h('section', {},
      h('h3', {}, title), h('div', {class:'chips'}, queries.map(q => h('button', {class:'chip', onclick:()=>go('map',{q,t:S.map.topic})}, q))))));
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
      $('#sense-status').textContent = 'Введите современное понятие или выберите пример.';
      $('#sense-results').replaceChildren(); return;
    }
    $('#sense-status').textContent = 'Ищем фрагменты…';
    $('#sense-results').replaceChildren();
    try {
      await loadSense(); if (token !== S.sense.token) return;
      const results = S.sense.engines.map(e => e.engine.search(S.sense.q, S.sense.config.method));
      S.sense.hits = results.flatMap(r=>r.hits).sort((a,b)=>b.score-a.score || a.passage.id.localeCompare(b.passage.id));
      S.sense.concepts = results[0] ? results[0].concepts : [];
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
  async function renderSense(token) {
    const box = $('#sense-results'); box.replaceChildren();
    const hits = S.sense.hits;
    $('#sense-status').replaceChildren(h('strong', {}, `${hits.length} ${plural(hits.length,'фрагмент','фрагмента','фрагментов')}`),
      h('span', {class:'muted'}, S.sense.concepts && S.sense.concepts.length ? ' · понятия: '+S.sense.concepts.map(c=>c.concept).join(', ') : ''));
    if (!hits.length) {
      box.append(h('p', {class:'empty'}, 'Подходящие фрагменты в доступных томах не найдены. Это не доказывает отсутствия такой практики: попробуйте другое понятие или обычный поиск.')); return;
    }
    for (const hit of hits.slice(0,S.sense.shown)) {
      const p=hit.passage, d=S.meta.decisions.find(x=>x.id===p.decision);
      const text=await textOf(d); if(token!==S.sense.token) return;
      const original=window.Concept.slice(text,p.start,p.end);
      const terms=[S.sense.q,...hit.matched];
      const link='#/d/'+d.id+'?'+new URLSearchParams({mode:'sense',q:S.sense.q,at:String(p.start),end:String(p.end)});
      box.append(h('article', {class:'card passage', 'data-passage':p.id},
        h('div', {class:'passage-text',html:(p.start ? '… ' : '') + window.Concept.highlightEvidence(M(original),terms,p.ai ? M(p.ai.evidence) : '') + (p.end < Array.from(text).length ? ' …' : '')}),
        p.ai ? h('div', {class:'ai-note'}, h('strong', {}, 'Пояснение ИИ: '), p.ai.summary,
          h('details', {}, h('summary', {}, 'Цитата, на которой основано пояснение'), h('p', {}, '«… ' + M(p.ai.evidence) + ' …»'))) : '',
        h('div', {class:'card-top'}, h('span', {class:'num'}, `№ ${d.num}`), h('span', {class:'muted'}, `${fmtDate(d.date, d.date_label)} · том ${d.vol} · ${pageLabel(p)}`), h('span', {class:'badge'}, d.outcome)),
        h('p', {class:'small'}, h('a', {href:link}, 'Открыть в карточке на этом месте'))));
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
      h('div',{class:'chips'},...d.topics.map(t=>h('button',{class:'chip',onclick:()=>go('map',{q:S.map.q,t})},t))))));
  }
  async function renderMap() {
    const token=++S.map.token, q=S.map.q.trim(), topic=S.map.topic;
    const status=$('#map-status'), box=$('#map-results'); box.replaceChildren();
    if (!q && !topic) {
      status.textContent='Выберите тему или введите современное понятие.';
      box.append(mapNode('Темы корпуса','Метки определены автоматически по заголовкам и текстам; они служат навигацией, а не юридической квалификацией.',
        h('div',{class:'chips'},...Object.entries(S.an.topics).sort((a,b)=>b[1]-a[1]).map(([t,n])=>h('button',{class:'chip',onclick:()=>go('map',{t})},`${t} (${n})`))),'themes'));
      return;
    }
    status.textContent='Собираем связи по первоисточникам…';
    let matched=[], concepts=[];
    if (q) {
      try {
        await loadSense(); if(token!==S.map.token)return;
        const results=S.sense.engines.map(e=>e.engine.search(q,S.sense.config.method));
        concepts=results[0] ? results[0].concepts : [];
        matched=results.flatMap(r=>r.hits).sort((a,b)=>b.score-a.score || a.passage.id.localeCompare(b.passage.id));
        if(topic) matched=matched.filter(hit=>S.meta.decisions.find(d=>d.id===hit.passage.decision).topics.includes(topic));
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
      S.meta.decisions.filter(d=>d.topics.includes(topic)).map(d=>({d,hit:null}));
    const statutes={}, participants=new Map(), topicCounts={};
    for(const {d} of decisions) {
      Object.entries(d.statutes).forEach(([s,n])=>statutes[s]=(statutes[s]||0)+n);
      (d.participant_ids||[]).forEach(id=>{const entry=S.participantMap.get(id);if(entry)participants.set(id,entry);});
      d.topics.forEach(t=>topicCounts[t]=(topicCounts[t]||0)+1);
    }
    const sources=matched.slice(0,8), topDecisions=decisions.slice(0,25);
    const hasSources=Boolean(q);
    status.replaceChildren(h('strong',{},`${decisions.length} ${plural(decisions.length,'решение','решения','решений')}`),
      h('span',{class:'muted'},hasSources ? ` · связи по ${matched.length} ${plural(matched.length,'фрагменту','фрагментам','фрагментам')} в ранжированной выдаче` : ` · тема: ${topic}`),
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
          h('div',{class:'small',html:'«… '+window.Concept.highlightEvidence(M(original),[q,...hit.matched],p.ai ? M(p.ai.evidence) : '')+' …»'})));
      }
      grid.append(mapNode('Фрагменты первоисточника','Каждая связь начинается с ранжированного фрагмента; ссылка открывает точное место и его скан.',h('ol',{class:'map-list map-sources'},sourceItems),'sources'));
    }
    grid.append(mapNode('Решения','Показаны до 25 решений; в каждой карточке сохраняются исходная тема и прямая ссылка.',mapDecisionList(topDecisions),'decisions'));
    const statRows=Object.entries(statutes).filter(([s])=>!s.startsWith('?')).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,20);
    grid.append(mapNode('Упомянутые нормы','Это извлечённые ссылки из найденных решений. Номер акта нужно сверять с изданием.', statRows.length ?
      h('div',{class:'chips'},...statRows.map(([s,n])=>h('a',{class:'chip stat',href:'#/search?'+new URLSearchParams({s})},`${statLabel(s)} (${n})`))) : h('p',{class:'muted'},'Определённых ссылок на статьи нет.'),'statutes'));
    const entries=[...participants.values()].sort((a,b)=>participantLabel(a).localeCompare(participantLabel(b),'ru')).slice(0,30);
    grid.append(mapNode('Участники','Записи печатных указателей, связанные с найденными решениями. Они не устанавливают процессуальную роль или биографию.',entries.length ?
      h('ul',{class:'map-list'},entries.map(entry=>h('li',{},participantLink(entry)))) : h('p',{class:'muted'},'В печатных указателях для этих решений записей нет.'),'participants'));
    const relatedTopics=Object.entries(topicCounts).sort((a,b)=>b[1]-a[1]);
    grid.append(mapNode('Темы в выборке','Автоматические темы — вход в другую ветвь карты.',h('div',{class:'chips'},...relatedTopics.map(([t,n])=>h('button',{class:'chip',onclick:()=>go('map',{q:S.map.q,t})},`${t} (${n})`))),'related-topics'));
    box.append(grid);
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
        card('О чём решения', 'Тема определяется по ключевым словам в заголовке и тексте; у решения может быть до трёх тем. Нажмите строку, чтобы открыть решения.', bars(Object.entries(an.topics), { click: r => go('search', { t: r[0] }) })),
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
        card('Какие прежние решения цитируются чаще всего', 'Ссылки вида «рѣш. 1887 г. № 16» — так виден «ядро» устойчивой практики. В корпус пока входят не все годы, поэтому ссылка не всегда ведёт к тексту.',
          h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Решение'), h('th', {}, 'Ссылок'))), h('tbody', {}, an.cited.slice(0, 12).map(([y, n, c, i]) => h('tr', {}, h('td', {}, i != null ? h('a', { href: '#/d/' + S.meta.decisions[i].id }, `${y} г. № ${n}`) : `${y} г. № ${n}`), h('td', {}, String(c))))))),
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
      $('#loading').hidden = true; setupControls(); route(); addEventListener('hashchange', route);
    } catch (e) {
      $('#loading').textContent = 'Не удалось загрузить данные: ' + e.message + '. Откройте страницу через веб-сервер (например, `python3 -m http.server` в папке lex).';
    }
  }
  main();
})();
