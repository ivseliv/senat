/* Локальная рабочая подборка. Не отправляет данные в сеть. Смещения — Unicode code points. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SenatReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1, KEY = 'senat-reader-v1';
  const PUBLIC = 'https://ivseliv.github.io/senat/lex/';
  const YEARS = new Set([1896, 1897, 1904, 1905]);
  const LIMITS = Object.freeze({bytes: 4000000, items: 500, quotes: 100, totalQuotes: 2000,
    title: 200, note: 20000, headnote: 5000, quote: 30000, references: 100, url: 1500});
  const clone = value => JSON.parse(JSON.stringify(value));
  const count = value => Array.from(value).length;
  const now = () => new Date().toISOString();
  function fail(message, code) { const e = new Error(message); e.code = code || 'INVALID_DATA'; throw e; }
  function object(value, name, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(name + ': ожидался объект');
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(name + ': неизвестное поле ' + key);
    return value;
  }
  function string(value, name, max, fallback) {
    if (value == null && fallback !== undefined) return fallback;
    if (typeof value !== 'string' || count(value) > max || /\u0000/.test(value)) fail(name + ': недопустимый текст');
    // Одинокий суррогат не задаёт корректный Unicode-срез: такой импорт отклоняем.
    for (const c of value) if (c.length === 1 && /[\uD800-\uDFFF]/.test(c)) fail(name + ': повреждённый Unicode');
    return value;
  }
  function integer(value, name, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(name + ': недопустимое число');
    return value;
  }
  function timestamp(value, name) {
    string(value, name, 30);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail(name + ': недопустимая дата');
    return value;
  }
  function decisionId(value) {
    if (typeof value !== 'string' || !/^(1896|1897|1904|1905)-\d{3}$/.test(value)) fail('Недопустимый ID решения');
    return value;
  }
  function decisionURL(value, id) {
    string(value, 'url', LIMITS.url);
    if (/[\s\\\u0000-\u001F\u007F]/.test(value)) fail('Недопустимая ссылка решения');
    const hash = value.startsWith('#/') ? value : value.startsWith(PUBLIC + '#/') ? value.slice(PUBLIC.length) : null;
    if (!hash) fail('Ссылка должна вести в опубликованный корпус Сената');
    const m = hash.match(/^#\/d\/((?:1896|1897|1904|1905)-\d{3})(?:\?([^#]*))?$/);
    if (!m || m[1] !== id) fail('Ссылка ведёт к другому решению');
    if (m[2]) {
      const params = new URLSearchParams(m[2]);
      const names = ['mode', 'at', 'end', 'field', 'sha', 'p', 'q', 'law', 'ref', 'g', 'y', 'partial', 'orth'];
      for (const [key, val] of params) {
        if (!names.includes(key) || /[\u0000-\u001F\u007F]/.test(val)) fail('Недопустимый параметр ссылки');
        if (['at', 'end'].includes(key) && !/^\d{1,8}$/.test(val)) fail('Недопустимое смещение в ссылке');
        if (key === 'field' && !['text', 'headnote'].includes(val)) fail('Недопустимое поле ссылки');
        if (key === 'sha' && !/^[a-f0-9]{64}$/.test(val)) fail('Недопустимый SHA ссылки');
      }
    }
    return value;
  }
  function scanURL(value) {
    string(value, 'scan URL', LIMITS.url);
    const path = value.startsWith(PUBLIC) ? value.slice(PUBLIC.length) : value;
    if (!/^scans\/(1896|1897|1904|1905)\/(pages|fragments)\/[A-Za-z0-9_-]+\.webp$/.test(path)) fail('Недопустимая ссылка скана');
    return value;
  }
  function page(value) { return value == null ? null : integer(value, 'page', 1, 100000); }
  function refs(value, name, parse) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > LIMITS.references) fail(name + ': слишком много ссылок');
    return value.map(parse);
  }
  function source(value) {
    object(value, 'source', ['file', 'page', 'page_method', 'start', 'end']);
    const file = string(value.file, 'source.file', 100);
    if (!/^[A-Za-z0-9_-]+\.txt$/.test(file)) fail('Недопустимое имя листа OCR');
    const out = {file, page: page(value.page)};
    if (value.page_method != null) out.page_method = string(value.page_method, 'page_method', 80);
    out.start = integer(value.start, 'source.start', 0, 10000000);
    out.end = integer(value.end, 'source.end', out.start + 1, 10000000);
    return out;
  }
  function scan(value) {
    object(value, 'scan', ['file', 'page', 'full', 'kind', 'image', 'width', 'height', 'box', 'coverage']);
    const file = string(value.file, 'scan.file', 100);
    if (!/^[A-Za-z0-9_-]+\.txt$/.test(file)) fail('Недопустимое имя листа скана');
    if (!['page', 'fragment'].includes(value.kind)) fail('Недопустимый вид скана');
    const out = {file, page: page(value.page), full: scanURL(value.full), kind: value.kind,
      image: scanURL(value.image || value.full), width: integer(value.width, 'width', 1, 50000),
      height: integer(value.height, 'height', 1, 50000)};
    if (value.box != null) {
      if (!Array.isArray(value.box) || value.box.length !== 4 || value.box.some(x => !Number.isFinite(x) || x < 0 || x > 1) ||
          value.box[0] >= value.box[2] || value.box[1] >= value.box[3]) fail('Недопустимые координаты скана');
      out.box = value.box.slice();
    }
    if (value.coverage != null) {
      if (!Number.isFinite(value.coverage) || value.coverage < 0 || value.coverage > 1) fail('Недопустимое покрытие скана');
      out.coverage = value.coverage;
    }
    return out;
  }
  function decision(value) {
    object(value, 'decision', ['id', 'year', 'number', 'department', 'date_label', 'headnote', 'url', 'source_sha256', 'printed_pages', 'scans', 'source_warning']);
    const id = decisionId(value.id), year = integer(value.year, 'year', 1896, 1905);
    if (!YEARS.has(year) || String(year) !== id.slice(0, 4)) fail('Год не согласован с ID решения');
    const number = integer(value.number, 'number', 1, 999);
    if (number !== Number(id.slice(5))) fail('Номер не согласован с ID решения');
    if (value.source_sha256 && !/^[a-f0-9]{64}$/.test(value.source_sha256)) fail('Недопустимый SHA решения');
    return {id, year, number, department: string(value.department, 'department', 150, ''),
      date_label: string(value.date_label, 'date_label', 200, ''),
      headnote: string(value.headnote, 'headnote', LIMITS.headnote, ''),
      url: decisionURL(value.url || '#/d/' + id, id),
      source_sha256: value.source_sha256 == null ? '' : string(value.source_sha256, 'decision SHA', 64),
      printed_pages: [...new Set(refs(value.printed_pages, 'decision pages', x=>integer(x,'page',1,100000)))],
      scans: refs(value.scans, 'decision scans', scan), source_warning:string(value.source_warning,'source_warning',LIMITS.note,'')};
  }
  function quoteId(q) { return q.field + ':' + q.start + '-' + q.end + ':' + q.source_sha256.slice(0, 16); }
  function quote(value, id, requireId) {
    object(value, 'quote', ['id', 'field', 'start', 'end', 'text_original', 'source_sha256', 'printed_pages', 'sources', 'scans', 'url', 'note', 'source_warning']);
    if (!['text', 'headnote'].includes(value.field)) fail('Цитировать можно исходный текст или заголовок');
    const start = integer(value.start, 'start', 0, 10000000), end = integer(value.end, 'end', start + 1, 10000000);
    const text = string(value.text_original, 'text_original', LIMITS.quote);
    if (count(text) !== end - start || !text.trim()) fail('Смещения Unicode не согласованы с длиной цитаты');
    if (typeof value.source_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.source_sha256)) fail('Для цитаты нужен SHA-256 исходного поля');
    const pages = refs(value.printed_pages, 'printed_pages', x => integer(x, 'printed_page', 1, 100000));
    if (new Set(pages).size !== pages.length) fail('Повтор печатной страницы');
    const out = {field: value.field, start, end, text_original: text, source_sha256: value.source_sha256,
      printed_pages: pages, sources: refs(value.sources, 'sources', source), scans: refs(value.scans, 'scans', scan),
      url: decisionURL(value.url || '#/d/' + id + '?mode=quote&at=' + start + '&end=' + end + '&field=' + value.field + '&sha=' + value.source_sha256, id),
      note: string(value.note, 'quote.note', LIMITS.note, ''), source_warning:string(value.source_warning,'source_warning',LIMITS.note,'')};
    out.id = quoteId(out);
    if ((requireId || value.id != null) && value.id !== out.id) fail('ID цитаты не согласован с её источником');
    const p = new URLSearchParams(out.url.split('?')[1] || '');
    if (p.get('mode') !== 'quote' || Number(p.get('at')) !== start || Number(p.get('end')) !== end ||
        p.get('field') !== out.field || p.get('sha') !== out.source_sha256) fail('Ссылка цитаты не согласована с источником и смещениями');
    return out;
  }
  function item(value) {
    object(value, 'item', ['id', 'decision', 'note', 'quotes', 'saved_at', 'updated_at']);
    const d = decision(value.decision);
    if (value.id !== d.id) fail('ID записи не согласован с решением');
    if (!Array.isArray(value.quotes) || value.quotes.length > LIMITS.quotes) fail('Слишком много цитат в решении');
    const quotes = value.quotes.map(q => quote(q, d.id, true));
    if (new Set(quotes.map(q => q.id)).size !== quotes.length) fail('Повтор ID цитаты');
    return {id: d.id, decision: d, note: string(value.note, 'item.note', LIMITS.note, ''), quotes,
      saved_at: timestamp(value.saved_at, 'saved_at'), updated_at: timestamp(value.updated_at, 'updated_at')};
  }
  function serialized(value) {
    let raw;
    try { raw = JSON.stringify(value); } catch (_) { fail('Подборку нельзя прочитать как JSON'); }
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > LIMITS.bytes) fail('Файл подборки слишком большой');
    return raw;
  }
  function validate(data) {
    if (typeof data === 'string') {
      if (new TextEncoder().encode(data).length > LIMITS.bytes) fail('Файл подборки слишком большой');
      try { data = JSON.parse(data); } catch (_) { fail('Повреждённый JSON'); }
    }
    serialized(data);
    object(data, 'collection', ['schema_version', 'offset_unit', 'title', 'note', 'items', 'revision']);
    if (data.schema_version !== VERSION) fail('Версия подборки не поддерживается', 'UNSUPPORTED_VERSION');
    if (data.offset_unit != null && data.offset_unit !== 'unicode_code_points') fail('Неизвестные единицы смещений');
    if (!Array.isArray(data.items) || data.items.length > LIMITS.items) fail('Слишком много решений');
    const items = data.items.map(item);
    if (new Set(items.map(x => x.id)).size !== items.length) fail('Повтор решения');
    if (items.reduce((n, x) => n + x.quotes.length, 0) > LIMITS.totalQuotes) fail('Слишком много цитат');
    return {schema_version: VERSION, offset_unit:'unicode_code_points', title: string(data.title, 'title', LIMITS.title, ''),
      note: string(data.note, 'note', LIMITS.note, ''), items, revision: integer(data.revision, 'revision', 0, Number.MAX_SAFE_INTEGER)};
  }
  function empty() { return {schema_version: VERSION, offset_unit:'unicode_code_points', title: 'Моя подборка', note: '', items: [], revision: 0}; }
  function mergeNote(old, incoming) {
    if (!incoming || incoming === old || old.includes(incoming)) return old;
    if (!old || incoming.includes(old)) return incoming;
    const combined = old + '\n\n—— Импортированная заметка ——\n\n' + incoming;
    if (count(combined) > LIMITS.note) fail('Объединённая заметка превышает допустимый размер');
    return combined;
  }
  function mergeState(current, incoming) {
    const out = clone(current);
    // Текущее название сохраняем; другое импортированное название добавляем в общую заметку.
    if ((!out.title || out.title === 'Моя подборка') && incoming.title) out.title = incoming.title;
    else if (incoming.title && incoming.title !== out.title && incoming.title !== 'Моя подборка')
      out.note = mergeNote(out.note, 'Название импортированной подборки: ' + incoming.title);
    out.note = mergeNote(out.note, incoming.note);
    for (const add of incoming.items) {
      const old = out.items.find(x => x.id === add.id);
      if (!old) { out.items.push(clone(add)); continue; }
      old.note = mergeNote(old.note, add.note);
      for (const q of add.quotes) {
        const found = old.quotes.find(x => x.id === q.id);
        if (!found) old.quotes.push(clone(q));
        else {
          if (found.text_original !== q.text_original) fail('Одинаковый ID цитаты имеет разный текст');
          found.note = mergeNote(found.note, q.note);
        }
      }
      old.saved_at = old.saved_at < add.saved_at ? old.saved_at : add.saved_at;
      old.updated_at = old.updated_at > add.updated_at ? old.updated_at : add.updated_at;
    }
    return validate(out);
  }
  function createStore(options) {
    options = options || {};
    const storage = options.storage, key = options.key || KEY, listeners = new Set();
    let state = empty(), pending = [], blocked = false, persistent = true, lastError = null;
    function report(err, code) {
      lastError = {code: code || err.code || 'STORAGE_ERROR', message: String(err.message || err)};
      if (typeof options.onError === 'function') { try { options.onError(clone(lastError)); } catch (_) { /* Ошибка интерфейса не нарушает сохранение. */ } }
    }
    function read() {
      if (!storage || typeof storage.getItem !== 'function') { persistent = false; return null; }
      let raw;
      try { raw = storage.getItem(key); }
      catch (e) { persistent = false; report(e, 'STORAGE_READ'); return null; }
      if (raw == null) return empty();
      try { return validate(raw); }
      catch (e) { blocked = true; persistent = false; report(e, 'STORAGE_INVALID'); return null; }
    }
    const initial = read();
    if (initial) state = initial;
    function notify() { const snapshot = clone(state); for (const fn of listeners) { try { fn(clone(snapshot)); } catch (_) { /* Ошибка одного обработчика не прерывает остальные. */ } } }
    function persist() {
      if (blocked) return false;
      if (!storage || typeof storage.setItem !== 'function') { persistent = false; report(new Error('Хранилище браузера недоступно'), 'STORAGE_WRITE'); return false; }
      try { storage.setItem(key, serialized(state)); persistent = true; pending = []; lastError = null; return true; }
      catch (e) { persistent = false; report(e, 'STORAGE_WRITE'); return false; }
    }
    function mutate(op) {
      let fresh = blocked ? null : read();
      let base = fresh || clone(state);
      // После отказа записи храним операции и применяем их к свежим данным другой вкладки.
      if (fresh) for (const apply of pending) base = apply(base);
      const next = op(base);
      next.revision = Math.max(base.revision, state.revision) + 1;
      state = validate(next);
      pending.push(op);
      persist(); notify();
      return clone(state);
    }
    function changeItem(id, fn) {
      decisionId(id);
      return mutate(s => { const out = clone(s), found = out.items.find(x => x.id === id); if (!found) fail('Решение не сохранено'); fn(found); found.updated_at = now(); return out; });
    }
    return {
      key,
      getState: () => clone(state),
      getStatus: () => ({persistent, blocked, error: lastError && clone(lastError)}),
      subscribe(fn) { if (typeof fn !== 'function') fail('Ожидался обработчик'); listeners.add(fn); return () => listeners.delete(fn); },
      sync() {
        if (blocked) return clone(state);
        const fresh = read();
        if (fresh) {
          let merged = fresh;
          for (const apply of pending) merged = apply(merged);
          state = validate(merged); notify();
        }
        return clone(state);
      },
      flush() { return mutate(s => clone(s)); },
      recoverStorage() { blocked = false; pending = []; if (!persist()) return false; notify(); return true; },
      setTitle(value) { const title = string(value, 'title', LIMITS.title); return mutate(s => Object.assign(clone(s), {title})); },
      setNote(value) { const note = string(value, 'note', LIMITS.note); return mutate(s => Object.assign(clone(s), {note})); },
      saveDecision(snapshot) {
        const d = decision(snapshot);
        return mutate(s => { const out = clone(s); if (!out.items.some(x => x.id === d.id)) { const date = now(); out.items.push({id: d.id, decision: d, note: '', quotes: [], saved_at: date, updated_at: date}); } return out; });
      },
      addQuote(snapshot, value) {
        const d = decision(snapshot), q = quote(value, d.id, false);
        return mutate(s => { const out = clone(s); let found = out.items.find(x => x.id === d.id); if (!found) { const date = now(); found = {id: d.id, decision: d, note: '', quotes: [], saved_at: date, updated_at: date}; out.items.push(found); }
          const existing = found.quotes.find(x => x.id === q.id);
          if (!existing) found.quotes.push(q); else { if (existing.text_original !== q.text_original) fail('Источник цитаты изменился'); existing.note = mergeNote(existing.note, q.note); }
          found.updated_at = now(); return out; });
      },
      updateItem(id, patch) {
        object(patch, 'patch', ['note']); const note = string(patch.note, 'note', LIMITS.note);
        return changeItem(id, item => { item.note = note; });
      },
      updateQuote(id, qid, patch) {
        object(patch, 'patch', ['note']); const note = string(patch.note, 'note', LIMITS.note);
        return changeItem(id, item => { const q = item.quotes.find(x => x.id === qid); if (!q) fail('Цитата не найдена'); q.note = note; });
      },
      removeItem(id) { decisionId(id); return mutate(s => Object.assign(clone(s), {items: s.items.filter(x => x.id !== id)})); },
      removeQuote(id, qid) { return changeItem(id, item => { item.quotes = item.quotes.filter(x => x.id !== qid); }); },
      importJSON(data, opts) {
        const imported = validate(data);
        if (opts && opts.merge === false) fail('Импорт заменой отключён: существующие заметки сохраняются');
        return mutate(s => mergeState(s, imported));
      },
      exportJSON() { return JSON.stringify(state, null, 2); }
    };
  }
  return Object.freeze({createStore, validate, LIMITS, VERSION, KEY, PUBLIC, count, decisionURL, scanURL});
});
