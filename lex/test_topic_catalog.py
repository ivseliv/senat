"""Полнота каталога и защита от неподтверждённых тематических включений."""
import hashlib
import json
import unittest
from unittest.mock import patch

import topic_catalog as catalog


class TopicCatalogTests(unittest.TestCase):
    def test_all_decisions_are_accounted_for_and_every_membership_has_a_quote(self):
        data=catalog.build()
        self.assertEqual(data,catalog.read(catalog.OUT))
        meta=catalog.read(catalog.DATA/'meta.json')
        texts=catalog.load_texts(meta)
        self.assertEqual(set(data['decisions']),{d['id'] for d in meta['decisions']})
        unresolved={i for i,c in data['decisions'].items() if not c['topics']}
        self.assertEqual(set(data['unclassified']),unresolved)
        self.assertEqual(data['classified'],data['count']-len(unresolved))
        for case in data['decisions'].values():
            text=texts[case['id']]
            self.assertEqual(case['source_sha256'],hashlib.sha256(text.encode()).hexdigest())
            for entry in case['topics']:
                ev=entry['evidence']
                self.assertEqual(ev['decision'],case['id'])
                self.assertEqual(text[ev['start']:ev['end']],ev['text'])
                self.assertEqual(text.count(ev['text']),1)
                self.assertTrue(ev['passage_ids'])
                self.assertEqual({r['file'] for r in ev['scans']},{r['file'] for r in ev['sources']})
            if not case['topics']:self.assertTrue(case['review_note'])

    def test_topic_counts_and_years_equal_actual_memberships(self):
        data=catalog.build()
        total=0
        for topic in data['topics']:
            actual={i for i,c in data['decisions'].items() if topic['id'] in [t['id'] for t in c['topics']]}
            self.assertEqual(set(topic['decision_ids']),actual)
            self.assertEqual(len(actual),topic['count'])
            for year,count in topic['by_year'].items():
                self.assertEqual(count,sum(str(data['decisions'][i]['year'])==year for i in actual))
            total+=len(actual)
        self.assertEqual(total,data['memberships'])
        self.assertGreater(data['topic_count'],3)

    def invalid_source(self,change,message):
        source=catalog.read(catalog.SOURCE)
        change(source)
        real=catalog.read
        with patch.object(catalog,'read',side_effect=lambda p:source if p==catalog.SOURCE else real(p)):
            with self.assertRaisesRegex(ValueError,message):catalog.build()

    def test_missing_case_is_not_silently_lost(self):
        self.invalid_source(lambda s:s['decisions'].pop(),'Каталог неполон')

    def test_stale_source_requires_reclassification(self):
        self.invalid_source(lambda s:s['decisions'][0].update(source_sha256='0'*64),'нужна повторная проверка')

    def test_duplicate_case_is_rejected(self):
        self.invalid_source(lambda s:s['decisions'].append(s['decisions'][0]),'повторное или отсутствующее')

    def test_unknown_topic_is_rejected(self):
        self.invalid_source(lambda s:s['decisions'][0]['topics'][0].update(id='invented'),'неизвестная или повторная тема')

    def test_changed_quote_is_rejected(self):
        self.invalid_source(lambda s:s['decisions'][0]['topics'][0].update(quote='выдуманная цитата'),'ровно один раз')

    def test_unclassified_case_requires_explanation(self):
        def change(s):
            s['decisions'][0]['topics']=[]
            s['decisions'][0].pop('review_note',None)
        self.invalid_source(change,'review_note')

    def test_old_comparison_link_maps_to_real_topic(self):
        data=catalog.build()
        topic=next(t for t in data['topics'] if t['id']==data['route_aliases']['property-notary'])
        self.assertEqual(topic['comparison_guide'],'property-notary')

    def test_subject_is_distinguished_from_background_party_or_institution(self):
        cases=catalog.build()['decisions']
        tags=lambda ident:{t['id'] for t in cases[ident]['topics']}
        self.assertEqual(tags('1904-055'),{'notary','taxes'})
        self.assertEqual(tags('1904-115'),{'intellectual','contracts'})
        self.assertEqual(tags('1904-100'),{'property','deadlines'})
        self.assertNotIn('rent',tags('1905-029'))  # Пользование улицей, не аренда торгового помещения.


if __name__=='__main__':unittest.main()
