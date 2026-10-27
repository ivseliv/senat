/* География корпуса: точки населённых пунктов, проверяемые упоминания и список дел. */
(function(root,factory){
  const api=factory(typeof module!=='undefined'&&module.exports?require('./lex.js'):root.Lex);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SenatPlaces=api;
})(typeof window!=='undefined'?window:globalThis,function(Lex){
  'use strict';
  const unique=values=>[...new Set(values)];
  const words=text=>Lex.stems(String(text||''));
  const validPoint=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
  const plural=(n,a,b,c)=>n%100>10&&n%100<20?c:n%10===1?a:n%10>1&&n%10<5?b:c;
  function state(params){
    const get=key=>params instanceof URLSearchParams?params.get(key):params[key];
    return {q:String(get('q')||'').trim(),y:String(get('y')||''),t:String(get('t')||''),role:String(get('role')||''),p:String(get('p')||''),u:get('u')==='1'?'1':''};
  }
  function mentionName(m){
    const offset=m.mention_start-m.start,end=m.mention_end-m.start;
    if(Number.isInteger(offset)&&offset>=0&&end>offset&&end<=Array.from(m.quote||'').length)return Array.from(m.quote).slice(offset,end).join('');
    return m.mention||m.display_name||m.historical_name||m.name||'Название не установлено';
  }
  function select(data,meta,filters){
    const places=new Map(data.places.map(p=>[p.id,p])),docs=new Map(meta.decisions.map(d=>[d.id,d])),query=words(filters.q);
    const matches=m=>{
      const p=places.get(m.place_id),d=docs.get(m.decision_id);
      if(!d||filters.y&&String(m.year)!==filters.y||filters.t&&!(d.topic_ids||[]).includes(filters.t)||filters.role&&m.role!==filters.role)return false;
      if(filters.u&&validPoint(p))return false;
      if(!filters.q)return true;
      const candidate=new Set(words(p?[p.historical_name,p.modern_name,...(p.aliases||[])].join(' '):mentionName(m)));
      return query.length>0&&query.every(w=>candidate.has(w));
    };
    const mentions=data.mentions.filter(matches),groups=new Map(),unresolved=[];
    for(const m of mentions){
      const place=places.get(m.place_id);
      if(!validPoint(place)){unresolved.push(m);continue;}
      if(!groups.has(place.id))groups.set(place.id,{place,mentions:[],decisionIds:[]});
      groups.get(place.id).mentions.push(m);
    }
    const points=[...groups.values()].map(g=>({...g,decisionIds:unique(g.mentions.map(m=>m.decision_id))}));
    points.sort((a,b)=>b.decisionIds.length-a.decisionIds.length||a.place.historical_name.localeCompare(b.place.historical_name,'ru'));
    const selected=filters.p?points.find(p=>p.place.id===filters.p):null;
    const visible=filters.p?(selected?.mentions||[]):mentions,cases=new Map();
    for(const m of visible){if(!cases.has(m.decision_id))cases.set(m.decision_id,{doc:docs.get(m.decision_id),mentions:[]});cases.get(m.decision_id).mentions.push(m);}
    return {mentions,points,unresolved,selected,cases:[...cases.values()].sort((a,b)=>a.doc.i-b.doc.i),
      decisionCount:unique(mentions.map(m=>m.decision_id)).length,coverageDecisions:unique(data.mentions.map(m=>m.decision_id)).length};
  }
  function create(adapter){
    const $=id=>document.getElementById(id),h=(tag,attrs,...children)=>{
      const el=document.createElement(tag);
      for(const [key,value] of Object.entries(attrs||{})){
        if(value==null||value===false)continue;
        if(key.startsWith('on'))el.addEventListener(key.slice(2),value);else if(key==='class')el.className=value;else el.setAttribute(key,value===true?'':String(value));
      }
      for(const child of children.flat(Infinity))if(child!=null&&child!==false)el.append(child.nodeType?child:document.createTextNode(String(child)));
      return el;
    };
    let promise=null,data=null,token=0,current=state({}),map=null,markers=null,land=null,basemapPromise=null,basemapFailed=false;
    let markerKey='',lastSelected='',markersById=new Map(),shown=20,listingKey='';
    const replace=(id,...children)=>$(id).replaceChildren(...children.filter(child=>child!=null));
    const load=()=>promise||(promise=adapter.loadJSON('geography.json').then(value=>{
      if(value.schema_version!==1||!Array.isArray(value.places)||!Array.isArray(value.mentions))throw Error('Неизвестный формат географических данных');
      return data=value;
    }).catch(error=>{promise=null;throw error;}));
    const navigate=next=>{location.hash='#/places'+(Object.entries(next).some(([,v])=>v)?'?'+new URLSearchParams(Object.entries(next).filter(([,v])=>v)):'');};
    const link=next=>'#/places?'+new URLSearchParams(Object.entries(next).filter(([,v])=>v));
    const roleLabel=role=>data.roles[role]||'Роль не установлена';
    const caseCount=n=>n+' '+plural(n,'решение','решения','решений');
    const modernLabel=p=>p.modern_name&&p.modern_name!==p.historical_name?'Современное название: '+p.modern_name:'';
    function fill(id,rows,empty,value){$(id).replaceChildren(h('option',{value:''},empty),...rows.map(([key,label])=>h('option',{value:key},label)));$(id).value=value;}
    function sourceDescription(p){
      const raw=p.coordinate_source,source=typeof raw==='string'?raw:raw?.url||raw?.title||'';
      const label=typeof raw==='object'&&raw?.title?raw.title:'Источник координат';
      const identity=typeof p.identity_source==='string'?p.identity_source:p.identity_source?.url||'';
      return h('p',{class:'muted small'},/^https?:\/\//i.test(source)?h('a',{href:source,target:'_blank',rel:'noopener noreferrer'},label):source,
        p.coordinate_note?(source?' · ':'')+p.coordinate_note:'',
        /^https?:\/\//i.test(identity)?[' · ',h('a',{href:identity,target:'_blank',rel:'noopener noreferrer'},'Отождествление названия')]:null);
    }
    function popup(group){
      const p=group.place;
      return h('div',{class:'places-popup'},h('strong',{},p.historical_name),modernLabel(p)?h('p',{},modernLabel(p)):null,
        h('p',{},caseCount(group.decisionIds.length)+' в текущей выборке.'),h('p',{class:'small'},'Точка населённого пункта; точный адрес не устанавливается.'),
        h('button',{type:'button',class:'btn ghost',onclick:()=>{navigate({...current,p:p.id});$('places-cases-heading').scrollIntoView({block:'start',behavior:'auto'});}},'Перейти к делам'));
    }
    function ensureMap(){
      if(map)return true;
      if(!window.L?.map){$('places-map-note').textContent='Карта недоступна. Все населённые пункты, дела и источники доступны в списке ниже.';return false;}
      try{
        map=window.L.map($('places-map'),{scrollWheelZoom:false,attributionControl:true,zoomControl:false,minZoom:1,maxZoom:11}).setView([54,45],3);
        window.L.control.zoom({position:'topright',zoomInTitle:'Приблизить',zoomOutTitle:'Отдалить'}).addTo(map);
        window.L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
        map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>');
        map.attributionControl.addAttribution('Natural Earth · очертания суши');
        markers=window.L.layerGroup().addTo(map);
        $('places-map').setAttribute('aria-label','Карта населённых пунктов. Тот же состав доступен в списке; выбор точки открывает связанные дела.');
        return true;
      }catch(error){$('places-map-note').textContent='Не удалось открыть карту. Используйте список населённых пунктов и дел.';return false;}
    }
    async function basemap(){
      if(!map||land||basemapPromise)return basemapPromise;
      basemapPromise=adapter.loadJSON('geo-basemap.json').then(geo=>{
        land=window.L.geoJSON(geo,{interactive:false,style:{className:'places-land',weight:0.6,color:'#b0b5b8',fillColor:'#e6e8e3',fillOpacity:1}}).addTo(map);
        land.bringToBack();basemapFailed=false;$('places-map-note').textContent='Очертания суши помогают ориентироваться. Современные государственные границы и адреса не показаны.';
      }).catch(()=>{basemapFailed=true;$('places-map-note').replaceChildren(h('span',{},'Контур суши недоступен; точки и список остаются доступны. '),h('button',{type:'button',class:'btn ghost',onclick:()=>{basemapPromise=null;basemap();}},'Повторить загрузку фона'));});
      return basemapPromise;
    }
    function drawMap(model){
      if(!ensureMap())return;
      map.invalidateSize({pan:false});basemap();
      const key=JSON.stringify(model.points.map(g=>[g.place.id,g.decisionIds]));
      if(key!==markerKey){
        markerKey=key;markers.clearLayers();markersById=new Map();
        for(const group of model.points){
          const p=group.place,marker=window.L.circleMarker([p.lat,p.lon],{radius:7,weight:2,color:'#145b99',fillColor:'#2a78d6',fillOpacity:0.85,className:'places-marker'}).addTo(markers);
          marker.bindTooltip(p.historical_name+' · '+caseCount(group.decisionIds.length),{direction:'top'});
          marker.bindPopup(popup(group),{autoPan:false,maxWidth:280});
          marker.on('click',()=>navigate({...current,p:p.id,u:''}));
          const el=marker.getElement();if(el){el.setAttribute('tabindex','0');el.setAttribute('role','button');el.setAttribute('aria-label',p.historical_name+': '+caseCount(group.decisionIds.length)+'. Показать дела.');el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();navigate({...current,p:p.id,u:''});}});}
          markersById.set(p.id,marker);
        }
        if(model.points.length){map.fitBounds(window.L.latLngBounds(model.points.map(g=>[g.place.lat,g.place.lon])),{padding:[24,24],maxZoom:6,animate:false});}
      }
      for(const [id,marker] of markersById){const selected=id===current.p;marker.setStyle({radius:selected?10:7,weight:selected?3:2,fillOpacity:selected?1:0.85});marker.getElement()?.setAttribute('aria-pressed',String(selected));}
      if(current.p!==lastSelected){
        lastSelected=current.p;const marker=markersById.get(current.p);
        if(marker){map.panTo(marker.getLatLng(),{animate:false});marker.openPopup();}else map.closePopup();
      }
      $('places-fit').onclick=()=>{if(model.points.length)map.fitBounds(window.L.latLngBounds(model.points.map(g=>[g.place.lat,g.place.lon])),{padding:[24,24],maxZoom:6,animate:false});};
      $('places-fit').disabled=!model.points.length;
      const europe=model.points.filter(g=>g.place.lon>=-25&&g.place.lon<=65&&g.place.lat>=34&&g.place.lat<=72);
      $('places-europe').onclick=()=>{if(europe.length)map.fitBounds(window.L.latLngBounds(europe.map(g=>[g.place.lat,g.place.lon])),{padding:[24,24],maxZoom:6,animate:false});};
      $('places-europe').disabled=!europe.length;
    }
    function cards(model){
      const selected=model.selected?.place;
      $('places-cases-heading').textContent=selected?'Дела: '+selected.historical_name:current.u?'Упоминания без точки на карте':'Дела текущей выборки';
      replace('places-selection',selected?h('div',{},modernLabel(selected)?h('p',{},modernLabel(selected)):null,sourceDescription(selected),
        h('a',{class:'chip',href:link({...current,p:''})},'Все населённые пункты этой выборки')):current.p?h('p',{class:'preliminary-note'},'Выбранный населённый пункт не входит в текущую выборку. ',h('a',{href:link({...current,p:''})},'Снять выбор точки')):null);
      $('places-cases-count').textContent=caseCount(model.cases.length)+'; показано '+Math.min(shown,model.cases.length)+'. Упоминания одного дела объединены в карточке.';
      const list=model.cases.slice(0,shown).map(({doc,mentions})=>{
        const origin={mode:'places',...current};
        return h('article',{class:'card places-case','data-id':doc.id},h('h4',{},h('a',{href:'#/d/'+doc.id+'?'+new URLSearchParams(origin)},`${doc.vol} г. № ${doc.num}`)),
          h('p',{class:'muted small'},doc.dept),h('p',{class:'places-headnote'},adapter.modernize?adapter.modernize(doc.headnote):doc.headnote),
          ...mentions.map(m=>{
            const place=data.places.find(p=>p.id===m.place_id),ev={...m,text:m.quote};
            return h('section',{class:'places-mention','data-mention':m.id},h('p',{class:'places-role'},
              place?h('a',{href:link({...current,p:place.id,u:''})},place.historical_name):mentionName(m),' · '+roleLabel(m.role)),
              m.role_note?h('p',{class:'muted small'},m.role_note):null,
              !validPoint(place)?h('p',{class:'preliminary-note small'},'Без точки на карте: '+(m.unresolved_reason||'Координаты или населённый пункт не установлены.')):null,
              adapter.sourceEvidence(doc.id,ev,{...origin,geo:m.id}));
          }));
      });
      replace('places-cases',...list,!list.length?h('p',{class:'empty'},'По этим фильтрам упоминаний не найдено. Снимите часть ограничений. Отсутствие точки не доказывает отсутствия места в корпусе.'):null);
      $('places-more').hidden=shown>=model.cases.length;$('places-more').onclick=()=>{shown+=20;cards(model);};
    }
    async function render(params){
      const my=++token;current=state(params);current.t=adapter.topicId?adapter.topicId(current.t):current.t;
      const key=JSON.stringify(current);if(key!==listingKey){listingKey=key;shown=20;}
      $('places-status').textContent='Загрузка географических упоминаний…';
      try{
        await load();if(my!==token||$('view-places').hidden)return;
        fill('places-year',adapter.meta.volumes.map(v=>[String(v.year),String(v.year)+' · '+v.dept]),'Все тома',current.y);
        fill('places-topic',adapter.topicList().map(t=>[t.id,t.title]),'Все темы',current.t);
        fill('places-role',Object.entries(data.roles),'Все роли упоминания',current.role);
        $('places-q').value=current.q;$('places-unmapped').checked=current.u==='1';
        $('places-export-json').onclick=()=>download(data,'senat-geography.json');
        $('places-export-geojson').onclick=()=>download({type:'FeatureCollection',schema_version:data.schema_version,method:data.method,coverage:data.coverage,
          features:data.places.filter(validPoint).map(p=>{const mentions=data.mentions.filter(m=>m.place_id===p.id),{lat,lon,...properties}=p;return {type:'Feature',id:p.id,geometry:{type:'Point',coordinates:[lon,lat]},properties:{...properties,decision_ids:unique(mentions.map(m=>m.decision_id)),mention_ids:mentions.map(m=>m.id)}};})},'senat-geography.geojson');
        $('places-method').textContent=data.method||data.coverage?.note||'Выборочная разметка упоминаний по опубликованному тексту. Сплошная географическая экспертиза корпуса не проводилась.';
        $('places-list-jump').onclick=event=>{event.preventDefault();$('places-list-heading').focus();};
        const submit=()=>navigate({q:$('places-q').value.trim(),y:$('places-year').value,t:$('places-topic').value,role:$('places-role').value,u:$('places-unmapped').checked?'1':''});
        $('places-form').onsubmit=e=>{e.preventDefault();submit();};
        for(const id of ['places-year','places-topic','places-role','places-unmapped'])$(id).onchange=submit;
        const model=select(data,adapter.meta,current),unresolvedCases=unique(model.unresolved.map(m=>m.decision_id)).length;
        const yearCoverage=data.coverage?.by_year?.[current.y];
        $('places-coverage').textContent=(yearCoverage?`В томе ${current.y}: ${caseCount(yearCoverage.decisions)} с разметкой из ${yearCoverage.total}. `:'')+`Всего в разметке ${caseCount(model.coverageDecisions)} из ${adapter.meta.decisions.length} решений корпуса. Это выборочная разметка: отсутствие отметки не означает отсутствия географического упоминания.`;
        $('places-status').textContent=`По фильтрам: ${caseCount(model.decisionCount)}, ${model.points.length} ${plural(model.points.length,'населённый пункт','населённых пункта','населённых пунктов')} на карте. Без точки: ${caseCount(unresolvedCases)}. Числа по пунктам могут пересекаться.`;
        const focusedPlace=document.activeElement?.classList.contains('places-select')?document.activeElement.dataset.place:null;
        $('places-list').replaceChildren(...model.points.map(group=>h('li',{},h('button',{type:'button',class:'places-select','aria-controls':'places-cases','aria-pressed':String(current.p===group.place.id),'data-place':group.place.id,onclick:()=>navigate({...current,p:group.place.id,u:''})},
          h('span',{},h('strong',{},group.place.historical_name),modernLabel(group.place)?h('span',{class:'small muted'},modernLabel(group.place)):null),h('span',{class:'places-count'},caseCount(group.decisionIds.length))))));
        if(focusedPlace)[...$('places-list').querySelectorAll('button')].find(button=>button.dataset.place===focusedPlace)?.focus({preventScroll:true});
        $('places-list-empty').hidden=Boolean(model.points.length);
        $('places-unresolved').hidden=!model.unresolved.length;
        $('places-unresolved-summary').textContent='Без точки на карте: '+model.unresolved.length+' '+plural(model.unresolved.length,'упоминание','упоминания','упоминаний');
        replace('places-unresolved-list',...model.unresolved.slice(0,12).map(m=>h('li',{},mentionName(m)+' · '+m.year+' г. № '+Number(m.decision_id.split('-')[1])+': '+(m.unresolved_reason||'Точное место не установлено.'))),
          model.unresolved.length>12?h('li',{},'Остальные упоминания доступны в карточках дел ниже.'):null);
        $('places-only-unresolved').href=link({...current,p:'',u:'1'});
        cards(model);drawMap(model);
        if(!basemapFailed&&map&&!land)$('places-map-note').textContent='Загрузка очертаний суши…';
      }catch(error){if(my===token){$('places-status').textContent='Не удалось загрузить географические упоминания: '+error.message;$('places-cases').replaceChildren(h('button',{type:'button',class:'btn',onclick:()=>render(params)},'Повторить загрузку'));}}
    }
    async function resolveEvidence(params,decision){
      await load();const id=params.get('geo');
      return data.mentions.find(m=>m.id===id&&m.decision_id===decision&&String(m.start)===params.get('at')&&String(m.end)===params.get('end'))||null;
    }
    function download(value,name){
      const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:name.endsWith('.geojson')?'application/geo+json':'application/json'}));
      const anchor=h('a',{href:url,download:name});document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    return {render,resolveEvidence,cancel:()=>{token++;}};
  }
  return {state,select,mentionName,validPoint,create};
});
