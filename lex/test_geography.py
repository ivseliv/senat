#!/usr/bin/env python3
"""Привязка населённых пунктов проверяет текст, роли и координатный источник."""
import copy
import hashlib
import json
import unittest
from pathlib import Path

import geography


class GeographyValidation(unittest.TestCase):
    def setUp(self):
        self.text = 'Домъ въ Вильнѣ. Судебная палата въ Петербургѣ.'
        self.place = dict(id='vilno', historical_name='Вильно', modern_name='Вильнюс', aliases=[], coordinate_revision=123,
                          lat=54.687, lon=25.28, coordinate_source='https://www.wikidata.org/w/index.php?title=Q216&oldid=123#P625',
                          identity_source='https://www.wikidata.org/wiki/Q216', coordinate_note='Город, не адрес дома')
        self.spec = dict(id='geo-fixture', source_sha256=hashlib.sha256(self.text.encode()).hexdigest(),
                         role='event_property', start=0, end=15, quote=self.text[:15],
                         mention_start=8, mention_end=14, mention=self.text[8:14], place_id='vilno')

    def test_valid_literal_context(self):
        geography.validate_place(self.place)
        geography.validate_mention(self.spec, self.text, {'vilno': self.place})

    def test_stale_or_changed_evidence_fails_closed(self):
        for key, value in [('source_sha256', '0' * 64), ('quote', 'Исправленная цитата'),
                           ('mention_start', -1), ('mention', 'Вильнюс'), ('role', 'event'), ('end', 500)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                geography.validate_mention(dict(self.spec, **{key: value}), self.text, {'vilno': self.place})

    def test_unresolved_needs_reason_and_has_no_point(self):
        spec = dict(self.spec, place_id=None)
        with self.assertRaises(ValueError):
            geography.validate_mention(spec, self.text, {})
        geography.validate_mention(dict(spec, unresolved_reason='Не определён одноимённый населённый пункт'), self.text, {})
        with self.assertRaises(ValueError):
            geography.validate_mention(dict(spec, place_id='guessed'), self.text, {})

    def test_coordinates_need_sources_and_bounds(self):
        for key, value in [('lat', 95), ('lon', -200), ('lat', float('nan')), ('lat', True),
                           ('coordinate_source', ''), ('identity_source', 'javascript:alert(1)'),
                           ('coordinate_revision', None), ('coordinate_revision', 456), ('aliases', 'Вильна')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                geography.validate_place(dict(self.place, **{key: value}))

    def test_geojson_uses_lon_lat_and_counts_distinct_decisions(self):
        data = dict(coverage={}, places=[self.place], mentions=[
            dict(id='one', place_id='vilno', decision_id='1896-002'),
            dict(id='two', place_id='vilno', decision_id='1896-002'),
            dict(id='unknown', place_id=None, decision_id='1896-003')])
        feature, = geography.geojson(data)['features']
        self.assertEqual(feature['geometry']['coordinates'], [25.28, 54.687])
        self.assertEqual(feature['properties']['decision_ids'], ['1896-002'])


class PublishedGeography(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = geography.build()

    def test_generated_data_and_geojson_are_current(self):
        folder = Path(__file__).parent / 'data'
        self.assertEqual(json.loads((folder / 'geography.json').read_text()), self.data)
        self.assertEqual(json.loads((folder / 'geography.geojson').read_text()), geography.geojson(self.data))

    def test_all_volumes_and_selective_coverage(self):
        self.assertEqual(set(self.data['coverage']['by_year']), {'1896', '1897', '1904', '1905'})
        self.assertFalse(self.data['coverage']['complete'])
        self.assertGreater(self.data['coverage']['unresolved_mentions'], 0)
        self.assertGreater(self.data['coverage']['places'], 30)
        for m in self.data['mentions']:
            self.assertTrue(m['scans'])
            if m['place_id'] is None:
                self.assertTrue(m['unresolved_reason'])

    def test_yalta_property_and_simferopol_court_are_separate(self):
        rows = [m for m in self.data['mentions'] if m['decision_id'] == '1905-052']
        places = {p['id']: p['historical_name'] for p in self.data['places']}
        roles = {(places.get(m['place_id']), m['role']) for m in rows}
        self.assertIn(('Ялта', 'event_property'), roles)
        self.assertIn(('Симферополь', 'court'), roles)

    def test_village_klin_is_not_guessed_as_town(self):
        rows = [m for m in self.data['mentions'] if m['decision_id'] == '1904-062' and 'Клин' in m['display_name']]
        self.assertTrue(rows)
        self.assertTrue(all(m['place_id'] is None for m in rows))


if __name__ == '__main__':
    unittest.main()
