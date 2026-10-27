/* Географические фильтры: одно дело не превращается в несколько из-за повторов. */
const assert=require('node:assert/strict'),P=require('../places.js');
const meta={decisions:[
 {id:'1904-001',i:0,vol:1904,topic_ids:['family','contracts']},
 {id:'1904-002',i:1,vol:1904,topic_ids:['family']},
 {id:'1905-001',i:2,vol:1905,topic_ids:['contracts']}
]};
const mention=(id,place_id,decision_id,role)=>({id,place_id,decision_id,year:Number(decision_id.slice(0,4)),role,quote:'Въ Петровкѣ.',start:100,end:112,mention_start:103,mention_end:111});
const data={places:[
 {id:'petersburg',historical_name:'С.-Петербург',modern_name:'Санкт-Петербург',aliases:['Петербург'],lat:59.94,lon:30.31},
 {id:'vilna',historical_name:'Вильна',modern_name:'Вильнюс',aliases:['Вильно'],lat:54.69,lon:25.28}
],mentions:[
 mention('a','petersburg','1904-001','court'),mention('b','petersburg','1904-001','event_property'),
 mention('c','petersburg','1904-002','court'),mention('d','vilna','1904-001','person_organization'),
 mention('e',null,'1905-001','mention_unclear'),mention('f','vilna','1905-001','event_property')
]};
const select=filters=>P.select(data,meta,P.state(filters));
let s=select({});assert.equal(s.points.length,2);assert.equal(s.decisionCount,3);assert.equal(s.coverageDecisions,3);
assert.equal(s.points.find(p=>p.place.id==='petersburg').decisionIds.length,2);assert.equal(s.points.find(p=>p.place.id==='petersburg').mentions.length,3);
assert.equal(s.cases.find(c=>c.doc.id==='1904-001').mentions.length,3);assert.equal(s.unresolved.length,1);
s=select({y:'1904',t:'contracts',role:'court'});assert.deepEqual(s.cases.map(c=>c.doc.id),['1904-001']);assert.equal(s.points.length,1);
s=select({p:'vilna'});assert.deepEqual(s.cases.map(c=>c.doc.id),['1904-001','1905-001']);assert.equal(s.points.length,2,'Выбор точки не подменяет общий набор точек фильтра');
s=select({u:'1'});assert.equal(s.points.length,0);assert.deepEqual(s.cases.map(c=>c.doc.id),['1905-001']);assert.equal(s.unresolved.length,1);
assert.equal(select({q:'Вильнюсе'}).points[0].place.id,'vilna');assert.equal(select({q:'Санкт-Петербург'}).points[0].place.id,'petersburg');
assert.equal(select({q:'Вильно'}).points[0].place.id,'vilna');assert.equal(select({q:'Петровке',u:'1'}).cases.length,1);
assert.equal(select({role:'invented'}).cases.length,0);assert.equal(select({p:'not-in-selection'}).cases.length,0);
assert(!P.validPoint({lat:91,lon:30}));assert(!P.validPoint({lat:30,lon:Infinity}));assert(!P.validPoint({lat:'59',lon:30}));
const invalid=structuredClone(data);invalid.places[0].lat=null;assert.equal(P.select(invalid,meta,P.state({})).unresolved.length,4);
assert.equal(P.mentionName(data.mentions[0]),'Петровкѣ');
assert.deepEqual(P.state(new URLSearchParams('q=+Вильно+&y=1904&t=family&role=court&u=1&p=vilna')),{q:'Вильно',y:'1904',t:'family',role:'court',u:'1',p:'vilna'});
console.log('Places checks passed: distinct decisions, combined filters, aliases, unresolved places and point selection.');
