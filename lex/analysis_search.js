/* Общая нормализация словоформ и понятий для тем и разделов разбора. */
(function(root){
  'use strict';
  const L=typeof module!=='undefined'&&module.exports?require('./lex.js'):root.Lex;
  const C=typeof module!=='undefined'&&module.exports?require('./concept.js'):root.Concept;
  const stemSet=text=>new Set(L.stems(String(text||'')));
  function compile(query,glossary=[]) {
    const parsed=C.parse(query,glossary);
    const groups=parsed.groups.map(group=>{
      // Общее старое слово «содержание» относится и к другим обязательствам.
      // Для исторических синонимов сохраняем смысл полной многословной фразы.
      const names=[...group.modern,...group.old.filter(name=>L.tokens(name).length>1)];
      return [...new Map(names.map(name=>[L.stems(name).join(' '),L.stems(name)])).values()].filter(x=>x.length);
    });
    const unsupportedOperators=parsed.unsupportedOperators||[];
    const valid=(!query.trim()||groups.length>0)&&!unsupportedOperators.length;
    return {groups,unsupportedOperators,concepts:parsed.groups.filter(g=>g.concept).map(g=>g.concept),
      score(text) {return this.scoreSet(stemSet(text));},
      scoreSet(stems) {
        if(!valid)return -1;
        let score=0;
        for(const alternatives of groups){
          const found=alternatives.findIndex(words=>words.every(word=>stems.has(word)));
          if(found<0)return -1;
          score+=found===0?2:1;
        }
        return score;
      }};
  }
  function makeEngine(data,glossary=[]) {
    const rows=data.sections.map(row=>({row,summary:stemSet(row.heading+' '+row.speaker+' '+row.summary),
      all:stemSet(row.heading+' '+row.speaker+' '+row.summary+' '+row.quotes.join(' '))}));
    const byCase=new Map();
    for(const {row} of rows){if(!byCase.has(row.decision))byCase.set(row.decision,[]);byCase.get(row.decision).push(row);}
    return {
      data,
      caseText(id){return (byCase.get(id)||[]).map(row=>row.summary+' '+row.quotes.join(' ')).join(' ');},
      search(query,filters={}){
        const matcher=compile(query,glossary),hits=[];
        for(const {row,summary,all} of rows){
          const c=data.decisions[row.decision];
          if(filters.year&&String(c.year)!==String(filters.year)||filters.topic&&!c.topics.includes(filters.topic)||
            filters.kind&&row.kind!==filters.kind||filters.department&&c.department!==filters.department)continue;
          const score=matcher.scoreSet(all);if(score<0)continue;
          const summaryScore=matcher.scoreSet(summary);
          hits.push({row,case:c,score:score+(summaryScore>=0?3:0),matchedIn:summaryScore>=0?'summary':'quote'});
        }
        hits.sort((a,b)=>b.score-a.score||a.case.id.localeCompare(b.case.id)||a.row.section-b.row.section);
        return {hits,concepts:matcher.concepts,unsupportedOperators:matcher.unsupportedOperators,decisions:new Set(hits.map(h=>h.case.id)).size};
      }
    };
  }
  const api={compile,makeEngine,stemSet};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AnalysisSearch=api;
})(typeof window!=='undefined'?window:globalThis);
