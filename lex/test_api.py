#!/usr/bin/env python3
"""Проверяет контракт статического API v1 без сети и сторонних пакетов."""
import hashlib
import json
import unittest
from pathlib import Path

from api import API_VERSION, CONTRACT_VERSION, build_api
from guide_comparisons import guide_decisions


ROOT = Path(__file__).resolve().parent
API = ROOT / 'api' / API_VERSION
EXPORT = ROOT / 'export'


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def digest_tree(path):
    digest = hashlib.sha256()
    for file in sorted(Path(path).rglob('*')):
        if file.is_file():
            digest.update(file.relative_to(path).as_posix().encode('utf-8'))
            digest.update(b'\0')
            digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = read(API / 'manifest.json')
        cls.export_manifest = read(EXPORT / 'manifest.json')
        cls.decisions = read(EXPORT / 'decisions.json')
        cls.passages = read(EXPORT / 'passages.json')
        cls.participants = read(EXPORT / 'participants.json')
        cls.guides = read(ROOT / 'data' / 'guides.json')
        cls.catalog = read(ROOT / 'data' / 'topic-catalog.json')

    def test_legislation_attribution_contract(self):
        laws=read(ROOT/'data/laws.json')
        unresolved=read(API/'legislation/unresolved.json')
        attribution=read(API/'legislation/attribution.json')
        self.assertEqual(unresolved['count'],laws['attribution_summary']['remaining_unknown'])
        self.assertEqual(attribution['item'],laws['attribution_summary'])
        self.assertTrue(all(r['code']=='?' and r['verification_status']=='act_unknown' for r in unresolved['items']))
        schema=read(API/'schema.json')['$defs']['LegislationCitation']
        self.assertIn('source_sha256',schema['required'])
        self.assertIn('verification_status',schema['required'])
        self.assertIn('evidence',schema['required'])
        baseline=read(ROOT/'law-attributions-source.json')
        facets=read(API/'facets.json')['item']
        self.assertTrue({s for d in baseline['decisions'].values() for s in d['statutes']} <= {r['label'] for r in facets['article']})
        for row in facets['article']:
            if row['count']==0:
                item=read(API/('indexes/article/'+row['id']+'.json'))
                self.assertEqual(item['decision_ids'],[])
                self.assertEqual(item['status'],'no_current_matches')

    def test_historical_legislation_is_a_separate_compatible_resource(self):
        history = read(API / 'legislation/historical-references.json')
        exported = read(EXPORT / 'legislation-historical-references.json')
        self.assertEqual(history['resource'], 'legislation-historical-references')
        self.assertEqual(history['items'], exported)
        self.assertEqual(history['count'], len(exported))
        self.assertEqual(self.manifest['coverage']['counts']['legislation_historical_references'], len(exported))
        dataset = next(row for row in self.manifest['datasets'] if row['id'] == 'legislation-historical-references')
        self.assertTrue(dataset['href'].endswith('/legislation/historical-references.json'))
        self.assertEqual(dataset['item_schema'], 'HistoricalLegislationReference')
        schema = read(API / 'schema.json')['$defs']['HistoricalLegislationReference']
        self.assertIn('historical_note', schema['required'])
        self.assertIn('current_references', schema['required'])
        self.assertIn('/legislation/historical-references.json', read(API / 'openapi.json')['paths'])
        laws = read(ROOT / 'data/laws.json')
        self.assertEqual(self.manifest['coverage']['counts']['legislation_citations'], len(laws['citations']))
        self.assertEqual(self.manifest['coverage']['counts']['legislation_unresolved'], len(laws['unresolved']))
        active_ids = {row['id'] for row in read(API / 'legislation/unresolved.json')['items']}
        for act in read(API / 'statutes/index.json')['items']:
            path = API / 'legislation/citations' / (act['id'] + '.json')
            if path.exists():
                active_ids.update(row['id'] for row in read(path)['items'])
        self.assertFalse(active_ids & {row['id'] for row in exported})
        self.assertTrue(all(row.get('historical_note') for row in exported))
        for row in exported:
            for current in row['current_references']:
                self.assertIn(current['id'], active_ids)
                if current['passage_url'] is not None:
                    self.assertTrue(current['passage_url'].startswith('https://ivseliv.github.io/senat/lex/'))

    def test_manifest_is_complete_and_hashes_match(self):
        self.assertEqual(self.manifest['api_version'], API_VERSION)
        self.assertEqual(self.manifest['contract_version'], CONTRACT_VERSION)
        self.assertRegex(self.manifest['data_revision'], r'^sha256:[0-9a-f]{64}$')
        self.assertEqual(self.manifest['coverage']['counts']['decisions'], len(self.decisions))
        self.assertEqual(self.manifest['coverage']['counts']['passages'], len(self.passages))
        listed = {item['path'] for item in self.manifest['files']}
        actual = {path.relative_to(API).as_posix() for path in API.rglob('*.json') if path.name != 'manifest.json'}
        self.assertEqual(listed, actual)
        for item in self.manifest['files']:
            path = API / item['path']
            self.assertEqual(item['bytes'], path.stat().st_size)
            self.assertEqual(item['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertTrue(item['href'].startswith('https://ivseliv.github.io/senat/lex/api/v1/'))
        self.assertTrue((ROOT / 'api' / 'index.html').is_file())
        self.assertIn('Static API v1', (ROOT / 'API.md').read_text(encoding='utf-8'))

    def test_decisions_and_passages_are_exact(self):
        index = read(API / 'decisions' / 'index.json')
        self.assertEqual(index['count'], len(self.decisions))
        self.assertEqual(len({item['id'] for item in index['items']}), len(self.decisions))
        export_by_id = {row['id']: row for row in self.decisions}
        for summary in index['items']:
            ident = summary['id']
            detail = read(API / 'decisions' / f'{ident}.json')['item']
            self.assertEqual(detail['id'], ident)
            self.assertEqual(detail['text_original'], export_by_id[ident]['text_original'])
            self.assertEqual(detail['text_sha256'], hashlib.sha256(detail['text_original'].encode('utf-8')).hexdigest())
            self.assertTrue(detail['passages_url'].endswith(f'passages/{detail["year"]}.json'))
        text_by_id = {row['id']: row['text_original'] for row in self.decisions}
        api_passages = []
        for year in sorted({row['year'] for row in self.decisions}):
            api_passages.extend(read(API / 'passages' / f'{year}.json')['items'])
        self.assertEqual(api_passages, self.passages)
        for passage in api_passages:
            text = text_by_id[passage['decision_id']]
            self.assertEqual(passage['text_original'], text[passage['start']:passage['end']])
            self.assertEqual(passage['sha256'], hashlib.sha256(passage['text_original'].encode('utf-8')).hexdigest())

    def test_facets_only_reference_matching_decisions(self):
        facets = read(API / 'facets.json')['item']
        decisions = {row['id']: row for row in self.decisions}
        participant_map = {row['id']: row for row in self.participants}
        guide_ids = {guide['id']: set(guide_decisions(guide)) for guide in self.guides['guides']}
        catalog_ids = {t['id']: set(t['decision_ids']) for t in self.catalog['topics']}
        for kind, rows in facets.items():
            for facet in rows:
                index = read(API / 'indexes' / kind / f'{facet["id"]}.json')
                ids = index['decision_ids']
                self.assertEqual(index['count'], len(ids))
                self.assertEqual(len(ids), len(set(ids)))
                self.assertTrue(all(ident in decisions for ident in ids))
                label = index['filter']['label']
                for ident in ids:
                    decision = decisions[ident]
                    if kind == 'year': self.assertEqual(str(decision['year']), label)
                    elif kind == 'outcome': self.assertEqual(decision['outcome'], label)
                    elif kind == 'topic': self.assertIn(label, decision['topics'])
                    elif kind == 'procedure': self.assertIn(label, decision['procedure'])
                    elif kind == 'act': self.assertTrue(any(value.split(' ', 1)[0] == label for value in decision['statutes']))
                    elif kind == 'article': self.assertIn(label, decision['statutes'])
                    elif kind in ('presiding', 'reporter', 'prosecutor'): self.assertEqual(decision[kind], label)
                    elif kind == 'participant': self.assertIn(ident, participant_map[label]['decisions'])
                    elif kind == 'guide': self.assertIn(ident, guide_ids[label])
                    elif kind == 'catalog-topic': self.assertIn(ident, catalog_ids[label])
                if kind == 'guide': self.assertEqual(set(ids),guide_ids[label])
                if kind == 'catalog-topic': self.assertEqual(set(ids),catalog_ids[label])

    def test_comparisons_are_in_editorial_resource_and_coverage(self):
        resource=read(API/'editorial/guides.json')['item']
        self.assertEqual(resource,self.guides)
        counts=self.manifest['coverage']['counts']
        self.assertEqual(counts['guide_comparisons'],3)
        self.assertEqual(counts['guide_comparison_decisions'],8)
        self.assertIn('GuideComparison',read(API/'schema.json')['$defs'])

    def test_catalog_is_available_with_exact_coverage(self):
        self.assertEqual(read(API/'editorial/topics.json')['item'],self.catalog)
        counts=self.manifest['coverage']['counts']
        self.assertEqual(counts['catalog_decisions'],len(self.decisions))
        self.assertEqual(counts['catalog_topics'],self.catalog['topic_count'])
        self.assertEqual(counts['catalog_memberships'],sum(len(c['topics']) for c in self.catalog['decisions'].values()))
        self.assertIn('TopicCatalog',read(API/'schema.json')['$defs'])

    def test_openapi_and_scan_contract(self):
        spec = read(API / 'openapi.json')
        self.assertEqual(spec['openapi'], '3.1.0')
        self.assertIn('/manifest.json', spec['paths'])
        self.assertIn('/decisions/{id}.json', spec['paths'])
        self.assertIn('/statutes/{act_id}.json', spec['paths'])
        scans = []
        for year in sorted({row['year'] for row in self.decisions}):
            scans.extend(read(API / 'scans' / f'{year}.json')['items'])
        self.assertEqual(len(scans), self.export_manifest['counts']['scan_passage_refs'])
        passage_ids = {row['id'] for row in self.passages}
        for ref in scans:
            self.assertIn(ref['passage_id'], passage_ids)
            self.assertTrue(ref['full_page_url'].startswith('https://ivseliv.github.io/senat/lex/scans/'))
            if ref.get('box') is not None:
                self.assertEqual(len(ref['box']), 4)
                self.assertTrue(all(0 <= value <= 1 for value in ref['box']))

    def test_rebuild_is_deterministic(self):
        before = digest_tree(ROOT / 'api')
        rebuilt = build_api(ROOT.parent)
        after = digest_tree(ROOT / 'api')
        self.assertEqual(before, after)
        self.assertEqual(rebuilt['data_revision'], self.manifest['data_revision'])


if __name__ == '__main__':
    unittest.main()
