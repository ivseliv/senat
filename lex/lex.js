/* Ядро поиска по решениям Сената: нормализация, разбор запроса, ранжирование.
   Нормализация должна совпадать с lex/build.py (проверка: python3 lex/test_parity.py). */
(function (root) {
  'use strict';

  const CYR = '[а-яА-ЯёЁ]';
  const NOT_CYR = '(?![а-яА-ЯёЁ])';
  const R = (s, f) => new RegExp(s, f || 'g');

  function modernize(s) {
    const pairs = [['ѣ', 'е'], ['Ѣ', 'Е'], ['ѳ', 'ф'], ['Ѳ', 'Ф'], ['ѵ', 'и'], ['Ѵ', 'И'], ['і', 'и'], ['І', 'И']];
    for (const [a, b] of pairs) s = s.split(a).join(b);
    s = s.replace(R('(?<=[бвгджзйклмнпрстфхцчшщБВГДЖЗЙКЛМНПРСТФХЦЧШЩ])[ъЪ]' + NOT_CYR), '');
    s = s.replace(R('(?<=[жчшщЖЧШЩ])аго' + NOT_CYR), 'его');
    s = s.replace(R('аго' + NOT_CYR), 'ого');
    s = s.replace(R('яго' + NOT_CYR), 'его');
    s = s.replace(R('(?<=[кгхжчшщ])ія' + NOT_CYR), 'ие');
    s = s.replace(R('ыя' + NOT_CYR), 'ые');
    s = s.replace(R('ія' + NOT_CYR), 'ия');
    s = s.replace(R('(?<![а-яА-ЯёЁ])чрез' + NOT_CYR), 'через');
    return s;
  }

  const ENDINGS = ['иями', 'ями', 'ами', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ать', 'ять', 'ить', 'еть', 'ыть', 'ует',
    'ают', 'яет', 'ает', 'ой', 'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ов', 'ев', 'ей',
    'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ую', 'юю', 'ою', 'ею', 'ия', 'ии', 'ью', 'ье', 'ья', 'а', 'я', 'о',
    'е', 'ы', 'и', 'у', 'ю', 'ь', 'й'].sort((a, b) => b.length - a.length);   // стабильно по убыванию длины
  const STOP = new Set(('и в во на по что не как с со к ко от из о об для за при или но а же ли бы то это этот эта эти был была были было ' +
    'быть есть либо также ему его ее их им ими они она оно он до над под про без между через так тем чем то').split(' '));

  function stem(w) {
    if (/^[0-9]+$/.test(w)) return w;
    if (w.length <= 5) return (w.length >= 4 && 'аяуюыиеоь'.includes(w[w.length - 1])) ? w.slice(0, -1) : w;
    for (const e of ENDINGS) {
      if (w.endsWith(e) && w.length - e.length >= 4) { w = w.slice(0, -e.length); break; }
    }
    return w.slice(0, 7);
  }

  function tokens(text) {
    const t = modernize(text).toLowerCase().replace(/ё/g, 'е');
    return (t.match(/[а-я0-9]+/g) || []).filter(w => w.length > 1 && !STOP.has(w));
  }
  function stems(text) { return tokens(text).map(stem); }

  /* Современный термин -> старые/родственные выражения (в современной орфографии). */
  const GLOSSARY = {
    'стороны': ['тяжущиеся'], 'сторона': ['тяжущийся'], 'исполнитель': ['душеприказчик'], 'налог': ['пошлина', 'сбор'],
    'налоги': ['пошлины', 'сборы'], 'госпошлина': ['судебные пошлины', 'гербовый сбор', 'канцелярские пошлины'],
    'залог': ['заклад', 'ипотека'], 'ипотека': ['закладная', 'крепость', 'заклад'], 'недвижимость': ['недвижимое имение', 'имение'],
    'имущество': ['имение'], 'ущерб': ['убытки', 'вред'], 'возмещение': ['вознаграждение', 'удовлетворение'],
    'компенсация': ['вознаграждение'], 'штраф': ['пеня', 'неустойка'], 'неустойка': ['пеня'], 'кредитор': ['заимодавец'],
    'заемщик': ['должник'], 'работник': ['рабочий', 'приказчик', 'служащий'], 'работодатель': ['хозяин', 'наниматель'],
    'аренда': ['наем', 'оброчное содержание', 'арендный'], 'арендатор': ['наниматель', 'съемщик'], 'арендодатель': ['наймодатель'],
    'недействительность': ['ничтожность'], 'недействительный': ['ничтожный'], 'юрлицо': ['товарищество', 'общество'],
    'корпорация': ['товарищество', 'общество'], 'банкротство': ['несостоятельность', 'конкурс'], 'несостоятельность': ['банкротство', 'конкурс'],
    'конкурсный': ['конкурсное управление'], 'управляющий': ['присяжный попечитель', 'управление'], 'представитель': ['поверенный', 'доверенный', 'уполномоченный'],
    'адвокат': ['присяжный поверенный'], 'обжалование': ['жалоба', 'просьба', 'кассация'], 'апелляция': ['апелляционная жалоба'],
    'расходы': ['издержки'], 'алименты': ['содержание', 'пропитание'], 'развод': ['расторжение брака'], 'супруг': ['муж', 'жена'],
    'несовершеннолетний': ['малолетний'], 'недееспособность': ['прещение', 'опека', 'душевная болезнь'], 'опекун': ['попечитель'],
    'ценные': ['фонды', 'акции'], 'акционер': ['пайщик'], 'страховщик': ['страховое общество'], 'страховая': ['страховое общество'],
    'перевозчик': ['железная дорога'], 'перевозка': ['железная дорога', 'груз'], 'потерпевший': ['пострадавший'],
    'гражданин': ['подданный'], 'исполнение': ['выполнение'], 'исполнительное': ['исполнение решения', 'судебный пристав'],
    'арест': ['опись', 'запрещение'], 'собственность': ['владение', 'вотчинное право'], 'собственник': ['владелец'],
    'договор': ['условие', 'сделка', 'контракт'], 'сделка': ['договор', 'акт'], 'доказательства': ['свидетели', 'документы'],
    'судья': ['судья', 'мировой судья'], 'верховный': ['сенат', 'кассационный департамент'], 'кассация': ['кассационная просьба', 'отмена решения'],
    'подсудность': ['подведомственность'], 'полномочия': ['доверенность'], 'нотариус': ['нотариальный'], 'вексель': ['переводной', 'простой вексель'],
    'банк': ['кредитное учреждение', 'банковский'], 'убыток': ['вред'], 'поставка': ['доставка', 'товар'], 'подряд': ['подрядчик', 'работа'],
  };

  /* Разбор запроса: слова (И), "фразы", -минус. Возвращает {clauses, phrases, not, expanded}. */
  function parseQuery(q, useGloss) {
    const phrases = [], not = [], clauses = [], expanded = [];
    q = q.replace(/"([^"]+)"/g, (_, p) => { const st = stems(p); if (st.length) phrases.push(st); return ' ' + p + ' '; });
    for (let raw of q.split(/\s+/)) {
      if (!raw) continue;
      if (raw[0] === '-' && raw.length > 1) { stems(raw.slice(1)).forEach(s => not.push(s)); continue; }
      const toks = tokens(raw);
      for (const w of toks) {
        const alts = [[stem(w)]];
        if (useGloss) {
          const gl = GLOSSARY[w] || GLOSSARY[modernize(w)];
          if (gl) for (const a of gl) { const st = stems(a); if (st.length) { alts.push(st); expanded.push(a); } }
        }
        clauses.push(alts);
      }
    }
    return { clauses, phrases, not, expanded: [...new Set(expanded)] };
  }

  /* Индекс: index.json -> структура для поиска. */
  function makeEngine(index, docs) {
    const N = index.n, avgdl = index.avgdl, lens = index.len;
    const cache = new Map();
    function post(stemStr, field) {
      const key = field + stemStr;
      if (cache.has(key)) return cache.get(key);
      const src = (field === 'h' ? index.hpost : index.post)[stemStr];
      let m = null;
      if (src) { m = new Map(); for (let i = 0; i < src.length; i += 2) m.set(src[i], src[i + 1]); }
      cache.set(key, m);
      return m;
    }
    const k1 = 1.2, b = 0.75;
    const idf = df => Math.log(1 + (N - df + 0.5) / (df + 0.5));

    function search(q, opts) {
      opts = opts || {};
      const pq = parseQuery(q, opts.gloss !== false);
      const filter = opts.filter || (() => true);
      const clauses = pq.clauses.slice();
      pq.phrases.forEach(p => clauses.push([p]));
      let cand = null, scores = new Map();
      if (!clauses.length) {           // только фильтры: все решения, новее вперёд
        const out = [];
        for (const d of docs) if (filter(d)) out.push({ i: d.i, score: 0 });
        return { hits: out, query: pq };
      }
      for (const alts of clauses) {
        const ok = new Set();
        for (const alt of alts) {
          let s = null;
          for (const st of alt) {
            const p = post(st, 'b'); const ids = p ? new Set(p.keys()) : new Set();
            s = s === null ? ids : new Set([...s].filter(x => ids.has(x)));
          }
          if (s) for (const id of s) {
            ok.add(id);
            let sc = 0;
            for (const st of alt) {
              const p = post(st, 'b'); const tf = p.get(id);
              const w = idf(p.size) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * lens[id] / avgdl));
              const hp = post(st, 'h'); sc += w + (hp && hp.has(id) ? 1.5 * idf(hp.size) : 0);
            }
            scores.set(id, (scores.get(id) || 0) + sc * (alt === alts[0] ? 1 : 0.6));
          }
        }
        cand = cand === null ? ok : new Set([...cand].filter(x => ok.has(x)));
      }
      for (const st of pq.not) { const p = post(st, 'b'); if (p) for (const id of p.keys()) cand.delete(id); }
      const hits = [];
      for (const id of cand) if (filter(docs[id])) hits.push({ i: id, score: scores.get(id) || 0 });
      hits.sort((a, c) => c.score - a.score || a.i - c.i);
      return { hits, query: pq };
    }
    return { search, post };
  }

  /* Подсветка: возвращает HTML-фрагмент вокруг лучшего окна слов запроса. */
  function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function snippet(text, qstems, width) {
    width = width || 320;
    const t = text.replace(/\s+/g, ' ');
    const re = /[А-Яа-яЁёѢѣІіѲѳѴѵъь0-9]+/g; const words = []; let m;
    while ((m = re.exec(t))) words.push({ s: m.index, e: m.index + m[0].length, st: stem(modernize(m[0]).toLowerCase().replace(/ё/g, 'е')) });
    const set = new Set(qstems); const idx = words.map((w, k) => set.has(w.st) ? k : -1).filter(k => k >= 0);
    let from = 0;
    if (idx.length) {
      let best = -1, bestStart = idx[0];
      for (const k of idx) {
        const seen = new Set(idx.filter(j => words[j].s >= words[k].s && words[j].s < words[k].s + width).map(j => words[j].st));
        if (seen.size > best) { best = seen.size; bestStart = k; }
      }
      from = Math.max(0, words[bestStart].s - 60);
      const sp = t.lastIndexOf(' ', from); from = sp >= 0 && from > 0 ? sp + 1 : from;
    }
    const to = Math.min(t.length, from + width);
    let out = '', pos = from;
    for (const w of words) {
      if (w.e <= from || w.s >= to) continue;
      out += esc(t.slice(pos, w.s)); const piece = t.slice(w.s, w.e);
      out += set.has(w.st) ? '<mark>' + esc(piece) + '</mark>' : esc(piece); pos = w.e;
    }
    out += esc(t.slice(pos, to));
    return (from > 0 ? '… ' : '') + out + (to < t.length ? ' …' : '');
  }

  const api = { modernize, stem, tokens, stems, parseQuery, makeEngine, snippet, GLOSSARY, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Lex = api;
})(typeof window !== 'undefined' ? window : globalThis);
