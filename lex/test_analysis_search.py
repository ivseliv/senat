"""Поиск всех разборов, виды позиций и единый состав редакционных тем."""
import copy
import json
import subprocess
import unittest
from pathlib import Path

import analysis_search
from decision_analyses import read
from topic_navigation import apply_catalog

LEX = Path(__file__).resolve().parent


class EditorialSearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=read(LEX/'data/topic-catalog.json')
        cls.analyses=read(LEX/'data/decision-analyses.json')
        cls.meta=read(LEX/'data/meta.json')
        cls.data=analysis_search.build(cls.analyses,cls.catalog,cls.meta)

    def test_every_case_and_section_is_searchable_with_unchanged_quotes(self):
        self.assertEqual(set(self.data['decisions']),set(self.analyses['decisions']))
        self.assertEqual(self.data['count'],384)
        self.assertEqual(self.data['section_count'],sum(len(d['sections']) for d in self.analyses['decisions'].values()))
        for row in self.data['sections']:
            source=self.analyses['decisions'][row['decision']]['sections'][row['section']]
            self.assertEqual(row['quotes'],[e['text'] for e in source['evidence']])
            self.assertEqual(row['evidence'],[{k:e[k] for k in ('start','end','printed_pages')} for e in source['evidence']])
        for ident in self.data['decisions']:
            self.assertEqual({r['kind'] for r in self.data['sections'] if r['decision']==ident},set(analysis_search.KINDS))

    def test_section_roles_are_closed_and_do_not_confuse_party_with_senate(self):
        self.assertEqual(analysis_search.section_kind('Жалоба и предел известной позиции'),'party')
        self.assertEqual(analysis_search.section_kind('Пределы вывода'),'limits')
        self.assertEqual(analysis_search.section_kind('Что решили нижестоящие суды'),'lower')
        self.assertEqual(analysis_search.section_kind('Что постановил Сенат'),'ruling')
        with self.assertRaisesRegex(ValueError,'вид раздела'):
            analysis_search.section_kind('Неизвестное рассуждение, автоматически похожее на Сенат')

    def test_changed_quote_or_source_cannot_enter_index(self):
        source=copy.deepcopy(self.analyses)
        source['decisions']['1904-116']['sections'][0]['evidence'][0]['text']='Выдуманная цитата'
        with self.assertRaisesRegex(ValueError,'не подтверждена'):
            analysis_search.build(source,self.catalog,self.meta)
        source=copy.deepcopy(self.analyses)
        source['decisions']['1904-116']['source_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'устаревший'):
            analysis_search.build(source,self.catalog,self.meta)

    def test_one_topic_membership_and_old_routes_keep_working(self):
        meta=copy.deepcopy(self.meta);analytics=read(LEX/'data/analytics.json')
        before={d['id']:d.get('automatic_topics',d['topics']) for d in meta['decisions']}
        apply_catalog(meta,analytics,self.catalog)
        first=copy.deepcopy((meta,analytics));apply_catalog(meta,analytics,self.catalog)
        self.assertEqual(first,(meta,analytics))
        self.assertEqual(meta['topic_aliases']['Семья и брак'],'family')
        self.assertEqual(meta['topic_aliases']['Недвижимость и земля'],'property')
        self.assertEqual(meta['topic_aliases']['property-notary'],'notary')
        for t in self.catalog['topics']:
            self.assertEqual({d['id'] for d in meta['decisions'] if t['id'] in d['topic_ids']},set(t['decision_ids']))
            self.assertEqual(analytics['topics'][t['title']],t['count'])
        self.assertEqual(sum('family' in d['topic_ids'] for d in meta['decisions']),27)
        for d in meta['decisions']:self.assertEqual(d['automatic_topics'],before[d['id']])

    def test_real_queries_word_forms_hyphens_filters_and_literal_evidence(self):
        script=r'''
const assert=require('node:assert/strict'),fs=require('fs'),A=require('./analysis_search.js');
const input=JSON.parse(fs.readFileSync(0,'utf8')),data=input.data,topics=input.topics;
const glossary=JSON.parse(fs.readFileSync('./data/concepts.json','utf8')).glossary;
const engine=A.makeEngine(data,glossary),find=q=>topics.filter(t=>A.compile(q,glossary).score([t.title,t.description,...(t.keywords||[])].join(' '))>=0).map(t=>t.id);
for(const q of ['алименты','алиментов'])assert(find(q).includes('family'),q);
for(const q of ['купля-продажа','купля продажа'])assert(find(q).includes('contracts'),q);
for(const q of ['банкротства','банкротство'])assert(find(q).includes('insolvency'),q);
assert(find('срок исковой давности').includes('deadlines'));
assert(find('право собственности').includes('property'));
for(const q of ['алименты','алиментов'])assert(engine.search(q,{topic:'family'}).hits.some(h=>h.case.id==='1904-116'),q);
assert(A.compile('алименты',glossary).score('Содержание договора аренды')<0,'Одиночное содержание не означает алименты');
assert.equal(engine.search('',{topic:'family'}).decisions,27);
assert.equal(engine.search('').decisions,384);
const filtered=engine.search('содержание ребёнка',{topic:'family',year:'1904',kind:'reasoning'});
assert(filtered.hits.some(h=>h.case.id==='1904-116'));
assert(filtered.hits.every(h=>h.row.kind==='reasoning'&&h.case.year===1904&&h.case.topics.includes('family')));
assert(!engine.search('содержание ребёнка',{kind:'ruling'}).hits.some(h=>h.case.id==='1904-116'),'Совпадение рассуждения не выдаётся за текст постановления');
assert.equal(engine.search('наследство -завещание').hits.length,0,'Не игнорировать неподдержанный оператор');
assert(engine.search('наследство -завещание').unsupportedOperators.length);
const phrase=data.sections.find(r=>r.decision==='1904-116'&&r.kind==='ruling').quotes[0];
assert(engine.search(phrase.slice(0,80),{year:'1904'}).hits.some(h=>h.case.id==='1904-116'));
console.log('Проверены словоформы, дефисы, алименты, 384 разбора, фильтры, роли и буквальные цитаты.');
'''
        result=subprocess.run(['node','-e',script],cwd=LEX,input=json.dumps({'data':self.data,'topics':self.catalog['topics']},ensure_ascii=False),text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)


if __name__=='__main__':unittest.main()
