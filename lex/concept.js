/* Понятийный поиск: одно ядро используется браузером и оценкой качества. */
(function (root) {
  'use strict';
  const L = typeof module !== 'undefined' && module.exports ? require('./lex.js') : root.Lex;
  const filler = new Set(L.stems('как можно нужно должен ли когда почему какой какие при если суд требовать требование вопрос порядок разница отличие различие'));
  const allStems = L.allStems;
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
    return {groups:[...unique.values()], words:tokens.map(w=>w.stem),unsupportedOperators:L.unsupportedOperators(q)};
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
    let results=engines.map(e=>e.search(q,method,{...options,fuzzy:false}));
    let hits=results.flatMap(r=>r.hits);
    if(!hits.length && (!options || options.ocr!==false) && (!options || options.fuzzy!==false)) {
      results=engines.map(e=>e.search(q,method,{...options,fuzzy:true}));hits=results.flatMap(r=>r.hits);
    }
    // Полное совпадение в любом томе важнее частичных из остальных томов.
    const strict=hits.filter(h=>!h.partial);
    if (strict.length) hits=strict;
    hits.sort((a,b)=>Number(Boolean(a.ocr))-Number(Boolean(b.ocr)) || Number(Boolean(a.context))-Number(Boolean(b.context)) || b.score-a.score || a.passage.id.localeCompare(b.passage.id));
    return {...(results[0] || {expanded:[],concepts:[],query:{groups:[],words:[]}}),hits,partial:hits.some(h=>h.partial)};
  }
  function makeEngines(volumes, glossary) {
    // Для нескольких томов BM25 использует общие частоты и среднюю длину.
    // Иначе редкое слово в маленьком томе получало бы другой вес при слиянии выдачи.
    const stats=['original','enriched','ocr'].map(field=>{
      let n=0,totalLength=0;const df=new Map();
      for(const volume of volumes) {
        const index=field==='ocr' ? volume.original.ocr || volume.original : volume[field];n+=index.n;totalLength+=index.len.reduce((sum,length)=>sum+length,0);
        for(const [term,list] of Object.entries(index.post)) df.set(term,(df.get(term)||0)+list.length/2);
      }
      return {n,avgdl:totalLength/Math.max(1,n),df};
    });
    const queryIndexes=volumes.flatMap(volume=>[volume.original,volume.original.ocr].filter(Boolean));
    return volumes.map(data=>makeEngine(data,glossary,stats,queryIndexes));
  }
  function makeEngine(data, glossary, collectionStats, queryIndexes) {
    const docs=data.passages, original=data.original, enriched=data.enriched;
    const phraseMatches=L.sequenceMatcher(original);
    const ocrEngine=original.ocr ? makeEngine({passages:docs,original:original.ocr,enriched},glossary,
      collectionStats ? [collectionStats[2],collectionStats[1]] : null) : null;
    const fuzzyIndexes=queryIndexes || [original,original.ocr].filter(Boolean);
    const knownWords=original.ocr ? new Set(fuzzyIndexes.flatMap(index=>index.lexicon || [])) : null;
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
          const seq=allStems(name);
          ids=ids.filter(id=>phraseMatches(id,seq));
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
    function exactSearch(q, method, options) {
      method=method || 'glossary';
      const filter=options && options.filter || (()=>true);
      const pq=parse(q,method==='baseline'?[]:glossary);
      if(!pq.groups.length) return {hits:[],expanded:[],concepts:[],query:pq};
      let candidates=null; const total=new Map(), evidence=new Map(), groupMatches=[], groupScores=[];
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
        groupScores.push(scores);
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
      const hits=[...(candidates||[])].filter(i=>filter(docs[i])).map(i=> {
        const missing=pq.groups.filter((g,j)=>!groupMatches[j].has(i)).map(g=>g.concept || g.modern[0]);
        return {i,score:total.get(i),matched:evidence.get(i),passage:docs[i],partial:missing.length>0,missing};
      });
      // Пассажи — перекрывающиеся окна, а не самостоятельные документы.
      // Все условия могут находиться по разные стороны границы окна. В таком
      // случае показываем отдельный, явно подписанный результат с соседними
      // источниками. Ни одно условие не отбрасывается; другое дело не подходит.
      if (method==='hybrid' && (!options || options.context!==false) &&
          pq.groups.length>=2 && !/["«»“”„]/.test(q)) {
        const present=new Set(hits.filter(h=>!h.partial).map(h=>h.i));
        for (const i of total.keys()) {
          if (present.has(i)) continue;
          const own=pq.groups.filter((g,j)=>groupMatches[j].has(i)).length;
          if (own<Math.max(2,Math.ceil(pq.groups.length*0.6))) continue;
          const p=docs[i], supports=new Set(); if(!filter(p))continue;
          let score=total.get(i), complete=true;
          for (let j=0;j<pq.groups.length;j++) {
            if (groupMatches[j].has(i)) continue;
            const nearby=[i-1,i+1].filter(k=>docs[k] && filter(docs[k]) && docs[k].decision===p.decision &&
              Math.max(docs[k].end,p.end)-Math.min(docs[k].start,p.start)<=4000 &&
              Math.max(docs[k].start,p.start)<=Math.min(docs[k].end,p.end)+80 && groupMatches[j].has(k));
            nearby.sort((a,b)=>groupScores[j].get(b)-groupScores[j].get(a));
            if (!nearby.length) { complete=false; break; }
            const k=nearby[0];supports.add(k);score+=0.4*groupScores[j].get(k);
          }
          const context=[...supports].sort((a,b)=>a-b).map(k=>docs[k]);
          if (!complete || !context.length ||
              Math.max(p.end,...context.map(x=>x.end))-Math.min(p.start,...context.map(x=>x.start))>4000) continue;
          const matched=[...(evidence.get(i)||[]),...context.flatMap(c=>evidence.get(docs.indexOf(c))||[])];
          const previous=hits.findIndex(h=>h.i===i);
          if (previous>=0) hits.splice(previous,1);
          hits.push({i,score:score*0.75,matched:[...new Set(matched)],passage:p,partial:false,missing:[],context});
        }
      }
      // В пределах тома полные совпадения также первыми проходят устранение
      // перекрывающихся окон: частичный пассаж не должен вытеснять полный.
      hits.sort((a,b)=>Number(a.partial)-Number(b.partial) || Number(Boolean(a.context))-Number(Boolean(b.context)) || b.score-a.score || a.passage.id.localeCompare(b.passage.id));
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
    function search(q,method,options) {
      const result=exactSearch(q,method,options);
      if(!ocrEngine || options && options.ocr===false)return result;
      const normalized=L.normalizeOcr(q,knownWords);
      let extra=ocrEngine.search(normalized.text,method,{...options,ocr:false}),changes=normalized.corrections;
      if(!result.hits.length && !extra.hits.length && (!options || options.fuzzy!==false)) {
        const fuzzy=L.fuzzyQuery(normalized.text,fuzzyIndexes);
        if(fuzzy){extra=ocrEngine.search(fuzzy.text,method,{...options,ocr:false});changes=[...changes,...fuzzy.corrections];}
      }
      for(const hit of extra.hits) {
        const previous=result.hits.findIndex(h=>h.i===hit.i);
        if(previous>=0) {
          if(!result.hits[previous].partial || hit.partial)continue;
          result.hits.splice(previous,1);
        }
        // OCR-окна не дублируют уже найденное полное совпадение.
        // Координаты и сам исходник остаются прежними.
        const p=hit.passage;
        if(result.hits.some(h=>!h.ocr && (!h.partial || hit.partial) && h.passage.decision===p.decision &&
          Math.max(0,Math.min(h.passage.end,p.end)-Math.max(h.passage.start,p.start))/Math.min(p.end-p.start,h.passage.end-h.passage.start)>0.45))continue;
        const terms=[...extra.query.words,...hit.matched.flatMap(L.stems)];
        const corrections=L.ocrCorrections(original.ocr,hit.i,terms,changes);
        if(hit.context)for(const support of hit.context)corrections.push(...L.ocrCorrections(original.ocr,docs.indexOf(support),terms,[]));
        result.hits.push({...hit,ocr:true,corrections:[...new Map(corrections.map(c=>[c.kind+'\0'+c.from+'\0'+c.to,c])).values()]});
      }
      return result;
    }
    return {search};
  }
  function highlight(text, terms, corrections) {
    return L.highlightText(text,terms.flatMap(L.stems),corrections);
  }
  function highlightEvidence(text, terms, evidence, corrections) {
    const html=highlight(text,terms,corrections);
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
