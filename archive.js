/* Корневая витрина корпуса: книжное оформление старого архива и данные lex/. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = text => Lex.esc(String(text ?? ''));
  const state = { year:'', q:'', topic:'', outcome:'', procedure:'', person:'', rows:[], shown:0 };
  const TEXTS = new Map();
  let meta, index, analytics, docs, byId, engine;

  const plural = (n, one, few, many) => {
    const mod100 = n % 100, mod10 = n % 10;
    if (mod100 > 10 && mod100 < 20) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  };
  const date = value => {
    if (!value) return 'дата не указана';
    const [year, month, day] = value.split('-').map(Number);
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    return `${day} ${months[month - 1]} ${year}`;
  };
  const count = selector => {
    const out = {};
    docs.forEach(doc => selector(doc).filter(Boolean).forEach(value => { out[value] = (out[value] || 0) + 1; }));
    return out;
  };
  const people = doc => [doc.presiding, doc.reporter, doc.prosecutor].filter(Boolean);
  const hasFilter = doc =>
    (!state.year || String(doc.vol) === state.year) &&
    (!state.topic || doc.topics.includes(state.topic)) &&
    (!state.outcome || doc.outcome === state.outcome) &&
    (!state.procedure || doc.procedure.includes(state.procedure)) &&
    (!state.person || people(doc).includes(state.person));
  const resetFilters = () => {
    Object.assign(state, {year:'', q:'', topic:'', outcome:'', procedure:'', person:''});
    $('#q').value = '';
    ['topic','outcome','procedure','person'].forEach(key => { $(`#f-${key}`).value = ''; });
  };

  async function loadJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
  }
  async function textOf(doc) {
    if (!TEXTS.has(doc.vol)) TEXTS.set(doc.vol, loadJSON(`lex/data/text-${doc.vol}.json`));
    const first = docs.find(candidate => candidate.vol === doc.vol);
    return (await TEXTS.get(doc.vol))[doc.i - first.i] || '';
  }

  function buildShelf() {
    const volumes = meta.volumes.slice().sort((a, b) => a.year - b.year);
    const years = volumes.map(volume => volume.year);
    $('#corpus-years').textContent = `доступный корпусъ: ${years.join(', ')} годы`;
    $('#corpus-imprint').textContent = `${volumes.length} ${plural(volumes.length, 'томъ', 'тома', 'томов')} · ${docs.length} ${plural(docs.length, 'решение', 'решения', 'решений')} · оригинальная орѳографія`;
    $('#corpus-scope').textContent = `В корпусе доступны тома: ${years.join(', ')}`;
    const max = Math.max(...volumes.map(v => v.decisions));
    const shelf = $('#shelf'), labels = $('#ylabels');
    shelf.replaceChildren(); labels.replaceChildren();
    volumes.forEach(volume => {
      const spine = document.createElement('button');
      spine.className = 'spine'; spine.type = 'button'; spine.dataset.year = volume.year;
      spine.style.height = `${Math.max(16, volume.decisions / max * 100)}%`;
      spine.title = `${volume.year}: ${volume.decisions} ${plural(volume.decisions, 'решение', 'решения', 'решений')}`;
      spine.setAttribute('aria-label', spine.title);
      spine.addEventListener('click', () => { location.hash = `#/y/${volume.year}`; });
      shelf.append(spine);
      const label = document.createElement('div'); label.className = 'ylab';
      const text = document.createElement('span'); text.textContent = volume.year;
      label.append(text); labels.append(label);
    });
  }

  function fill(id, values) {
    const select = $(`#${id}`);
    Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).forEach(([value, n]) => {
      const option = document.createElement('option'); option.value = value;
      option.textContent = `${value} (${n})`; select.append(option);
    });
  }
  function buildFilters() {
    fill('f-topic', count(doc => doc.topics));
    fill('f-outcome', count(doc => doc.outcome ? [doc.outcome] : []));
    fill('f-procedure', count(doc => doc.procedure));
    fill('f-person', count(people));
    ['topic','outcome','procedure','person'].forEach(key => {
      $(`#f-${key}`).addEventListener('change', event => {
        state[key] = event.target.value;
        location.hash = '#/'; renderList();
      });
    });
  }

  function widget(title, values, key, top = 10) {
    const rows = Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).slice(0, top);
    const box = document.createElement('section'); box.className = 'widget';
    box.innerHTML = `<h3>${esc(title)}</h3>`;
    rows.forEach(([value, n]) => {
      const item = document.createElement('button'); item.className = 'witem'; item.type = 'button'; item.dataset.key = key; item.dataset.value = value;
      item.innerHTML = `<span class="wl">${esc(value)}</span><span class="wn">${n}</span>`;
      item.addEventListener('click', () => { state[key] = state[key] === value ? '' : value; $(`#f-${key}`).value = state[key]; location.hash = '#/'; renderList(); });
      box.append(item);
    });
    return box;
  }
  function buildSide() {
    const years = meta.volumes.map(v => v.year).sort((a, b) => a - b);
    const side = $('#side'); side.replaceChildren();
    const total = document.createElement('section'); total.className = 'widget';
    total.innerHTML = `<h3>Корпусъ</h3><div class="wtot"><div><b>${docs.length}</b>решений</div><div><b>${years.length}</b>тома</div><div><b>${years.join(' · ')}</b>годы</div><div><b>${analytics.total_words.toLocaleString('ru-RU')}</b>словъ</div></div>`;
    const reset = document.createElement('button'); reset.className = 'wreset'; reset.type = 'button'; reset.textContent = 'Сбросить фильтры ×';
    reset.addEventListener('click', () => { resetFilters(); location.hash = '#/'; renderList(); }); total.append(reset); side.append(total);
    side.append(widget('Темы', count(doc => doc.topics), 'topic', 12));
    side.append(widget('Исходъ кассаціи', count(doc => doc.outcome ? [doc.outcome] : []), 'outcome', 8));
    side.append(widget('Фокусъ разсужденія', count(doc => doc.procedure), 'procedure', 8));
    side.append(widget('Сенаторы', count(people), 'person', 8));
  }
  function updateSide() {
    document.querySelectorAll('.witem').forEach(button => button.classList.toggle('on', state[button.dataset.key] === button.dataset.value));
    const active = state.year || state.q || state.topic || state.outcome || state.procedure || state.person;
    $('.wreset').classList.toggle('show', Boolean(active));
  }

  function renderChunk() {
    const target = $('#results');
    const queryStems = state.q ? Lex.stems(state.q) : [];
    state.rows.slice(state.shown, state.shown + 30).forEach(doc => {
      const row = document.createElement('article'); row.className = 'dec';
      const labels = [
        ...doc.topics.map(value => `<span class="chip">${esc(value)}</span>`),
        ...doc.procedure.map(value => `<span class="chip act">${esc(value)}</span>`),
        doc.outcome ? `<span class="chip out">${esc(doc.outcome)}</span>` : ''
      ].join('');
      row.innerHTML = `<div class="no">№ <b>${doc.num}</b> · ${esc(date(doc.date))} · ${doc.vol}</div>
        <h2 class="hn"><a href="#/d/${encodeURIComponent(doc.id)}">${esc(doc.headnote)}</a></h2>
        <div>${labels}</div><div class="meta">${esc(doc.dept)} · том ${doc.vol}</div>`;
      if (queryStems.length) {
        const heading = row.querySelector('.hn a');
        const source = doc.headnote; const words = Lex.tokens(source);
        if (words.some(word => queryStems.includes(Lex.stem(word)))) heading.title = 'Совпадение найдено в рубрике или тексте решения';
      }
      target.append(row);
    });
    state.shown = Math.min(state.rows.length, state.shown + 30);
    $('#more').classList.toggle('show', state.shown < state.rows.length);
    $('#more').textContent = `Показать ещё (${state.rows.length - state.shown})`;
  }
  function renderList() {
    document.querySelectorAll('.spine').forEach(spine => spine.classList.toggle('active', spine.dataset.year === state.year));
    let rows, expanded = [];
    if (state.q) {
      const result = engine.search(state.q, {filter: hasFilter});
      rows = result.hits.map(hit => docs[hit.i]); expanded = result.query.expanded;
    } else rows = docs.filter(hasFilter).slice().sort((a, b) => a.vol - b.vol || a.num - b.num);
    state.rows = rows; state.shown = 0; $('#results').replaceChildren(); renderChunk(); updateSide();
    const selections = [state.topic, state.outcome, state.procedure, state.person].filter(Boolean);
    let label = state.q ? `Поискъ: «${state.q}»` : (state.year ? `${state.year} годъ` : (selections.join(' · ') || 'Полная лента корпуса'));
    if (expanded.length) label += ` · также: ${expanded.join(', ')}`;
    $('#status').textContent = `${label} — ${rows.length} ${plural(rows.length, 'решение', 'решения', 'решений')}`;
  }

  function show(view) {
    $('#reader').classList.toggle('open', view === 'reader');
    $('#stats').classList.toggle('open', view === 'stats');
    $('#list').classList.toggle('hidden', view !== 'list');
    $('#navlist').classList.toggle('on', view === 'list');
    $('#navstats').classList.toggle('on', view === 'stats');
  }
  async function openDecision(id) {
    const doc = byId.get(id); if (!doc) { location.hash = '#/'; return; }
    show('reader'); $('#rno').textContent = `№ ${doc.num} · ${date(doc.date)}`;
    $('#rsrc').textContent = `${doc.dept} · том ${doc.vol}`;
    const facts = [doc.outcome, ...doc.topics].filter(Boolean).join(' · ');
    $('#rflags').textContent = `Оригинальная орфография. ${facts ? `${facts}. ` : ''}Текст получен автоматическим распознаванием: числа, статьи и имена сверяйте со сканом.`;
    $('#rtext').textContent = 'Загрузка текста…';
    const tools = $('#reader-tools'); tools.innerHTML = `<a class="reader-link" href="lex/#/d/${encodeURIComponent(doc.id)}">Карточка, пассажи и сканы</a><a class="reader-link" href="lex/#/sense?q=${encodeURIComponent(doc.topics[0] || doc.headnote)}">Искать по смыслу</a>`;
    try { $('#rtext').textContent = await textOf(doc); } catch (error) { $('#rtext').textContent = `Не удалось загрузить текст решения: ${error.message}`; }
    window.scrollTo(0, 0);
  }
  function bars(values, total, key) {
    const max = Math.max(...Object.values(values), 1);
    return Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([value, n]) =>
      `<button class="brow clickable" data-key="${esc(key)}" data-value="${esc(value)}"><span class="lbl">${esc(value)}</span><span class="bar" style="width:${Math.round(n / max * 440)}px"></span><span class="n">${n}${total ? ` (${(n / total * 100).toFixed(1)}%)` : ''}</span></button>`).join('');
  }
  function renderStats() {
    const years = meta.volumes.map(v => v.year).sort((a, b) => a - b);
    const topics = count(doc => doc.topics), outcomes = count(doc => doc.outcome ? [doc.outcome] : []), procedures = count(doc => doc.procedure);
    $('#stats').innerHTML = `<div class="tot-row"><div class="tot"><div class="v">${docs.length}</div><div class="l">решений</div></div><div class="tot"><div class="v">${years.length}</div><div class="l">тома</div></div><div class="tot"><div class="v">${years.join(' · ')}</div><div class="l">годы</div></div><div class="tot"><div class="v">${analytics.total_words.toLocaleString('ru-RU')}</div><div class="l">словъ</div></div></div><h2 class="stat-h">Темы</h2>${bars(topics, docs.length, 'topic')}<p class="stat-note">Темы и фокус кассационного рассуждения выделены автоматически и служат навигацией; выводы следует сверять с текстом решения.</p><h2 class="stat-h">Исходъ кассаціи</h2>${bars(outcomes, docs.length, 'outcome')}<h2 class="stat-h">Фокусъ разсужденія</h2>${bars(procedures, docs.length, 'procedure')}`;
    $('#stats').querySelectorAll('.brow').forEach(button => button.addEventListener('click', () => { resetFilters(); state[button.dataset.key] = button.dataset.value; $(`#f-${button.dataset.key}`).value = button.dataset.value; location.hash = '#/'; }));
  }
  function route() {
    const path = location.hash.replace(/^#\/?/, '');
    const decision = path.match(/^d\/([^?]+)/);
    const year = path.match(/^y\/(1897|1904|1905)$/);
    if (decision) { openDecision(decodeURIComponent(decision[1])); return; }
    if (path === 'stats') { show('stats'); renderStats(); return; }
    show('list');
    if (year) { resetFilters(); state.year = year[1]; }
    renderList();
  }
  async function boot() {
    try {
      [meta, index, analytics] = await Promise.all(['meta','index','analytics'].map(name => loadJSON(`lex/data/${name}.json`)));
      docs = meta.decisions; byId = new Map(docs.map(doc => [doc.id, doc])); engine = Lex.makeEngine(index, docs);
      buildShelf(); buildFilters(); buildSide(); route();
      window.addEventListener('hashchange', route);
      $('#go').addEventListener('click', () => { state.q = $('#q').value.trim(); location.hash = '#/'; renderList(); });
      $('#q').addEventListener('keydown', event => { if (event.key === 'Enter') $('#go').click(); });
      $('#more').addEventListener('click', renderChunk);
      $('#back').addEventListener('click', event => { event.preventDefault(); location.hash = '#/'; });
      $('#navlist').addEventListener('click', event => { event.preventDefault(); location.hash = '#/'; });
      $('#navstats').addEventListener('click', event => { event.preventDefault(); location.hash = '#/stats'; });
    } catch (error) {
      $('#status').textContent = `Не удалось загрузить корпус: ${error.message}`;
    }
  }
  boot();
})();
