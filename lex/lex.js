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

  const ENDINGS = ['иями', 'ией', 'ием', 'иям', 'иях', 'ие', 'ию', 'ями', 'ами', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ать', 'ять', 'ить', 'еть', 'ыть', 'ует',
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
    return (t.match(/[а-я0-9]+/g) || []).filter(w => (w.length > 1 || /^[0-9]+$/.test(w)) && !STOP.has(w));
  }
  function stems(text) { return tokens(text).map(stem); }
  // Внутри кавычек сохраняем служебные слова и слова из одной буквы.
  function allStems(text) {
    return (modernize(text).toLowerCase().replace(/ё/g, 'е').match(/[а-я0-9]+/g) || []).map(stem);
  }
  function containsSequence(arr, seq) {
    if (!seq.length) return false;
    outer: for (let i=0; i+seq.length<=arr.length; i++) {
      for (let j=0; j<seq.length; j++) if (arr[i+j]!==seq[j]) continue outer;
      return true;
    }
    return false;
  }
  function sequenceMatcher(index) {
    const vocab = new Map((index.vocabulary || []).map((word,i)=>[word,i]));
    return (id, terms) => {
      const seq = terms.map(t=>vocab.get(t));
      if (seq.some(t=>t===undefined)) return false;
      const parts = index.sequences ? index.sequences[id] : index.sequence ? [index.sequence[id]] : [];
      return (parts || []).some(part=>containsSequence(part,seq));
    };
  }
  const latin = 'aeopcxyiABCEHKMOPTXI', cyrillic = 'аеорсхуіАВСЕНКМОРТХІ';
  function normalizeOcr(text, knownWords) {
    const corrections=[];
    text=text.replace(/[А-Яа-яЁёѢѣІіѲѳѴѵA-Za-z0-9_]+/g, word=> {
      if (!/[А-Яа-яЁёѢѣІіѲѳѴѵ]/.test(word) || !/[A-Za-z]/.test(word)) return word;
      const to=Array.from(word,c=>latin.includes(c)?cyrillic[latin.indexOf(c)]:c).join('');
      if(to!==word)corrections.push({from:word,to,kind:'mixed-script'});
      return to;
    });
    if(knownWords)text=text.replace(/([А-Яа-яЁёѢѣІіѲѳѴѵ]{3,})-[ \t\r\n]+([а-яёѣіѳѵ]{2,})/g,(from,a,b)=> {
      const to=a+b,key=modernize(to).toLowerCase().replace(/ё/g,'е');
      if(!knownWords.has(key))return from;
      corrections.push({from,to,kind:'hyphenation'});return to;
    });
    return {text,corrections};
  }
  function unsupportedOperators(q) {
    const flags=[];
    if(/(?:^|[^А-Яа-яЁё])(?:не|ни|без|кроме|исключая|только|лишь)(?=$|[^А-Яа-яЁё])/i.test(q))flags.push('negation');
    if(/(?:^|\s)[+−-]\S/.test(q))flags.push('minus');
    if(/["«»“”„]/.test(q))flags.push('phrase');
    return flags;
  }
  function oneEdit(a,b) {
    if(Math.abs(a.length-b.length)>1 || a===b)return false;
    let i=0,j=0,edits=0;
    while(i<a.length && j<b.length) {
      if(a[i]===b[j]){i++;j++;continue;}
      if(++edits>1)return false;
      if(a.length>=b.length)i++;if(b.length>=a.length)j++;
    }
    return edits+(i<a.length || j<b.length?1:0)===1;
  }
  function fuzzyQuery(q, indexes) {
    if(unsupportedOperators(q).length)return null;
    const lexicon=[...new Set(indexes.flatMap(index=>index.lexicon || []))];
    let changed=null;
    for(const word of [...new Set(tokens(q))]) {
      if(!/^[а-я]{7,}$/.test(word) || indexes.some(index=>index.post[stem(word)]))continue;
      const matches=lexicon.filter(candidate=>oneEdit(word,candidate));
      // Не выбираем молча одно из нескольких слов с разными основами.
      const roots=new Set(matches.map(stem));
      if(roots.size!==1 || !matches.length)continue;
      if(changed)return null; // Не более одного исправленного слова запроса.
      changed={from:word,to:matches.sort((a,b)=>a.localeCompare(b,'ru'))[0],kind:'typo'};
    }
    if(!changed)return null;
    const text=modernize(q).toLowerCase().replace(/ё/g,'е').replace(/[а-я0-9]+/g,w=>w===changed.from?changed.to:w);
    return {text,corrections:[changed]};
  }
  function ocrCorrections(index,id,terms,queryCorrections) {
    const set=new Set(terms), edits=[...(queryCorrections || []),...(index.changes?.[id] || []).filter(c=>(c.terms || []).some(t=>set.has(t)))];
    const unique=new Map();
    for(const {from,to,kind} of edits)unique.set(kind+'\0'+from+'\0'+to,{from,to,kind});
    return [...unique.values()];
  }

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
    const phrases = [], notPhrases = [], not = [], clauses = [], expanded = [];
    q = q.replace(/(-?)(?:"([^"]+)"|«([^»]+)»|“([^”]+)”|„([^“]+)“)/g, (_, minus, a, b, c, d) => {
      const p=a || b || c || d;
      const seq=allStems(p);if(seq.length)(minus?notPhrases:phrases).push(seq);
      if(!minus)for(const st of stems(p))clauses.push([[st]]);
      return ' ';
    });
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
    return { clauses, phrases, notPhrases, not, expanded: [...new Set(expanded)] };
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
    const phraseMatches=sequenceMatcher(index);
    const ocrEngine=index.ocr ? makeEngine(index.ocr,docs) : null;
    const knownWords=index.ocr ? new Set(index.ocr.lexicon || []) : null;

    function exactSearch(q, opts) {
      opts = opts || {};
      const pq = parseQuery(q, opts.gloss !== false);
      const filter = opts.filter || (() => true);
      const clauses = pq.clauses.slice();
      let cand = null, scores = new Map();
      if (!clauses.length) {           // только фильтры: все решения, новее вперёд
        cand = new Set(docs.map(d=>d.i));
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
      for(const phrase of pq.phrases)for(const id of cand)if(!phraseMatches(id,phrase))cand.delete(id);
      for(const phrase of pq.notPhrases)for(const id of cand)if(phraseMatches(id,phrase))cand.delete(id);
      const hits = [];
      for (const id of cand) if (filter(docs[id])) hits.push({ i: id, score: scores.get(id) || 0 });
      hits.sort((a, c) => c.score - a.score || a.i - c.i);
      return { hits, query: pq };
    }
    function search(q, opts) {
      opts=opts || {};
      const result=exactSearch(q,opts);
      if(!ocrEngine || opts.ocr===false || result.query.not.length || result.query.notPhrases.length)return result;
      const normalized=normalizeOcr(q,knownWords);
      let additional=ocrEngine.search(normalized.text,{...opts,ocr:false}), changes=normalized.corrections;
      if(!result.hits.length && !additional.hits.length && opts.fuzzy!==false) {
        const fuzzy=fuzzyQuery(normalized.text,[index,index.ocr]);
        if(fuzzy){additional=ocrEngine.search(fuzzy.text,{...opts,ocr:false});changes=[...changes,...fuzzy.corrections];}
      }
      const seen=new Set(result.hits.map(h=>h.i));
      const terms=additional.query.clauses.flat(3);
      for(const hit of additional.hits)if(!seen.has(hit.i))result.hits.push({...hit,ocr:true,
        corrections:ocrCorrections(index.ocr,hit.i,terms,changes)});
      return result;
    }
    return { search, post };
  }

  /* Подсветка: возвращает HTML-фрагмент вокруг лучшего окна слов запроса. */
  function esc(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const WORD_RX=/[А-Яа-яЁёѢѣІіѲѳѴѵA-Za-z0-9_]+/g;
  const WORD_EDGE=/[А-Яа-яЁёѢѣІіѲѳѴѵA-Za-z0-9_]/;
  function matchRanges(text,qstems,corrections) {
    const set=new Set(qstems),ranges=[];
    // Нормализуем только ключ сравнения. Выводится буквальный исходный токен,
    // включая латинскую букву, по которой найдено OCR-совпадение.
    for(const m of text.matchAll(WORD_RX)) {
      const st=allStems(normalizeOcr(m[0]).text)[0];
      if(set.has(st))ranges.push({s:m.index,e:m.index+m[0].length});
    }
    for(const correction of corrections || []) {
      // Современное представление также строится из исходника; замена from
      // нужна лишь для поиска диапазона в уже выбранном отображении.
      for(const from of new Set([correction.from,modernize(correction.from)])) {
        if(!from)continue;
        for(let at=text.indexOf(from);at>=0;at=text.indexOf(from,at+from.length)) {
          if((at && WORD_EDGE.test(text[at-1])) || WORD_EDGE.test(text[at+from.length] || ''))continue;
          ranges.push({s:at,e:at+from.length});
        }
      }
    }
    ranges.sort((a,b)=>a.s-b.s || b.e-a.e);
    const merged=[];
    for(const range of ranges) {
      const previous=merged[merged.length-1];
      if(previous && range.s<=previous.e)previous.e=Math.max(previous.e,range.e);
      else merged.push({...range});
    }
    return merged;
  }
  function renderRanges(text,ranges,from=0,to=text.length) {
    let out='',pos=from;
    for(const range of ranges) {
      if(range.e<=from || range.s>=to)continue;
      const start=Math.max(range.s,from),end=Math.min(range.e,to);
      out+=esc(text.slice(pos,start))+'<mark>'+esc(text.slice(start,end))+'</mark>';pos=end;
    }
    return out+esc(text.slice(pos,to));
  }
  function highlightText(text,qstems,corrections) {
    return renderRanges(text,matchRanges(text,qstems,corrections));
  }
  function snippet(text, qstems, width, corrections) {
    width = width || 320;
    const t = text.replace(/\s+/g, ' ');
    const edits=(corrections || []).map(c=>({...c,from:c.from.replace(/\s+/g,' ')}));
    const ranges=matchRanges(t,qstems,edits);
    let from = 0;
    if (ranges.length) {
      let best=-1,bestStart=ranges[0].s;
      for(const range of ranges) {
        const count=ranges.filter(r=>r.s>=range.s && r.s<range.s+width).length;
        if(count>best){best=count;bestStart=range.s;}
      }
      from = Math.max(0, bestStart - 60);
      const sp = t.lastIndexOf(' ', from); from = sp >= 0 && from > 0 ? sp + 1 : from;
    }
    const to = Math.min(t.length, from + width);
    const out=renderRanges(t,ranges,from,to);
    return (from > 0 ? '… ' : '') + out + (to < t.length ? ' …' : '');
  }

  const api = { modernize, stem, tokens, stems, allStems, sequenceMatcher, normalizeOcr, unsupportedOperators,
    fuzzyQuery, ocrCorrections, parseQuery, makeEngine, snippet, highlightText, GLOSSARY, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Lex = api;
})(typeof window !== 'undefined' ? window : globalThis);
