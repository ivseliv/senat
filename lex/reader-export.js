/* Читательская подборка: автономный экспорт без сети и сторонних библиотек. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SenatReaderExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PUBLIC = 'https://ivseliv.github.io/senat/lex/';
  const ID = /^(?:\d{4}|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)-\d{3}$/;
  const SHA = /^[a-f0-9]{64}$/i;
  const positive = x => Number.isSafeInteger(x) && x > 0;
  const str = x => x == null ? '' : String(x);
  const array = x => Array.isArray(x) ? x : [];
  const escapeHTML = x => str(x).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  // Включая HTML и начало новой Markdown-конструкции: заметки остаются текстом.
  const escapeMD = x => str(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+\-.!|]/g, '\\$&');
  const mdText = x => escapeMD(x).replace(/\r\n?/g, '\n').replace(/\n/g, '  \n');
  const quoteMD = x => str(x).replace(/\r\n?/g, '\n').split('\n').map(line => '> ' + escapeMD(line)).join('\n');
  const linkMD = (label, url) => '[' + escapeMD(label) + '](<' + url.replace(/[<>]/g, c => c === '<' ? '%3C' : '%3E') + '>)';
  const linkHTML = (label, url) => '<a href="' + escapeHTML(url) + '" rel="noopener noreferrer">' + escapeHTML(label) + '</a>';

  function decisionURL(decision) {
    const id = str(decision && decision.id);
    return ID.test(id) ? PUBLIC + '#/d/' + id : '';
  }
  function quoteURL(decision, quote) {
    if (!decisionURL(decision) || !quote || !['text', 'headnote'].includes(quote.field) ||
        !Number.isSafeInteger(quote.start) || quote.start < 0 || !Number.isSafeInteger(quote.end) ||
        quote.end <= quote.start || quote.end - quote.start !== Array.from(str(quote.text_original)).length ||
        !SHA.test(str(quote.source_sha256))) return '';
    const query = new URLSearchParams({mode:'quote', field:quote.field, at:str(quote.start), end:str(quote.end), sha:quote.source_sha256.toLowerCase()});
    return decisionURL(decision) + '?' + query.toString();
  }
  function scanURL(value, kind) {
    if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f\\]/.test(value)) return '';
    let url;
    try { url = new URL(value, PUBLIC); } catch (_) { return ''; }
    if (url.origin !== 'https://ivseliv.github.io' || url.username || url.password || url.search || url.hash) return '';
    const folder = kind === 'page' ? 'pages' : 'fragments';
    const pattern = new RegExp('^/senat/lex/scans/(?:[0-9]{4}|[a-z][a-z0-9]*(?:-[a-z0-9]+)*)/' + folder + '/[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.webp$');
    return pattern.test(url.pathname) ? url.href : '';
  }
  function scanLinks(quote) {
    const found = [], seen = new Set();
    function add(url, kind, page) {
      if (!url || seen.has(url)) return;
      seen.add(url); found.push({url, kind, page:positive(page) ? page : null});
    }
    for (const scan of array(quote && quote.scans)) {
      if (!scan || typeof scan !== 'object') continue;
      add(scanURL(scan.full, 'page'), 'page', scan.page);
      // Координаты относятся к пассажу: у нового выделения нет своей геометрии.
      if (scan.kind === 'fragment') add(scanURL(scan.image, 'fragment'), 'fragment', scan.page);
    }
    return found;
  }
  function pages(quote) {
    // pdf_page и внутренний номер файла не являются печатным номером страницы.
    return [...new Set([
      ...array(quote && quote.printed_pages),
      ...array(quote && quote.sources).map(s => s && s.page),
      ...array(quote && quote.scans).map(s => s && s.page)
    ].filter(positive))].sort((a,b) => a-b);
  }
  function pageLabel(quote) {
    const value = pages(quote);
    return value.length ? 'Печатные страницы: ' + value.join(', ') + '.' : 'Печатные страницы не определены.';
  }
  function scanLabel(scan) {
    return (scan.kind === 'fragment' ? 'Фрагмент пассажа' : 'Полная страница') + (scan.page ? ', с. ' + scan.page : ', печатная страница не определена');
  }
  function decisionLabel(decision) {
    const d = decision || {}, year = str(d.year), number = str(d.number);
    return [year ? 'Том ' + year : '', number ? 'решение № ' + number : '', !year && !number ? str(d.id) : ''].filter(Boolean).join(', ') || 'Решение';
  }
  function fieldLabel(quote) {
    return quote && quote.field === 'headnote' ? 'Заголовок издания' : quote && quote.field === 'text' ? 'Основной текст решения' : 'Поле источника не определено';
  }
  function sourceLabel(quote) {
    const q = quote || {}, range = Number.isSafeInteger(q.start) && q.start >= 0 && Number.isSafeInteger(q.end) && q.end > q.start ? '; символы ' + q.start + '–' + q.end + ' (Unicode)' : '';
    return fieldLabel(q) + range + '.';
  }
  function items(state) { return array(state && state.items).filter(x => x && typeof x === 'object'); }
  function title(state) { return str(state && state.title) || 'Читательская подборка Сената'; }
  const LIMITS = 'Это личная читательская подборка. Заметки принадлежат читателю; цитаты сохранены в исходной орфографии. Печатные страницы и сканы указаны для решений и цитат, где есть проверенная привязка. Фрагмент пассажа может быть шире выделенной цитаты. Для открытия публичных ссылок и сканов нужен интернет.';

  function markdown(state) {
    const lines = ['# ' + escapeMD(title(state)), '', LIMITS, ''];
    if (state && state.note) lines.push('## Заметка к подборке', '', mdText(state.note), '');
    const selected = items(state);
    if (!selected.length) lines.push('Подборка пуста.', '');
    selected.forEach((item, i) => {
      const d = item.decision || {}, url = decisionURL(d);
      lines.push('## ' + (i + 1) + '. ' + escapeMD(decisionLabel(d)), '');
      if (d.department) lines.push(mdText(d.department), '');
      if (d.date_label) lines.push('Дата в издании: ' + mdText(d.date_label), '');
      if (d.headnote) lines.push('### Заголовок издания', '', quoteMD(d.headnote), '');
      lines.push(url ? linkMD('Открыть решение', url) : 'Публичная ссылка на решение не определена.', '');
      if(d.source_warning)lines.push('Ограничение источника: '+mdText(d.source_warning),'');
      if (item.note) lines.push('### Заметка читателя', '', mdText(item.note), '');
      const quotes = array(item.quotes).filter(q => q && typeof q === 'object');
      lines.push(pageLabel(d), '');
      const decisionScans=scanLinks(d);
      if(decisionScans.length)lines.push(...decisionScans.map(s=>'- '+linkMD(scanLabel(s),s.url)), '');
      else lines.push('Сканы решения не определены.', '');
      if (!quotes.length) lines.push('Сохранённых цитат нет.', '');
      quotes.forEach((q, qi) => {
        const place = quoteURL(d, q), scans = scanLinks(q);
        lines.push('### Цитата ' + (qi + 1), '', quoteMD(q.text_original), '', pageLabel(q), '', sourceLabel(q), '');
        lines.push(place ? linkMD('Открыть место в решении', place) : 'Проверяемая ссылка на место не определена.', '');
        if (SHA.test(str(q.source_sha256))) lines.push('SHA\-256 исходного поля: `' + q.source_sha256.toLowerCase() + '`', '');
        if (scans.length) lines.push(...scans.map(s => '- ' + linkMD(scanLabel(s), s.url)), '');
        else lines.push('Ссылки на сканы для этой цитаты не определены.', '');
        lines.push('Проверка: '+mdText(q.verification?.reason||'Снимок цитаты; текущая версия источника не проверена.'),'');
        if(q.source_warning)lines.push('Ограничение источника: '+mdText(q.source_warning),'');
        if (q.note) lines.push('Заметка читателя к цитате:', '', mdText(q.note), '');
      });
    });
    return lines.join('\n');
  }

  function html(state) {
    const selected = items(state), parts = [];
    if (state && state.note) parts.push('<section><h2>Заметка к подборке</h2><p class="reader-note">' + escapeHTML(state.note) + '</p></section>');
    if (!selected.length) parts.push('<p>Подборка пуста.</p>');
    selected.forEach((item, i) => {
      const d = item.decision || {}, url = decisionURL(d);
      const content = ['<article><h2>' + (i + 1) + '. ' + escapeHTML(decisionLabel(d)) + '</h2>'];
      if (d.department) content.push('<p>' + escapeHTML(d.department) + '</p>');
      if (d.date_label) content.push('<p>Дата в издании: ' + escapeHTML(d.date_label) + '</p>');
      if (d.headnote) content.push('<h3>Заголовок издания</h3><blockquote class="original">' + escapeHTML(d.headnote) + '</blockquote>');
      content.push('<p>' + (url ? linkHTML('Открыть решение', url) : 'Публичная ссылка на решение не определена.') + '</p>');
      if(d.source_warning)content.push('<p class="metadata">Ограничение источника: '+escapeHTML(d.source_warning)+'</p>');
      if (item.note) content.push('<h3>Заметка читателя</h3><p class="reader-note">' + escapeHTML(item.note) + '</p>');
      const quotes = array(item.quotes).filter(q => q && typeof q === 'object');
      content.push('<p>'+escapeHTML(pageLabel(d))+'</p>');
      const decisionScans=scanLinks(d);
      if(decisionScans.length)content.push('<ul>'+decisionScans.map(s=>'<li>'+linkHTML(scanLabel(s),s.url)+'</li>').join('')+'</ul>');
      else content.push('<p class="metadata">Сканы решения не определены.</p>');
      if (!quotes.length) content.push('<p class="metadata">Сохранённых цитат нет.</p>');
      quotes.forEach((q, qi) => {
        const place = quoteURL(d, q), scans = scanLinks(q);
        content.push('<section class="saved-quote"><h3>Цитата ' + (qi + 1) + '</h3><blockquote class="original">' + escapeHTML(q.text_original) + '</blockquote>');
        content.push('<p>' + escapeHTML(pageLabel(q)) + '</p><p class="metadata">' + escapeHTML(sourceLabel(q)) + '</p>');
        content.push('<p>' + (place ? linkHTML('Открыть место в решении', place) : 'Проверяемая ссылка на место не определена.') + '</p>');
        if (SHA.test(str(q.source_sha256))) content.push('<p class="metadata">SHA-256 исходного поля: <code>' + q.source_sha256.toLowerCase() + '</code></p>');
        if (scans.length) content.push('<ul>' + scans.map(s => '<li>' + linkHTML(scanLabel(s), s.url) + '</li>').join('') + '</ul>');
        else content.push('<p class="metadata">Ссылки на сканы для этой цитаты не определены.</p>');
        content.push('<p class="metadata">Проверка: '+escapeHTML(q.verification?.reason||'Снимок цитаты; текущая версия источника не проверена.')+'</p>');
        if(q.source_warning)content.push('<p class="metadata">Ограничение источника: '+escapeHTML(q.source_warning)+'</p>');
        if (q.note) content.push('<h4>Заметка читателя к цитате</h4><p class="reader-note">' + escapeHTML(q.note) + '</p>');
        content.push('</section>');
      });
      content.push('</article>'); parts.push(content.join('\n'));
    });
    return '<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">' +
      '<title>' + escapeHTML(title(state)) + '</title><style>' +
      'html{color-scheme:light}body{max-width:860px;margin:2rem auto;padding:0 1.2rem;color:#202020;background:#fff;font:18px/1.6 Georgia,"Times New Roman",serif}' +
      'h1,h2,h3,h4{line-height:1.3;overflow-wrap:anywhere}h1{font-size:1.8em}h2{font-size:1.4em;margin-top:2rem}h3{font-size:1.1em}' +
      'a{color:#17458a;overflow-wrap:anywhere}article{border-top:1px solid #bbb;margin-top:2rem;padding-top:.7rem}' +
      '.original,.reader-note{white-space:pre-wrap;overflow-wrap:anywhere}.original{border-left:3px solid #999;margin:1rem 0;padding:.4rem 0 .4rem 1rem}' +
      '.metadata,.limits{font-size:.86em;color:#555}code{font-size:.86em;overflow-wrap:anywhere}li{margin:.3em 0}' +
      '@page{margin:20mm}@media print{body{max-width:none;margin:0;padding:0;font-size:11pt;color:#000}.metadata,.limits{color:#333}h1,h2,h3,h4{break-after:avoid}article{break-inside:auto}a{color:#000;text-decoration:underline}a[href]::after{content:" (" attr(href) ")";font-size:8pt;overflow-wrap:anywhere}}' +
      '</style></head><body><header><h1>' + escapeHTML(title(state)) + '</h1><p class="limits">' + escapeHTML(LIMITS) + '</p></header>\n' + parts.join('\n') + '\n</body></html>\n';
  }

  function csv(state) {
    const fields = ['row_type','collection_title','collection_note','decision_id','volume_year','decision_number','department','date_label','decision_url','decision_note','quote_id','field','start','end','text_original','quote_note','source_sha256','source_warning','verification_status','verification_reason','checked_sha256','printed_pages','quote_url','scan_urls','saved_at','updated_at'];
    const rows = [];
    for (const item of items(state)) {
      const d = item.decision || {}, base = {collection_title:title(state), collection_note:state && state.note, decision_id:d.id, volume_year:d.year, decision_number:d.number, department:d.department, date_label:d.date_label, decision_url:decisionURL(d), decision_note:item.note, saved_at:item.saved_at, updated_at:item.updated_at};
      rows.push({...base, row_type:'decision', source_sha256:d.source_sha256, source_warning:d.source_warning, printed_pages:pages(d).join('; '), scan_urls:scanLinks(d).map(s=>scanLabel(s)+': '+s.url).join('\n')});
      for (const q of array(item.quotes).filter(q => q && typeof q === 'object')) rows.push({...base, row_type:'quote', quote_id:q.id, field:q.field, start:q.start, end:q.end, text_original:q.text_original, quote_note:q.note, source_sha256:q.source_sha256, source_warning:q.source_warning, verification_status:q.verification?.status||'unverified', verification_reason:q.verification?.reason||'', checked_sha256:q.verification?.checked_sha256||'', printed_pages:pages(q).join('; '), quote_url:quoteURL(d,q), scan_urls:scanLinks(q).map(s => scanLabel(s) + ': ' + s.url).join('\n')});
    }
    if (!rows.length) rows.push({row_type:'collection', collection_title:title(state), collection_note:state && state.note});
    // Апостроф защищает открытие CSV в таблицах от выполнения пользовательских формул.
    const cell = value => {
      let text = str(value);
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return '\uFEFF' + [fields.map(cell).join(','), ...rows.map(row => fields.map(field => cell(row[field])).join(','))].join('\r\n') + '\r\n';
  }
  function filename(value, ext) {
    const extension = str(ext).replace(/^\./, '').toLowerCase();
    if (!['md','html','csv','json','txt'].includes(extension)) throw new TypeError('Неподдерживаемый формат экспорта');
    const name = str(value).normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069/\\:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
    const short = Array.from(name).slice(0, 90).join('').replace(/[.\s]+$/g, '');
    return (short || 'Сенат — подборка') + '.' + extension;
  }
  return {markdown, html, csv, filename};
});
