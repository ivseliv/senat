import hashlib
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
import decision_analyses as analyses

ROOT = Path(__file__).resolve().parent


class AnalysesTests(unittest.TestCase):
    def test_source_and_generated_records_are_current(self):
        subprocess.run([sys.executable, str(ROOT/'decision_analyses.py'), '--check'], check=True)
        data = json.loads((ROOT/'data/decision-analyses.json').read_text())
        self.assertEqual(data['count'], 40)
        meta = json.loads((ROOT/'data/meta.json').read_text())
        texts = analyses.load_texts(meta)
        self.assertEqual({y: sum(d['year'] == y for d in data['decisions'].values())
                          for y in (1896, 1897, 1904, 1905)}, {y: 10 for y in (1896, 1897, 1904, 1905)})
        for doc in data['decisions'].values():
            text = texts[doc['id']]
            self.assertEqual(doc['source_sha256'], hashlib.sha256(text.encode()).hexdigest())
            self.assertEqual(len(doc['sections']), 7)
            for section in doc['sections']:
                self.assertTrue(section['evidence'])
                for evidence in section['evidence']:
                    self.assertEqual(text[evidence['start']:evidence['end']], evidence['text'])
                    self.assertTrue(evidence['passage_ids'])
                    if evidence['passage_id']:
                        self.assertIn(evidence['passage_id'], evidence['passage_ids'])
                    self.assertEqual({s['file'] for s in evidence['sources']},
                                     {s['file'] for s in evidence['scans']})
                    self.assertEqual(set(evidence['printed_pages']),
                                     {s['page'] for s in evidence['sources'] if s['page'] is not None})

    def test_repeated_or_absent_quote_is_rejected(self):
        for text, quote in [('Повтор Повтор', 'Повтор'), ('Другое', 'нет'), ('текст', ' ')]:
            with self.assertRaises(ValueError):
                analyses.evidence_record(text, quote, [], {'pages': {}})

    def test_quote_keeps_initials_and_unicode_offsets(self):
        text = '😀 Начало. Рѣшеніе С.-Петербургской палаты по ст. 1 отменить. Конец.'
        quote = 'Рѣшеніе С.-Петербургской палаты по ст. 1 отменить.'
        start, end = text.index(quote), text.index(quote) + len(quote)
        p = dict(id='1904-001:0-100', start=0, end=len(text), sources=[
            dict(file='p1.txt', page=10, page_method='verified', start=0, end=len(text))])
        ev = analyses.evidence_record(text, quote, [p], {'pages': {'p1.txt': {'file': 'p1.txt', 'full': 'page.webp'}}})
        self.assertEqual((ev['start'], ev['end'], ev['text']), (start, end, quote))

    def test_quote_on_second_page_does_not_use_first_page_of_passage(self):
        text = 'Первая. Вторая страница.'
        p = dict(id='d:0-23', start=0, end=len(text), sources=[
            dict(file='p1', page=11, page_method='verified', start=0, end=7),
            dict(file='p2', page=12, page_method='verified', start=8, end=len(text))])
        ev = analyses.evidence_record(text, 'Вторая страница.', [p], {'pages': {
            'p1': dict(file='p1'), 'p2': dict(file='p2')}})
        self.assertEqual(ev['printed_pages'], [12])
        self.assertEqual([r['file'] for r in ev['scans']], ['p2'])

    def test_quote_crossing_passages_retains_all_pages(self):
        text = 'Начало. Очень длинная цитата. Конец.'
        quote = 'Очень длинная цитата.'
        a, b = text.index(quote), text.index(quote)+len(quote)
        passages = [dict(id='d:0-20', start=0, end=20, sources=[
            dict(file='a', page=1, page_method='header', start=0, end=20)]),
            dict(id='d:20-35', start=20, end=len(text), sources=[
                dict(file='b', page=2, page_method='header', start=20, end=len(text))])]
        ev = analyses.evidence_record(text, quote, passages, {'pages': {'a': dict(file='a'), 'b': dict(file='b')}})
        self.assertIsNone(ev['passage_id'])
        self.assertEqual(ev['passage_ids'], ['d:0-20', 'd:20-35'])
        self.assertEqual(ev['printed_pages'], [1, 2])
        self.assertEqual((ev['start'], ev['end']), (a, b))

    def test_changed_source_requires_editorial_review(self):
        source = json.loads((ROOT/'decision-analyses-source.json').read_text())
        source['decisions'][0]['source_sha256'] = '0'*64
        actual_read = analyses.read
        with patch.object(analyses, 'read', side_effect=lambda p: source if p == analyses.SOURCE else actual_read(p)):
            with self.assertRaisesRegex(ValueError, 'повторная содержательная вычитка'):
                analyses.build()

    def test_unmapped_part_of_quote_is_rejected(self):
        p = dict(id='d:0-10', start=0, end=10, sources=[
            dict(file='p1', page=1, page_method='header', start=0, end=3)])
        with self.assertRaisesRegex(ValueError, 'Часть цитаты'):
            analyses.evidence_record('Весь текст', 'Весь текст', [p], {'pages': {'p1': dict(file='p1')}})


if __name__ == '__main__':
    unittest.main()
