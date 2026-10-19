/* Исследовательская справка: проверяемые источники, сравнение и перенос. */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./lex.js') : root.Lex, node ? require('./concept.js') : root.Concept);
  if (node) module.exports = api; else root.SenatResearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (L, C) {
  'use strict';
  const PUBLIC = 'https://ivseliv.github.io/senat/lex/';
  const LIMITS = Object.freeze({cases:6, query:600, title:200, note:4000, caseNote:1500, share:16000, file:2000000});
  const SHA = /^[a-f0-9]{64}$/;
  const ID = /^\d{4}-\d{3}$/;
  const cut = (s,a,b) => Array.from(s).slice(a,b).join('');
  const clone = x => JSON.parse(JSON.stringify(x));
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  function text(x, max, label, fallback='') {
    if (x == null) return fallback;
    if (typeof x !== 'string' || x.length>max) throw Error('Недопустимое поле: '+label+'.');
    return x;
  }
  async function hash(s) {
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function state(raw={}) {
    if (!object(raw) || (raw.version!=null && raw.version!==1)) throw Error('Версия справки не поддерживается.');
    const ids = raw.ids==null ? [] : raw.ids;
    if (!Array.isArray(ids) || ids.length>LIMITS.cases || ids.some(id=>typeof id!=='string'||!ID.test(id)) || new Set(ids).size!==ids.length) throw Error('Выберите не более шести разных решений.');
    const notes={general:text(raw.notes?.general,LIMITS.note,'заметка'),cases:{}};
    const hashes={};
    for(const id of ids) {
      if(raw.hashes?.[id]!=null) {
        if(typeof raw.hashes[id]!=='string'||!SHA.test(raw.hashes[id]))throw Error('Повреждена контрольная сумма решения.');
        hashes[id]=raw.hashes[id];
      }
      const note=text(raw.notes?.cases?.[id],LIMITS.caseNote,'заметка к делу');
      if(note)notes.cases[id]=note;
    }
    const corpus=text(raw.corpus,64,'версия корпуса');
    if(corpus && !SHA.test(corpus))throw Error('Повреждена версия корпуса.');
    return {version:1,q:text(raw.q,LIMITS.query,'вопрос'),terms:text(raw.terms,LIMITS.query,'поисковая формулировка',raw.q||''),
      year:text(raw.year,4,'год'),department:text(raw.department,120,'департамент'),partial:raw.partial===true,manual:raw.manual===true,
      title:text(raw.title,LIMITS.title,'название'),ids:[...ids],hashes,corpus,notes};
  }
  function encode(raw, includeNotes=false) {
    const s=state(raw);if(!includeNotes)s.notes={general:'',cases:{}};
    const bytes=new TextEncoder().encode(JSON.stringify(s));
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    const code=btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    if(code.length>LIMITS.share)throw Error('Ссылка слишком длинная. Уберите заметки из ссылки или передайте JSON-файл.');
    return code;
  }
  function decode(code) {
    if(typeof code!=='string'||!code.length||code.length>LIMITS.share||!/^[A-Za-z0-9_-]+$/.test(code))throw Error('Ссылка на справку повреждена или слишком длинная.');
    try {
      const binary=atob(code.replace(/-/g,'+').replace(/_/g,'/'));
      return state(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0)))));
    }catch(_){throw Error('Не удалось прочитать ссылку на справку. Сохранённая работа не изменена.');}
  }
  function shareURL(raw, notes=false) {return PUBLIC+'#/research?share='+encode(raw,notes);}

  // Убираем только рамку вопроса и явно показываем полученную формулировку.
  // Отрицания, числа и операторы не преобразуем; дополнительные условия сохраняем.
  function suggestTerms(question, glossary) {
    if(/(?:^|\s)(?:не|ни|без|кроме|исключая|только|лишь)(?:\s|$)|[\d"«»“”+−]/i.test(question))return question.trim();
    const words=L.tokens(question),stems=words.map(L.stem),used=new Set(),names=[];
    const fillers=/^(?:когда|почему|какой|какие|каких|каким|считали|считают|считалась|считались|признавали|признают|признается|признаются|признавалась|признавались|можно|нужно|должен|должны|сенат|решал|решил|решали|вопрос|случае|случаях)$/;
    const aliases=glossary.flatMap(c=>[c.понятие,...c.синонимы].map(name=>({name,terms:L.stems(name)})))
      .filter(a=>a.terms.length>=2).sort((a,b)=>b.terms.length-a.terms.length||a.name.localeCompare(b.name));
    for(const a of aliases) {
      const positions=a.terms.map(term=>stems.findIndex((s,i)=>s===term&&!used.has(i)));
      if(positions.some(i=>i<0)||new Set(positions).size!==positions.length)continue;
      positions.forEach(i=>used.add(i));names.push(a.name);
    }
    if(!names.length)return question.trim();
    const remainder=words.filter((w,i)=>!used.has(i)&&!fillers.test(w));
    return [...names,...remainder].join(' ');
  }
  function find(engines, config, raw, meta) {
    const s=state(raw),allowed=new Set(meta.decisions.filter(d=>(!s.year||String(d.vol)===s.year)&&(!s.department||d.dept===s.department)).map(d=>d.id));
    const selected=engines.filter(e=>e.data.passages.some(p=>allowed.has(p.decision)));
    const result=C.searchAll(selected.map(e=>e.engine),s.terms||s.q,config.method,{partial:true});
    const hits=result.hits.filter(h=>allowed.has(h.passage.decision));
    return {...result,hits:result.partial&&!s.partial?[]:hits,suggested:result.partial&&!s.partial?hits.length:0,
      candidates:[...new Set((result.partial&&!s.partial?[]:hits).map(h=>h.passage.decision))]};
  }
  function kind(section) {
    const h=section.heading.toLowerCase();
    const senate=/^сенат(?:[\s,;:]|$)/i.test(section.speaker);
    // Сопоставляем редакционные разделы, а не угадываем автора по слову
    // «Сенат» внутри пересказанного довода жалобщика.
    if(/^(?:предел|оговорк|ограничени)/.test(h))return 'limits';
    if(/постанов|результат/.test(h)||senate&&/отмен|отклон|оставлена без последствий/.test(h))return 'holding';
    if(/предшеств|палаты|нижестоящ/.test(h))return 'lower';
    if(/^(?:какой )?вопрос/.test(h))return 'question';
    if(/жалоб|жалова|довод|позици/.test(h)&&(!senate||/^(?:жалоба|на что жаловались)/.test(h)))return 'party';
    if(/^(?:спор|о ч[её]м|внес[её]нный вопрос)/.test(h))return 'facts';
    if(/рассужд|мотивиров/.test(h)||senate)return 'reason';
    return 'facts';
  }
  function pageLabel(q) {
    return q.pages.length?'Печатные страницы: '+q.pages.join(', ')+(q.incomplete_pages?' (часть номеров не определена)':''):'Печатная страница не определена';
  }
  function safeScan(path) {return typeof path==='string'&&/^scans\/\d{4}\/(?:pages|fragments)\/[A-Za-z0-9_-]+\.webp$/.test(path);}
  function context(adapter) {
    const docs=new Map(adapter.meta.decisions.map(d=>[d.id,d]));
    const all=adapter.volumes.flatMap(v=>v.passages),byId=new Map(all.map(p=>[p.id,p])),byCase=new Map();
    for(const p of all){if(!byCase.has(p.decision))byCase.set(p.decision,[]);byCase.get(p.decision).push(p);}
    const corpus=hash(JSON.stringify({schema:1,meta:adapter.meta,passages:all,analyses:adapter.analyses_revision||adapter.analyses,guides:adapter.guides,config:adapter.config||null})),cache=new Map();
    function source(d) {
      if(!cache.has(d.id))cache.set(d.id,adapter.textOf(d).then(async t=>({text:t,sha:await hash(t),cp:Array.from(t)})));
      return cache.get(d.id);
    }
    async function quote(d, ev, src, field='text') {
      const original=field==='headnote'?d.headnote:src.text,chars=field==='headnote'?Array.from(d.headnote):src.cp;
      if(!Number.isSafeInteger(ev.start)||!Number.isSafeInteger(ev.end)||ev.start<0||ev.end<=ev.start||ev.end>chars.length)throw Error(d.id+': диапазон цитаты не соответствует тексту.');
      const literal=chars.slice(ev.start,ev.end).join('');
      if(ev.text!=null&&ev.text!==literal)throw Error(d.id+': цитата изменилась; её разбор не включён.');
      const manifest=await adapter.loadScans(d.vol),parts=[];
      if(field==='text')for(const p of byCase.get(d.id)||[])for(const part of p.sources||[]){
        const start=Math.max(ev.start,part.start),end=Math.min(ev.end,part.end);
        if(start<end)parts.push({...part,start,end});
      }
      const scans=[...new Set(parts.map(p=>p.file))].map(file=>manifest.pages[file]).filter(Boolean).filter(s=>safeScan(s.full)).map(s=>({file:s.file,page:s.page??null,full:s.full}));
      const pages=[...new Set(parts.map(p=>p.page).filter(Number.isInteger))].sort((a,b)=>a-b);
      const digest=field==='headnote'?await hash(original):src.sha;
      const url=PUBLIC+'#/d/'+d.id+'?'+new URLSearchParams({mode:'quote',field,at:ev.start,end:ev.end,sha:digest});
      return {decision:d.id,field,start:ev.start,end:ev.end,text:literal,source_sha256:digest,pages,scans,url,
        incomplete_pages:parts.some(p=>p.page==null),warning:ev.source_warning||''};
    }
    async function compile(raw,result) {
      const s=state(raw),stamp=await corpus,issues=[];
      if(/(?:^|\s)(?:не|ни|без|кроме|исключая|только|лишь)(?:\s|[.,?!]|$)/i.test(s.q+' '+s.terms))issues.push('В вопросе есть отрицание или исключение. Поиск подбирает связанные понятия; соблюдение этого условия нужно проверить по приведённым цитатам.');
      const ids=s.manual?s.ids:s.ids.length?s.ids:result.candidates.slice(0,4);
      const cases=[];
      for(const id of ids) {
        const d=docs.get(id);if(!d){issues.push('Решение '+id+' отсутствует в этой версии корпуса.');continue;}
        if(s.year&&String(d.vol)!==s.year||s.department&&d.dept!==s.department)issues.push(id+': добавлено вручную вне поискового фильтра. Фильтры ограничивают подбор кандидатов; выбранное дело оставлено для сравнения.');
        const src=await source(d),changed=Boolean(s.hashes[id]&&s.hashes[id]!==src.sha),sections=[],fragments=[];
        if(changed)issues.push(id+': текст изменился после сохранения справки; показана текущая версия, прежние координаты не перенесены.');
        let analysis=adapter.analysisOf?await adapter.analysisOf(id):adapter.analyses.decisions[id];
        if(!analysis)analysis=adapter.guides.guides.flatMap(g=>g.comparison?.cases||[]).find(c=>c.id===id);
        if(analysis) {
          if(analysis.source_sha256!==src.sha)issues.push(id+': подробный разбор устарел и не включён.');
          else for(const section of analysis.sections) {
            try {
              const evidence=await Promise.all(section.evidence.map(ev=>quote(d,ev,src)));
              if(evidence.length)sections.push({heading:section.heading,speaker:section.speaker,summary:section.summary,kind:kind(section),evidence});
            }catch(err){issues.push(err.message);}
          }
        }
        const matching=result.hits.filter(h=>h.passage.decision===id).slice(0,3),selected=[];
        for(const hit of matching)for(const p of [hit.passage,...(hit.context||[])])if(!selected.some(x=>x.p.id===p.id))selected.push({p,neighbor:p.id!==hit.passage.id,partial:Boolean(hit.partial)});
        if(!selected.length)for(const p of (byCase.get(id)||[]).slice(0,2))selected.push({p,neighbor:false,partial:false,browsing:true});
        for(const item of selected.slice(0,5)) {
          const p=byId.get(item.p.id);if(!p)continue;
          const original=src.cp.slice(p.start,p.end).join('');
          if(await hash(original)!==p.sha256){issues.push(id+': устаревший пассаж пропущен.');continue;}
          const validAI=p.ai?.summary&&typeof p.ai.evidence==='string'&&p.ai.evidence.length>0&&original.includes(p.ai.evidence);
          const evidence=await quote(d,{start:p.start,end:p.end,source_warning:p.ai?.source_warning},src);
          fragments.push({summary:validAI?p.ai.summary:'',speaker:'Автор позиции в этом фрагменте отдельно не размечен',evidence,
            concepts:validAI?(p.ai.concepts||[]):[],neighbor:item.neighbor,partial:item.partial,browsing:Boolean(item.browsing)});
        }
        const manifest=await adapter.loadScans(d.vol),pages=[...new Set((manifest.decisions[id]||[]).map(f=>manifest.pages[f]?.page).filter(Number.isInteger))].sort((a,b)=>a-b);
        const headnote=await quote(d,{start:0,end:Array.from(d.headnote).length},src,'headnote');
        cases.push({id,year:d.vol,number:d.num,department:d.dept,date:d.date_label||d.date||'Дата не определена',headnote:d.headnote,
          source_sha256:src.sha,changed,pages,url:PUBLIC+'#/d/'+id,headnote_evidence:headnote,
          outcome:d.outcome||'Не размечен',statutes:Object.keys(d.statutes||{}),sections,fragments,note:s.notes.cases[id]||'',
          warning:(adapter.analytics.source_warnings?.[id]?.messages||[]).join(' '),restored:Boolean(adapter.analytics.source_revisions?.[id])});
      }
      const selected=new Set(cases.map(c=>c.id)),comparisons=[];
      for(const guide of adapter.guides.guides) {
        const comp=guide.comparison;if(!comp||!comp.cases.every(c=>selected.has(c.id)))continue;
        for(const row of comp.comparisons) {
          try {
            const evidence=await Promise.all(row.evidence.map(async ev=>{
              const d=docs.get(ev.decision),src=await source(d);
              if(comp.cases.find(c=>c.id===d.id).source_sha256!==src.sha)throw Error('Сравнительный разбор устарел.');
              return quote(d,ev,src);
            }));
            comparisons.push({heading:row.heading,summary:row.summary,evidence,scope:comp.scope,limits:comp.limits});
          }catch(err){issues.push(err.message);}
        }
      }
      const sharedStatutes=[];
      for(const statute of new Set(cases.flatMap(c=>c.statutes))) {
        if(statute.split(' ')[0]==='?')continue;
        const ids=cases.filter(c=>c.statutes.includes(statute)).map(c=>c.id);
        if(ids.length>1)sharedStatutes.push({statute,ids});
      }
      const final=state({...s,manual:true,ids:cases.map(c=>c.id),hashes:Object.fromEntries(cases.map(c=>[c.id,c.source_sha256])),corpus:stamp});
      return {format:'senat-research',version:1,created_at:new Date().toISOString(),state:final,
        title:s.title||s.q||'Сравнение решений Сената',question:s.q,terms:s.terms||s.q,notes:final.notes,
        corpus:stamp,corpus_changed:Boolean(s.corpus&&s.corpus!==stamp),scope:adapter.meta.volumes.map(v=>({year:v.year,department:v.dept,decisions:v.decisions})),
        cases,comparisons,shared_statutes:sharedStatutes,issues:[...new Set(issues)],
        coverage:{selected:cases.length,analysed:cases.filter(c=>c.sections.length).length,matched:result.candidates.length,
          partial:cases.some(c=>c.fragments.some(f=>f.partial))},
        notice:'Справка собрана из опубликованных редакционных разборов и пояснений ИИ. Цитаты сверены с текущим текстом OCR. Отдельные фрагменты не атрибутированы как позиция Сената; автоматические метки исхода и норм показаны отдельно. Корпус охватывает четыре отдельных тома и не представляет всю практику Сената. Историческое решение не устанавливает правило действующего права.'};
    }
    return {compile,corpus};
  }
  function importState(raw) {
    if(typeof raw!=='string'||new TextEncoder().encode(raw).length>LIMITS.file)throw Error('Файл справки превышает 2 МБ.');
    let data;try{data=JSON.parse(raw);}catch(_){throw Error('Не удалось прочитать JSON справки.');}
    if(!object(data)||data.format!=='senat-research'||data.version!==1)throw Error('Это не JSON-файл исследовательской справки.');
    // Поля с цитатами и выводами из чужого файла не исполняем и не принимаем:
    // восстановление выполняется по текущему корпусу и SHA выбранных дел.
    return state(data.state);
  }
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const md=s=>esc(s).replace(/[\\`*_{}\[\]()#+.!|>-]/g,'\\$&');
  const quoteMD=q=>q.text.split('\n').map(s=>'> '+md(s)).join('\n');
  function scanLinks(q) {return q.scans.filter(s=>safeScan(s.full)).map(s=>({label:'Скан'+(s.page==null?'':', с. '+s.page),url:PUBLIC+s.full}));}
  const label=c=>c.year+' г. № '+c.number;
  const ROWS=[['facts','Обстоятельства и предмет'],['party','Доводы участников'],['lower','Предшествующее рассмотрение'],['question','Вопрос Сената'],['reason','Рассуждение Сената'],['holding','Постановление'],['limits','Пределы вывода']];
  function markdown(report) {
    const out=['# '+md(report.title),'',md(report.notice),'','Вопрос: '+md(report.question),'Поисковая формулировка: '+md(report.terms),
      'Тома: '+report.scope.map(v=>v.year+' ('+md(v.department)+')').join('; '),
      'Подробных разборов в выбранных делах: '+report.coverage.analysed+' из '+report.cases.length+'.',
      'Снимок корпуса: `'+report.corpus+'`',''];
    if(report.notes.general)out.push('## Заметка читателя',md(report.notes.general),'');
    for(const issue of report.issues)out.push('Ограничение: '+md(issue),'');
    if(report.cases.length>1){
      const cell=s=>md(s).replace(/\r?\n/g,' ');
      out.push('## Сравнение по существу','',
        '| Элемент дела | '+report.cases.map(c=>cell(label(c)+' · '+c.department)).join(' | ')+' |',
        '|---|'+report.cases.map(()=>'---|').join(''));
      for(const [kind,title] of ROWS)out.push('| '+title+' | '+report.cases.map(c=>cell(c.sections.filter(s=>s.kind===kind).map(s=>s.speaker+': '+s.summary).join(' ')||'Подробный разбор не подготовлен.')).join(' | ')+' |');
      out.push('| Исход (автоматическая метка) | '+report.cases.map(c=>cell(c.outcome)).join(' | ')+' |',
        '| Упоминания норм (метки корпуса) | '+report.cases.map(c=>cell(c.statutes.join('; ')||'Нет меток')).join(' | ')+' |','');
    }
    function evidence(q){out.push(quoteMD(q),'',md(pageLabel(q)), '[Открыть точную цитату](<'+q.url+'>)',...scanLinks(q).map(s=>'['+md(s.label)+'](<'+s.url+'>)'), '');}
    for(const c of report.cases) {
      out.push('## '+label(c)+' · '+md(c.department),'',md(c.headnote),'','[Полное решение](<'+c.url+'>)',
        'Дата: '+md(c.date)+'. Исход (автоматическая метка): '+md(c.outcome)+'.',
        'Упоминания норм (метки корпуса): '+md(c.statutes.join('; ')||'Нет меток')+'.','');
      if(c.warning)out.push(md(c.warning),'');
      if(c.note)out.push('### Заметка читателя',md(c.note),'');
      if(!c.sections.length)out.push('Подробный разбор не подготовлен; ниже — фрагменты для чтения, без атрибуции позиции.','');
      for(const section of c.sections){out.push('### '+md(section.heading),md(section.speaker),'',md(section.summary),'');section.evidence.forEach(evidence);}
      for(const f of c.fragments){out.push('### Фрагмент по вопросу',f.neighbor?'Соседний контекст.':'',md(f.speaker),f.summary?'Пояснение ИИ: '+md(f.summary):'','');evidence(f.evidence);}
    }
    for(const comparison of report.comparisons){out.push('## '+md(comparison.heading),md(comparison.summary),'',md(comparison.limits),'');comparison.evidence.forEach(evidence);}
    out.push('Изображения и ссылки на сайт требуют интернета. Текст справки доступен в этом файле.');
    return out.join('\n');
  }
  function html(report) {
    const link=(name,url)=>'<a href="'+esc(url)+'" rel="noopener noreferrer">'+esc(name)+'</a>';
    const evidence=q=>'<details open><summary>'+esc(pageLabel(q))+'</summary><blockquote>'+esc(q.text)+'</blockquote><p>'+link('Открыть точную цитату',q.url)+' '+scanLinks(q).map(s=>link(s.label,s.url)).join(' · ')+'</p></details>';
    const summaryCell=(c,kind)=>{
      if(kind==='headnote')return '<p>'+esc(c.headnote)+'</p>'+evidence(c.headnote_evidence);
      if(kind==='outcome')return esc(c.outcome);
      if(kind==='statutes')return esc(c.statutes.join('; ')||'Нет меток');
      if(kind==='note')return '<p>'+esc(c.note||'Нет заметки')+'</p>';
      const parts=c.sections.filter(s=>s.kind===kind);
      return parts.length?parts.map(s=>'<p><strong>'+esc(s.speaker)+'</strong></p><p>'+esc(s.summary)+'</p>'+s.evidence.map(evidence).join('')).join(''):'Подробный разбор этого элемента не подготовлен.';
    };
    return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(report.title)+'</title><style>body{font:16px/1.6 system-ui;margin:32px auto;padding:0 20px;max-width:1200px;color:#171717}a{color:#175a99}blockquote{white-space:pre-wrap;border-left:3px solid #ccc;margin:14px 0;padding-left:14px;font-family:Georgia,serif}p{white-space:pre-wrap;overflow-wrap:anywhere}article{margin:32px 0;border-top:1px solid #ccc;padding-top:16px}.table-wrap{overflow:auto}table{border-collapse:collapse;min-width:680px;width:100%}th,td{border:1px solid #bbb;padding:12px;vertical-align:top;min-width:220px}th:first-child{min-width:140px}details{margin:12px 0}summary{font-weight:600}@media print{body{max-width:none;padding:0;font-size:10pt}a{color:inherit}details{display:block}table{min-width:0;font-size:8pt}th,td{min-width:0}blockquote{break-inside:avoid}.table-wrap{overflow:visible}}</style><h1>'+esc(report.title)+'</h1><p>'+esc(report.notice)+'</p><p>Вопрос: '+esc(report.question)+'<br>Поисковая формулировка: '+esc(report.terms)+'</p><p>Тома: '+report.scope.map(v=>esc(v.year+' · '+v.department)).join('; ')+'. Подробных разборов: '+report.coverage.analysed+' из '+report.cases.length+'.</p>'+report.issues.map(x=>'<p>Ограничение: '+esc(x)+'</p>').join('')+(report.notes.general?'<h2>Заметка читателя</h2><p>'+esc(report.notes.general)+'</p>':'')+
      (report.cases.length>1?'<h2>Сравнение по существу</h2><div class="table-wrap"><table><thead><tr><th>Элемент дела</th>'+report.cases.map(c=>'<th>'+esc(label(c)+' · '+c.department)+'</th>').join('')+'</tr></thead><tbody>'+[['headnote','Предмет по заголовку'],...ROWS,['outcome','Исход (автоматическая метка)'],['statutes','Упоминания норм (метки корпуса)'],['note','Заметка читателя']].map(([kind,title])=>'<tr><th>'+title+'</th>'+report.cases.map(c=>'<td>'+summaryCell(c,kind)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'')+
      report.cases.map(c=>'<article><h2>'+link(label(c)+' · '+c.department,c.url)+'</h2><p>'+esc(c.headnote)+'</p><p>Дата: '+esc(c.date)+'. Исход (автоматическая метка): '+esc(c.outcome)+'.</p><p>Упоминания норм (метки корпуса): '+esc(c.statutes.join('; ')||'Нет меток')+'</p>'+(c.note?'<h3>Заметка читателя</h3><p>'+esc(c.note)+'</p>':'')+(c.warning?'<p>'+esc(c.warning)+'</p>':'')+c.sections.map(s=>'<h3>'+esc(s.heading)+'</h3><p><strong>'+esc(s.speaker)+'</strong></p><p>'+esc(s.summary)+'</p>'+s.evidence.map(evidence).join('')).join('')+c.fragments.map(f=>'<h3>Фрагмент по вопросу'+(f.neighbor?' · соседний контекст':'')+'</h3><p>'+esc(f.speaker)+'</p><p>Пояснение ИИ: '+esc(f.summary)+'</p>'+evidence(f.evidence)).join('')+'</article>').join('')+
      report.comparisons.map(c=>'<h2>'+esc(c.heading)+'</h2><p>'+esc(c.summary)+'</p>'+c.evidence.map(evidence).join('')+'<p>'+esc(c.limits)+'</p>').join('')+
      '<footer><p>Снимок корпуса: '+esc(report.corpus)+'</p><p>Изображения и ссылки на сайт требуют интернета. Текст справки доступен в этом файле.</p></footer></html>';
  }
  return {PUBLIC,LIMITS,ROWS,state,hash,encode,decode,shareURL,suggestTerms,find,context,importState,markdown,html,pageLabel,scanLinks,cut};
});
