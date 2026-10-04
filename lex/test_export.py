#!/usr/bin/env python3
"""Проверяет опубликованный исследовательский экспорт без внешних сервисов."""
import csv
import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'export'


class ExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
        cls.decisions = json.loads((OUT / 'decisions.json').read_text(encoding='utf-8'))
        cls.passages = json.loads((OUT / 'passages.json').read_text(encoding='utf-8'))
        cls.participants = json.loads((OUT / 'participants.json').read_text(encoding='utf-8'))
        cls.statutes = json.loads((OUT / 'statutes.json').read_text(encoding='utf-8'))
        cls.scan_refs = json.loads((OUT / 'scan-passages.json').read_text(encoding='utf-8'))

    def test_counts_and_ids(self):
        counts = self.manifest['counts']
        self.assertEqual(counts['decisions'], 335)
        self.assertEqual(counts['passages'], 1875)
        self.assertEqual(counts['participants'], 790)
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
        for name, expected in [('decisions.csv', 335), ('passages.csv', 1875), ('participants.csv', 790),
                               ('statutes.csv', len(self.statutes)), ('scan-passages.csv', len(self.scan_refs))]:
            with (OUT / name).open(encoding='utf-8', newline='') as f:
                self.assertEqual(sum(1 for _ in csv.DictReader(f)), expected)

    def test_manifest_hashes_match(self):
        for item in self.manifest['files']:
            path = OUT / item['name']
            self.assertEqual(item['bytes'], path.stat().st_size)
            self.assertEqual(item['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
