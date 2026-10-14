/* Понятийный поиск: одно ядро используется браузером и оценкой качества. */
(function (root) {
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./lex.js') : root.Lex;
  const filler = new Set(L.stems('как можно нужно должен ли когда почему какой какие при если суд требовать требование вопрос порядок разница отличие различие'));
  const allStems = s => (L.modernize(s).toLowerCase().replace(/ё/g, 'е').match(/[а-я0-9]+/g) || []).map(L.stem);
  function contains(arr, seq) {
    outer: for (let i=0; i+seq.length<=arr.length; i++) {
      for (let j=0; j<seq.length; j++) if (arr[i+j] !== seq[j]) continue outer;
      return true;
    }
    return false;
  }
  function parse(q, glossary) {
    // Сохраняем слово рядом с основой: неизвестные слова ещё раз проходят
    // L.stems() при поиске. Повторное усечение основы (нотариуса → нотариу
    // → нотари) не совпадает с однократной нормализацией индекса и подсветки.
    const tokens = L.tokens(q).map(raw => ({raw, stem:L.stem(raw)})).filter(w => !filler.has(w.stem));
    const aliases = [];
    for (const c of glossary) for (const name of [c.понятие, ...c.синонимы]) {
      // Служебные слова не образуют самостоятельных групп в запросе,
      // поэтому их нельзя оставлять в псевдониме: иначе фраза
      // «… требования …» никогда не совпадёт с тем же пользовательским
      // запросом, из которого это слово уже убрано.
      const seq = L.stems(name).filter(s => !filler.has(s));
      if (seq.length) aliases.push({c, seq});
    }
    aliases.sort((a,b) => b.seq.length-a.seq.length);
    const used = new Set(), groups = [];
    for (const {c, seq} of aliases) {
      for (let i=0; i+seq.length<=tokens.length; i++) {
        if (seq.every((s,j) => s===tokens[i+j].stem && !used.has(i+j))) {
          for (let j=0;j<seq.length;j++) used.add(i+j);
          groups.push({concept:c.понятие, modern:[c.понятие,...c.синонимы], old:c.старые_выражения, note:c.примечание});
        }
      }
    }
    tokens.forEach((w,i) => {if (!used.has(i)) groups.push({modern:[w.raw],old:[],concept:null});});
    const unique = new Map();
    for (const group of groups) {
      const key=group.concept ? 'concept:'+group.concept : 'word:'+L.stems(group.modern[0]).join(' ');
      if (!unique.has(key)) unique.set(key,group);
    }
    return {groups:[...unique.values()], words:tokens.map(w=>w.stem)};
  }
  // Частичный поиск требует хотя бы две разные совпавшие группы. Номера
  // и распознанные юридические понятия обязательны; отрицания и операторы
  // запроса нельзя безопасно ослаблять таким способом.
  function partialAllowed(q, groups) {
    const words=L.modernize(q).toLowerCase().match(/[а-я0-9]+/g) || [];
    return groups.length>=3 && !words.some(w=>['не','ни','без','кроме','исключая','только','лишь','никогда'].includes(w)) &&
      !/["«»“”„]|(?:^|\s)[+−-]\S/.test(q);
  }
  function searchAll(engines, q, method, options) {
    const results=engines.map(e=>e.search(q,method,options));
    let hits=results.flatMap(r=>r.hits);
    // Полное совпадение в любом томе важнее частичных из остальных томов.
    const strict=hits.filter(h=>!h.partial);
    if (strict.length) hits=strict;
    hits.sort((a,b)=>b.score-a.score || a.passage.id.localeCompare(b.passage.id));
    return {...(results[0] || {expanded:[],concepts:[],query:{groups:[],words:[]}}),hits,partial:hits.some(h=>h.partial)};
  }
  function makeEngines(volumes, glossary) {
    // Для нескольких томов BM25 использует общие частоты и среднюю длину.
    // Иначе редкое слово в маленьком томе получало бы другой вес при слиянии выдачи.
    const stats=['original','enriched'].map(field=>{
      let n=0,totalLength=0;const df=new Map();
      for(const volume of volumes) {
        const index=volume[field];n+=index.n;totalLength+=index.len.reduce((sum,length)=>sum+length,0);
        for(const [term,list] of Object.entries(index.post)) df.set(term,(df.get(term)||0)+list.length/2);
      }
      return {n,avgdl:totalLength/Math.max(1,n),df};
    });
    return volumes.map(data=>makeEngine(data,glossary,stats));
  }
  function makeEngine(data, glossary, collectionStats) {
    const docs=data.passages, original=data.original, enriched=data.enriched;
    const vocab=new Map((original.vocabulary || []).map((s,i)=>[s,i]));
    const caches=[new Map(),new Map()];
    function post(index, word, which) {
      if (!caches[which].has(word)) {
        const src=index.post[word] || [], m=new Map();
        for(let i=0;i<src.length;i+=2) m.set(src[i],src[i+1]);
        caches[which].set(word,m);
      }
      return caches[which].get(word);
    }
    function alternatives(index, names, which, phrase) {
      const scores=new Map(), matches=new Map();
      for (const name of [...new Set(names)]) {
        const terms=L.stems(name); if (!terms.length) continue;
        const lists=terms.map(t=>post(index,t,which));
        let ids=[...lists[0].keys()].filter(id=>lists.every(p=>p.has(id)));
        if(phrase && allStems(name).length>1) {
          const seq=allStems(name).map(s=>vocab.get(s));
          ids=ids.filter(id=>seq.every(s=>s!==undefined) && contains(original.sequence[id],seq));
        }
        for(const id of ids) {
          let score=0;
          for(let j=0;j<terms.length;j++) {
            const stats=collectionStats && collectionStats[which];
            const tf=lists[j].get(id), df=stats ? stats.df.get(terms[j]) : lists[j].size, n=stats ? stats.n : index.n;
            const idf=Math.log(1+(n-df+0.5)/(df+0.5));
            score+=idf*tf*2.2/(tf+1.2*(0.25+0.75*index.len[id]/Math.max(1,stats ? stats.avgdl : index.avgdl)));
          }
          if(score>(scores.get(id)||0)) { scores.set(id,score); matches.set(id,name); }
        }
      }
      return {scores,matches};
    }
    function search(q, method, options) {
      method=method || 'glossary';
      const pq=parse(q,method==='baseline'?[]:glossary);
      if(!pq.groups.length) return {hits:[],expanded:[],concepts:[],query:pq};
      let candidates=null; const total=new Map(), evidence=new Map(), groupMatches=[];
      for(const group of pq.groups) {
        const plain=alternatives(original,group.modern,0,Boolean(group.concept));
        const old=method==='glossary'||method==='hybrid' ? alternatives(original,group.old,0,true) : {scores:new Map(),matches:new Map()};
        const ai=method==='enriched'||method==='hybrid' ? alternatives(enriched,group.modern,1,false) : {scores:new Map(),matches:new Map()};
        const scores=new Map(), terms=new Map();
        for(const [result,weight] of [[plain,1],[old,0.85],[ai,0.8]]) for(const [id,value] of result.scores) {
          if(value*weight>(scores.get(id)||0)) {scores.set(id,value*weight);terms.set(id,result===ai?'':result.matches.get(id));}
        }
        const ids=new Set(scores.keys());
        groupMatches.push(ids);
        candidates=candidates===null?ids:new Set([...candidates].filter(id=>ids.has(id)));
        for(const [id,score] of scores) {
          total.set(id,(total.get(id)||0)+score);
          if(!evidence.has(id)) evidence.set(id,[]);
          if(terms.get(id)) evidence.get(id).push(terms.get(id));
        }
      }
      const allowPartial=options && options.partial && partialAllowed(q,pq.groups);
      if (allowPartial) {
        candidates=new Set([...total.keys()].filter(id=> {
          const missing=pq.groups.filter((g,i)=>!groupMatches[i].has(id));
          return missing.length<=1 && missing.every(g=>!g.concept && !/\d/.test(g.modern[0]));
        }));
      }
      const hits=[...(candidates||[])].map(i=> {
        const missing=pq.groups.filter((g,j)=>!groupMatches[j].has(i)).map(g=>g.concept || g.modern[0]);
        return {i,score:total.get(i),matched:evidence.get(i),passage:docs[i],partial:missing.length>0,missing};
      });
      // В пределах тома полные совпадения также первыми проходят устранение
      // перекрывающихся окон: частичный пассаж не должен вытеснять полный.
      hits.sort((a,b)=>Number(a.partial)-Number(b.partial) || b.score-a.score || a.passage.id.localeCompare(b.passage.id));
      // Перекрывающиеся окна с одним рассуждением не занимают весь верх выдачи.
      const distinct=[];
      for(const hit of hits) {
        const p=hit.passage;
        if(distinct.some(h=>h.passage.decision===p.decision &&
          Math.max(0,Math.min(h.passage.end,p.end)-Math.max(h.passage.start,p.start))/Math.min(p.end-p.start,h.passage.end-h.passage.start)>0.45)) continue;
        distinct.push(hit);
      }
      return {hits:distinct,expanded:[...new Set(pq.groups.flatMap(g=>g.old))],concepts:pq.groups.filter(g=>g.concept),query:pq};
    }
    return {search};
  }
  function highlight(text, terms) {
    const set=new Set(terms.flatMap(L.stems));
    let html='',pos=0; const re=/[А-Яа-яЁёѢѣІіѲѳѴѵъь0-9]+/g; let m;
    while((m=re.exec(text))) {
      html+=L.esc(text.slice(pos,m.index));
      const escaped=L.esc(m[0]);
      html+=set.has(allStems(m[0])[0])?'<mark>'+escaped+'</mark>':escaped;
      pos=m.index+m[0].length;
    }
    return html+L.esc(text.slice(pos));
  }
  function highlightEvidence(text, terms, evidence) {
    const html=highlight(text,terms);
    if(html.includes('<mark>') || !evidence) return html;
    const at=text.indexOf(evidence);
    if(at<0) return html;
    return L.esc(text.slice(0,at))+'<mark>'+L.esc(evidence)+'</mark>'+L.esc(text.slice(at+evidence.length));
  }
  // Python считает Unicode-символы; JS slice считает UTF-16. Смещения переводим явно.
  const slice=(text,start,end)=>Array.from(text).slice(start,end).join('');
  const api={parse,makeEngine,makeEngines,searchAll,highlight,highlightEvidence,slice,allStems};
  if(typeof module!=='undefined'&&module.exports) module.exports=api; else root.Concept=api;
})(typeof window!=='undefined'?window:globalThis);
