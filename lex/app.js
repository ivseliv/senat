/* Интерфейс: поиск по решениям Сената и аналитика. Зависит от lex.js (Lex). */
(function () {
  'use strict';
  const L = window.Lex;
  const $ = (s, r) => (r || document).querySelector(s);
  const DATA = window.LEX_DATA_URL || 'data/';
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  const S = {
    meta: null, index: null, an: null, engine: null, texts: {}, stemCache: new Map(),
    opts: { modern: true, gloss: true },
    f: { q: '', year: '', outcome: '', topic: '', statute: '', person: '', sort: 'rel' }, shown: 20, hits: [], sentinel: 0,
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
  const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const CODE = () => S.an.codes;
  const statLabel = s => { const [code, ...rest] = s.split(' '); return (CODE()[code] ? CODE()[code] + ',' : 'Иной акт,') + ' ' + rest.join(' '); };
  const deptShort = d => d.replace(' департамент', '').replace('Гражданский кассационный', 'Гражд. касс. деп.');

  async function loadJSON(name) { if (window.LEX_INLINE && window.LEX_INLINE[name]) return window.LEX_INLINE[name]; const r = await fetch(DATA + name); if (!r.ok) throw new Error(name + ': ' + r.status); return r.json(); }
  async function loadVol(y) { if (!S.texts[y]) S.texts[y] = loadJSON(`text-${y}.json`); return S.texts[y]; }
  async function textOf(d) { return (await loadVol(d.vol))[localIndex(d)]; }
  function localIndex(d) { return d.i - S.volStart[d.vol]; }
  async function stemsOf(d) {
    if (!S.stemCache.has(d.i)) S.stemCache.set(d.i, L.stems(d.headnote + '\n' + await textOf(d)));
    return S.stemCache.get(d.i);
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
    const tab = path.startsWith('d/') ? 'search' : (path.split('/')[0] || 'search');
    for (const t of ['search', 'analytics', 'about']) {
      $('#view-' + t).hidden = t !== tab;
      $('#tab-' + t).setAttribute('aria-current', t === tab ? 'page' : 'false');
    }
    if (tab === 'search') {
      Object.assign(S.f, { q: p.get('q') || '', year: p.get('y') || '', outcome: p.get('o') || '', topic: p.get('t') || '',
        statute: p.get('s') || '', person: p.get('p') || '', sort: p.get('sort') || 'rel' });
      syncControls(); runSearch();
      if (path.startsWith('d/')) openDetail(path.slice(2)); else closeDetail();
    } else closeDetail();
    if (tab === 'analytics') renderAnalytics();
    window.scrollTo(0, path.startsWith('d/') ? window.scrollY : 0);
  }
  function pushSearch() {
    const f = S.f; go('search', { q: f.q, y: f.year, o: f.outcome, t: f.topic, s: f.statute, p: f.person, sort: f.sort === 'rel' ? '' : f.sort });
  }

  /* ---------------------------------------------------------------- поиск */
  function filterFn() {
    const f = S.f;
    return d => (!f.year || String(d.vol) === f.year) && (!f.outcome || d.outcome === f.outcome) && (!f.topic || d.topics.includes(f.topic)) &&
      (!f.statute || f.statute in d.statutes) && (!f.person || d.presiding === f.person || d.reporter === f.person || d.prosecutor === f.person);
  }
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
        h('div', { class: 'card-top' }, h('span', { class: 'num' }, `№ ${d.num}`), h('span', { class: 'muted' }, `${fmtDate(d.date)} · ${deptShort(d.dept)}, том ${d.vol}`),
          h('span', { class: 'badge' }, d.outcome)),
        h('h3', {}, h('a', { href: '#/d/' + d.id, onclick: e => { e.preventDefault(); openFromList(d.id); } }, M(d.headnote))),
        h('p', { class: 'snip', 'data-i': d.i }, ''),
        h('div', { class: 'chips' }, d.topics.map(t => h('button', { class: 'chip', onclick: () => { S.f.topic = t; pushSearch(); } }, t))));
      card.addEventListener('click', e => { if (!e.target.closest('button,a')) openFromList(d.id); });
      card.addEventListener('keydown', e => { if (e.key === 'Enter') openFromList(d.id); });
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
    }
  }
  const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
  function openFromList(id) { const { p } = readHash(); location.hash = '#/d/' + id + (p.toString() ? '?' + p.toString() : ''); }

  /* ---------------------------------------------------------------- карточка решения */
  async function openDetail(id) {
    const d = S.meta.decisions.find(x => x.id === id); const box = $('#detail-body');
    if (!d) { box.replaceChildren(h('p', {}, 'Решение не найдено')); $('#detail').hidden = false; return; }
    $('#detail').hidden = false; document.body.classList.add('modal');
    const text = await textOf(d); const modernText = () => S.opts.modern;
    const cited = S.meta.decisions.filter(x => x.cites.some(c => c[0] === d.vol && c[1] === d.num));
    const inCorpus = ([y, n]) => S.meta.decisions.find(x => x.vol === y && x.num === n);
    const qs = queryStems();
    const paint = t => {
      const html = M(t).split(/\n\n+/).map(par => '<p>' + (qs.length ? highlight(par, qs) : L.esc(par)) + '</p>').join('');
      return html;
    };
    const cite = `Решение ${d.dept === 'Общее собрание' ? 'Общего собрания' : d.dept.replace('кий', 'кого').replace('ый', 'ого')} Правительствующего Сената ${d.vol} г. № ${d.num}`;
    const body = h('div', { class: 'text', html: paint(text) });
    box.replaceChildren(
      h('div', { class: 'detail-head' },
        h('h2', {}, `№ ${d.num} · ${fmtDate(d.date)}`),
        h('div', { class: 'muted' }, `${d.dept}, том ${d.vol}`),
        h('span', { class: 'badge big' }, d.outcome)),
      h('p', { class: 'headnote' }, M(d.headnote)),
      h('dl', { class: 'meta' },
        d.presiding ? h('div', {}, h('dt', {}, 'Председательствовал'), h('dd', {}, personLink(d.presiding))) : '',
        d.reporter ? h('div', {}, h('dt', {}, 'Докладывал'), h('dd', {}, personLink(d.reporter))) : '',
        d.prosecutor ? h('div', {}, h('dt', {}, 'Заключение давал'), h('dd', {}, personLink(d.prosecutor))) : ''),
      h('div', { class: 'chips' }, d.topics.map(t => h('button', { class: 'chip', onclick: () => { S.f.topic = t; go('search', { t }); } }, t))),
      Object.keys(d.statutes).length ? h('section', {}, h('h3', {}, 'Упомянутые статьи'), h('div', { class: 'chips' },
        Object.keys(d.statutes).sort().map(s => h('button', { class: 'chip stat', title: 'Найти все решения с этой статьёй', onclick: () => go('search', { s }) }, statLabel(s))))) : '',
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', onclick: () => { S.opts.modern = !S.opts.modern; $('#modern').checked = S.opts.modern; body.innerHTML = paint(text); } }, 'Оригинал ⇄ современная орфография'),
        h('button', { class: 'btn', onclick: e => { navigator.clipboard && navigator.clipboard.writeText(cite + '\n' + location.href); e.target.textContent = 'Скопировано ✓'; setTimeout(() => e.target.textContent = 'Скопировать ссылку и цитату', 1500); } }, 'Скопировать ссылку и цитату')),
      body,
      h('p', { class: 'muted small' }, 'Текст получен автоматическим распознаванием скана (модель ИИ) и может содержать ошибки: числа, номера статей и фамилии сверяйте с изданием. Современная орфография — автоматическая, для удобства чтения.'),
      d.cites.length ? h('section', {}, h('h3', {}, 'Ссылается на решения'), h('ul', {}, d.cites.map(c => { const t = inCorpus(c); return h('li', {}, t ? h('a', { href: '#/d/' + t.id }, `${c[0]} г. № ${c[1]} — ${M(t.headnote).slice(0, 90)}…`) : `${c[0]} г. № ${c[1]} (нет в корпусе)`); }))) : '',
      cited.length ? h('section', {}, h('h3', {}, 'Цитируется в'), h('ul', {}, cited.map(x => h('li', {}, h('a', { href: '#/d/' + x.id }, `${x.vol} г. № ${x.num} — ${M(x.headnote).slice(0, 90)}…`))))) : '',
      d.similar.length ? h('section', {}, h('h3', {}, 'Похожие решения'), h('ul', {}, d.similar.map(([j, sc]) => { const x = S.meta.decisions[j]; return h('li', {}, h('a', { href: '#/d/' + x.id }, `${x.vol} г. № ${x.num} — ${M(x.headnote).slice(0, 100)}…`), h('span', { class: 'muted' }, ` (сходство ${Math.round(sc * 100)}%)`)); }))) : '');
    $('#detail').scrollTop = 0;
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
    $('#f-statute').value = S.f.statute; $('#f-person').value = S.f.person; $('#f-sort').value = S.f.sort;
    const act = ['year', 'outcome', 'topic', 'statute', 'person'].filter(k => S.f[k]).length + (S.f.sort !== 'rel' ? 1 : 0);
    $('#fcount').textContent = act ? `· выбрано: ${act}` : '';
    const box = $('#fbox'); if (!box.dataset.init || act) { box.open = act > 0 || innerWidth >= 700; box.dataset.init = '1'; }
  }
  function setupControls() {
    const dec = S.meta.decisions, an = S.an;
    fillSelect($('#f-year'), S.meta.volumes.map(v => [String(v.year), String(v.year)]), 'Все годы');
    fillSelect($('#f-outcome'), Object.entries(an.outcomes).map(([k, n]) => [k, `${k} (${n})`]), 'Любой исход');
    fillSelect($('#f-topic'), Object.entries(an.topics).map(([k, n]) => [k, `${k} (${n})`]), 'Любая тема');
    const stat = {}; dec.forEach(d => Object.keys(d.statutes).forEach(s => stat[s] = (stat[s] || 0) + 1));
    fillSelect($('#f-statute'), Object.entries(stat).filter(([s]) => !s.startsWith('?')).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 250).map(([s, n]) => [s, `${statLabel(s)} (${n})`]), 'Любая статья');
    const per = {}; dec.forEach(d => [d.presiding, d.reporter, d.prosecutor].forEach(p => p && (per[p] = (per[p] || 0) + 1)));
    fillSelect($('#f-person'), Object.entries(per).sort((a, b) => a[0].localeCompare(b[0])).map(([p, n]) => [p, `${p} (${n})`]), 'Любой сенатор / прокурор');
    $('#form').addEventListener('submit', e => { e.preventDefault(); S.f.q = $('#q').value; pushSearchOrRun(); });
    for (const [id, key] of [['f-year', 'year'], ['f-outcome', 'outcome'], ['f-topic', 'topic'], ['f-statute', 'statute'], ['f-person', 'person'], ['f-sort', 'sort']])
      $('#' + id).addEventListener('change', e => { S.f[key] = e.target.value; S.f.q = $('#q').value; pushSearchOrRun(); });
    $('#modern').addEventListener('change', e => { S.opts.modern = e.target.checked; renderResults(++runToken); });
    $('#gloss').addEventListener('change', e => { S.opts.gloss = e.target.checked; runSearch(); });
    $('#more').addEventListener('click', () => { S.shown += 20; renderResults(++runToken); });
    $('#reset').addEventListener('click', () => go('search'));
    $('#detail-close').addEventListener('click', () => { const { p } = readHash(); location.hash = '#/search' + (p.toString() ? '?' + p.toString() : ''); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#detail').hidden) $('#detail-close').click(); });
    $('#examples').append(...['исполнитель завещания', 'ущерб от пожара', 'давность', 'арендатор', 'банкротство', '"железной дороги" вред', 'вексель протест']
      .map(x => h('button', { class: 'chip', onclick: () => go('search', { q: x }) }, x)));
    $('#theme').addEventListener('click', () => { const r = document.documentElement; const dark = r.dataset.theme === 'dark' || (!r.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); r.dataset.theme = dark ? 'light' : 'dark'; });
  }
  function pushSearchOrRun() { const { path } = readHash(); if (path.startsWith('d/')) { closeDetail(); } pushSearch(); if (!location.hash.startsWith('#/search')) return; runSearch(); }

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
        card('О чём решения', 'Тема определяется по ключевым словам в заголовке и тексте; у решения может быть до трёх тем. Нажмите строку, чтобы открыть решения.', bars(Object.entries(an.topics), { click: r => go('search', { t: r[0] }) })),
        card('Самые часто упоминаемые статьи', 'Число решений, где статья названа. Кодекс определён автоматически там, где он указан рядом со статьёй. Нажмите, чтобы найти решения.',
          bars(an.statutes.slice(0, 15), { label: r => statLabel(r[0]), click: r => go('search', { s: r[0] }) })),
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
      meta.decisions.forEach(d => { if (S.volStart[d.vol] == null) S.volStart[d.vol] = d.i; });
      S.engine = L.makeEngine(index, meta.decisions);
      $('#loading').hidden = true; setupControls(); route(); addEventListener('hashchange', route);
    } catch (e) {
      $('#loading').textContent = 'Не удалось загрузить данные: ' + e.message + '. Откройте страницу через веб-сервер (например, `python3 -m http.server` в папке lex).';
    }
  }
  main();
})();
