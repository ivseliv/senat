#!/usr/bin/env python3
"""Проверяет опубликованный исследовательский экспорт без внешних сервисов."""
import csv
import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import export as exporter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'export'


class ExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
        cls.meta = json.loads((ROOT / 'data' / 'meta.json').read_text(encoding='utf-8'))
        cls.decisions = json.loads((OUT / 'decisions.json').read_text(encoding='utf-8'))
        cls.passages = json.loads((OUT / 'passages.json').read_text(encoding='utf-8'))
        cls.participants = json.loads((OUT / 'participants.json').read_text(encoding='utf-8'))
        cls.statutes = json.loads((OUT / 'statutes.json').read_text(encoding='utf-8'))
        cls.legislation_acts = json.loads((OUT / 'legislation-acts.json').read_text(encoding='utf-8'))
        cls.legislation_citations = json.loads((OUT / 'legislation-citations.json').read_text(encoding='utf-8'))
        cls.legislation_history = json.loads((OUT / 'legislation-historical-references.json').read_text(encoding='utf-8'))
        cls.scan_refs = json.loads((OUT / 'scan-passages.json').read_text(encoding='utf-8'))

    def test_counts_and_ids(self):
        counts = self.manifest['counts']
        self.assertEqual(counts['decisions'], len(self.decisions))
        self.assertEqual(counts['passages'], len(self.passages))
        self.assertEqual(counts['participants'], len(self.participants))
        self.assertEqual(counts['statute_mentions'], len(self.statutes))
        self.assertEqual(counts['legislation_acts'], len(self.legislation_acts))
        self.assertEqual(counts['legislation_citations'], len(self.legislation_citations))
        self.assertEqual(counts['legislation_historical_references'], len(self.legislation_history))
        self.assertEqual(counts['scan_passage_refs'], len(self.scan_refs))
        self.assertEqual(sum(volume['decisions'] for volume in self.manifest['volumes']), len(self.decisions))
        self.assertEqual([volume['year'] for volume in self.manifest['volumes']], [volume['year'] for volume in self.meta['volumes']])
        self.assertEqual(len({x['id'] for x in self.decisions}), len(self.decisions))
        self.assertEqual(len({x['id'] for x in self.passages}), len(self.passages))

    def test_passages_are_exact_slices_and_have_stable_links(self):
        texts = {d['id']: d['text_original'] for d in self.decisions}
        for passage in self.passages:
            self.assertEqual(passage['text_original'], texts[passage['decision_id']][passage['start']:passage['end']])
            self.assertIn(f'#/d/{passage["decision_id"]}?mode=passage&at={passage["start"]}&end={passage["end"]}', passage['url'])
            self.assertEqual(len(passage['sha256']), 64)

    def test_scan_references_and_csv_are_readable(self):
        passage_ids = {p['id'] for p in self.passages}
        self.assertGreater(len(self.scan_refs), len(self.passages))
        for ref in self.scan_refs:
            self.assertIn(ref['passage_id'], passage_ids)
            self.assertTrue(ref['full_page_url'].startswith('https://ivseliv.github.io/senat/lex/scans/'))
            if ref.get('box') is not None:
                self.assertEqual(len(ref['box']), 4)
                self.assertTrue(all(0 <= value <= 1 for value in ref['box']))
        for name, expected in [('decisions.csv', len(self.decisions)), ('passages.csv', len(self.passages)), ('participants.csv', len(self.participants)),
                               ('statutes.csv', len(self.statutes)), ('legislation-acts.csv', len(self.legislation_acts)),
                               ('legislation-citations.csv', len(self.legislation_citations)), ('scan-passages.csv', len(self.scan_refs))]:
            with (OUT / name).open(encoding='utf-8', newline='') as f:
                self.assertEqual(sum(1 for _ in csv.DictReader(f)), expected)

    def test_retired_legislation_keeps_its_identity_and_is_not_counted_as_active(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / 'data', root / 'lex/data')
            path = root / 'lex/data/laws.json'
            laws = json.loads(path.read_text(encoding='utf-8'))
            old = dict(laws['citations'][0], id='retired-reference-fixture',
                       historical_note='Сохранённая ссылка предыдущей версии.')
            old['decision_url'] = exporter.url(old['decision_url'])
            old['current_references'] = [{key: laws['citations'][0][key] for key in ('id', 'code', 'article', 'passage_url')}]
            laws['historical_references'] = [old]
            path.write_text(json.dumps(laws, ensure_ascii=False), encoding='utf-8')
            with patch.multiple(exporter, ROOT=exporter.ROOT, DATA=exporter.DATA, OUT=exporter.OUT):
                manifest = exporter.build_export(root)
            out = root / 'lex/export'
            rows = json.loads((out / 'legislation-historical-references.json').read_text(encoding='utf-8'))
            self.assertEqual(rows, [{**old, 'decision_url': exporter.url(old['decision_url']),
                                     'passage_url': exporter.url(old['passage_url']) if old.get('passage_url') else None,
                                     'current_references': [{**old['current_references'][0],
                                         'passage_url': exporter.url(old['current_references'][0]['passage_url'])}]}])
            self.assertEqual(manifest['counts']['legislation_historical_references'], 1)
            self.assertEqual(manifest['counts']['legislation_citations'], len(laws['citations']))
            self.assertEqual(manifest['counts']['legislation_unresolved'], len(laws['unresolved']))
            active = json.loads((out / 'legislation-citations.json').read_text(encoding='utf-8'))
            self.assertNotIn(old['id'], {row['id'] for row in active})
            with (out / 'legislation-historical-references.csv').open(encoding='utf-8', newline='') as file:
                csv_row, = list(csv.DictReader(file))
            self.assertEqual(csv_row['id'], old['id'])
            self.assertEqual(csv_row['historical_note'], old['historical_note'])
            self.assertEqual(json.loads(csv_row['occurrences']), old.get('occurrences'))
            self.assertEqual(json.loads(csv_row['current_references']), rows[0]['current_references'])

    def test_legislation_citations_preserve_the_source(self):
        acts = {row['code'] for row in self.legislation_acts}
        passages = {row['id'] for row in self.passages}
        for row in self.legislation_citations:
            self.assertIn(row['code'], acts)
            self.assertIn(row['quote_original'], row['context_original'])
            self.assertTrue(row['passage_url'].startswith('https://ivseliv.github.io/senat/lex/#/d/'))
            if row.get('field')=='headnote':
                self.assertIsNone(row['passage_id'])
                self.assertFalse(row['scan_available'])
            else:
                self.assertIn(row['passage_id'], passages)
            self.assertIn(row['verification_status'],('context_verified','legacy_unverified'))
            self.assertEqual(len(row['source_sha256']),64)

    def test_manifest_hashes_match(self):
        for item in self.manifest['files']:
            path = OUT / item['name']
            self.assertEqual(item['bytes'], path.stat().st_size)
            self.assertEqual(item['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())

    def test_source_warnings_survive_json_and_csv(self):
        warnings = {p['id']: p['source_warning'] for p in self.passages if p.get('source_warning')}
        source = {p['id']: p['ai']['source_warning']
                  for p in json.loads((ROOT/'data/passages-1896.json').read_text())['passages']
                  if p.get('ai', {}).get('source_warning')}
        self.assertEqual(warnings, source)
        with (OUT/'passages.csv').open(encoding='utf-8', newline='') as f:
            csv_warnings = {p['id']: p['source_warning'] for p in csv.DictReader(f) if p['source_warning']}
        self.assertEqual(csv_warnings, source)


if __name__ == '__main__':
    unittest.main()
