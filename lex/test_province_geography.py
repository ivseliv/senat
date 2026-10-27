"""Historical assignment guards and geometry safety at the antimeridian."""
import copy
import json
import unittest
from pathlib import Path

import geography
import province_geography as provinces

LEX = Path(__file__).parent


class ProvinceGeography(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads((LEX / 'geography-provinces-source.json').read_text())
        cls.boundaries = json.loads((LEX / 'data/province-boundaries-1897.json').read_text())
        cls.data = geography.build()
        cls.places = {p['id']: p for p in cls.data['places']}

    def test_governorates_and_special_regimes_are_separate(self):
        by_place = {}
        for m in self.data['mentions']:
            by_place.setdefault(m['place_id'], []).append(m)
        self.assertTrue(all(m['province_id'] == 'oblast-don-host' for p in ('rostov-on-don', 'taganrog') for m in by_place[p]))
        self.assertTrue(all(m['province_id'] == 'governorate-kherson' for m in by_place['odessa']))
        self.assertTrue(all('градоначальство' in m['province_note'] for m in by_place['odessa']))
        for m in by_place['moscow']:
            specials = [s['label'] for s in m['province_special_administration']]
            self.assertEqual('Московское градоначальство' in specials, m['year'] == 1905)
        self.assertEqual({m['province_id'] for m in by_place['vladivostok']}, {'oblast-primorsk'})

    def test_foreign_provinces_are_not_part_of_empire(self):
        foreign = [p for p in self.data['provinces'] if not p['within_empire']]
        self.assertEqual({p['id'] for p in foreign}, {'province-east-prussia', 'province-west-prussia'})
        self.assertTrue(all(p['kind'] == 'foreign_province' and not p['boundary_ids'] for p in foreign))

    def test_years_are_checked_individually_not_inferred_between_endpoints(self):
        _, lookup = provinces.validate(self.source, self.boundaries, self.places)
        self.assertIn(('vilno', 1896), lookup)
        self.assertNotIn(('vilno', 1897), lookup)
        source = copy.deepcopy(self.source)
        source['assignments'].append(copy.deepcopy(source['assignments'][0]))
        with self.assertRaisesRegex(ValueError, 'Конфликт'):
            provinces.validate(source, self.boundaries, self.places)

    def test_assignment_requires_evidence_and_bidirectional_boundary_link(self):
        for mutate in (lambda s: s['assignments'][0].update(sources=[]),
                       lambda s: s['assignments'][0].update(province_id='invented'),
                       lambda s: s['provinces'][0].update(boundary_ids=['gub-999']),
                       lambda s: s['assignments'][0].update(valid_from=1800)):
            with self.subTest(mutation=mutate), self.assertRaises(ValueError):
                source = copy.deepcopy(self.source)
                mutate(source)
                provinces.validate(source, self.boundaries, self.places)

    def test_unknown_settlements_do_not_inherit_nearby_courts_province(self):
        unresolved = [m for m in self.data['mentions'] if m['place_id'] is None]
        self.assertEqual(len(unresolved), 28)
        self.assertTrue(all(m['province_id'] is None and not m['province_sources'] for m in unresolved))

    def test_boundaries_preserve_source_identity_and_remove_overlapping_alternatives(self):
        features = provinces.validate_boundaries(self.boundaries)
        self.assertEqual(len(features), 99)
        self.assertTrue({'gub-62', 'gub-70'} <= features.keys())
        self.assertFalse({'gub-62a', 'gub-62b', 'gub-70a', 'gub-70b'} & features.keys())
        self.assertEqual(features['gub-64']['properties']['kind'], 'oblast')
        self.assertIn('губерния', features['gub-64']['properties']['source_label'])
        self.assertEqual(features['gub-103']['properties']['kind'], 'protectorate')
        self.assertTrue(any(xy[0] < -169 for f in features.values() for p in f['geometry']['coordinates'] for r in p for xy in r))

    def test_world_spanning_edges_and_out_of_range_coordinates_fail(self):
        for ring in ([[179, 60], [-179, 60], [-179, 61], [179, 60]],
                     [[180, 60], [190, 60], [180, 61], [180, 60]]):
            data = copy.deepcopy(self.boundaries)
            data['features'][0]['geometry']['coordinates'] = [[ring]]
            with self.assertRaises(ValueError):
                provinces.validate_boundaries(data)


if __name__ == '__main__':
    unittest.main()
