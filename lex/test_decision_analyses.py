import hashlib
import json
import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import decision_analyses as analyses

ROOT = Path(__file__).resolve().parent


class AnalysesTests(unittest.TestCase):
    def test_source_and_generated_records_are_current(self):
        subprocess.run([sys.executable, str(ROOT/'decision_analyses.py'), '--check'], check=True)
        data = json.loads((ROOT/'data/decision-analyses.json').read_text())
        self.assertEqual(data['count'], 384)
        meta = json.loads((ROOT/'data/meta.json').read_text())
        texts = analyses.load_texts(meta)
        self.assertEqual({y: sum(d['year'] == y for d in data['decisions'].values())
                          for y in (1896, 1897, 1904, 1905)}, {1896:49, 1897:100, 1904:120, 1905:115})
        self.assertEqual(set(data['decisions']), {d['id'] for d in meta['decisions']})
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


class PublicationTests(unittest.TestCase):
    def fixture(self):
        record = dict(id='1904-001', year=1904, department='Гражданский кассационный департамент',
                      source_sha256='a' * 64, selection='Сплошное дополнение корпуса',
                      status=dict(editorial='Прочитан полный текст'), sections=[
                          dict(heading=f'Раздел {i}', speaker='Сенат',
                               summary=f'Современное пояснение {i}: 😀',
                               verification='context_read', evidence=[
                                   dict(text='Рѣшеніе С.-Петербургской палаты отменить.',
                                        start=17, end=65, passage_id=None,
                                        passage_ids=['1904-001:0-40', '1904-001:40-80'],
                                        sources=[dict(file='p1.txt', page=12, start=17, end=40),
                                                 dict(file='p2.txt', page=13, start=40, end=65)],
                                        printed_pages=[12, 13], scan=dict(full='page12.webp'),
                                        scans=[dict(full='page12.webp'), dict(full='page13.webp')],
                                        source_warning='Сохранено предупреждение OCR')])
                          for i in range(7)])
        return dict(schema_version=2, label='Разборы с помощью ИИ', method='Полный контекст',
                    offset_encoding='Unicode code points in UTF-8-decoded source text',
                    decisions={record['id']: record}, selection=[dict(id=record['id'], reason=record['selection'])],
                    count=1)

    def test_combined_bytes_keep_previous_format_and_chunks_lose_nothing(self):
        data = self.fixture()
        before = copy.deepcopy(data)
        files = analyses.published_files(data)
        previous = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
        self.assertEqual(files['decision-analyses.json'], previous)
        self.assertEqual(data, before)
        chunk = files['analyses/1904-001.json']
        self.assertTrue(chunk.endswith(b'\n'))
        self.assertEqual(chunk, (json.dumps(data['decisions']['1904-001'], ensure_ascii=False,
                                           separators=(',', ':')) + '\n').encode('utf-8'))
        self.assertEqual(json.loads(chunk), data['decisions']['1904-001'])
        self.assertNotIn('decisions', json.loads(chunk))

    def test_index_fields_paths_and_hashes_match_exact_utf8_bytes(self):
        data = self.fixture()
        files = analyses.published_files(data)
        index = json.loads(files['decision-analyses-index.json'])
        self.assertEqual(set(index), {'schema_version', 'label', 'method', 'count', 'revision', 'decisions'})
        self.assertEqual(index['schema_version'], 1)
        self.assertEqual(index['label'], data['label'])
        self.assertEqual(index['method'], data['method'])
        self.assertEqual(index['count'], data['count'])
        self.assertEqual(index['revision'], hashlib.sha256(files['decision-analyses.json']).hexdigest())
        self.assertEqual(set(index['decisions']), set(data['decisions']))
        record = data['decisions']['1904-001']
        item = index['decisions']['1904-001']
        self.assertEqual(set(item), {'id', 'year', 'department', 'source_sha256', 'selection',
                                    'summary', 'file', 'sha256'})
        for key in ('id', 'year', 'department', 'source_sha256', 'selection'):
            self.assertEqual(item[key], record[key])
        self.assertEqual(item['summary'], record['sections'][0]['summary'])
        self.assertEqual(item['file'], 'analyses/1904-001.json')
        self.assertEqual(item['sha256'], hashlib.sha256(files[item['file']]).hexdigest())
        # Хеш включает реальный UTF-8 и завершающий перевод строки.
        self.assertNotEqual(item['sha256'], hashlib.sha256(files[item['file']][:-1]).hexdigest())
        self.assertNotIn('sections', item)

    def test_change_outside_preview_invalidates_chunk_and_revision(self):
        data = self.fixture()
        old = json.loads(analyses.published_files(data)['decision-analyses-index.json'])
        data['decisions']['1904-001']['sections'][6]['summary'] += ' Дополнительное ограничение.'
        new = json.loads(analyses.published_files(data)['decision-analyses-index.json'])
        self.assertEqual(old['decisions']['1904-001']['summary'], new['decisions']['1904-001']['summary'])
        self.assertNotEqual(old['revision'], new['revision'])
        self.assertNotEqual(old['decisions']['1904-001']['sha256'], new['decisions']['1904-001']['sha256'])

    def test_unsafe_chunk_paths_and_mismatched_ids_are_rejected(self):
        for ident in ('../1904-001', '/1904-001', '1904-001/extra', '1904-001\\extra',
                      '１９０４-００１', '1904-001.json'):
            with self.subTest(id=ident):
                data = self.fixture()
                record = data['decisions'].pop('1904-001')
                record['id'] = ident
                data['decisions'][ident] = record
                with self.assertRaisesRegex(ValueError, 'Небезопасный идентификатор'):
                    analyses.published_files(data)
        data = self.fixture()
        data['decisions']['1904-001']['id'] = '1904-002'
        with self.assertRaisesRegex(ValueError, 'не совпадает с ключом'):
            analyses.published_files(data)

    def test_writer_checks_every_output_without_rewriting_damaged_files(self):
        data = self.fixture()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for relative in ('decision-analyses.json', 'decision-analyses-index.json', 'analyses/1904-001.json'):
                with self.subTest(file=relative):
                    analyses.write_published(data, directory)
                    analyses.write_published(data, directory, check=True)
                    target = directory / relative
                    target.write_bytes(target.read_bytes() + b' ')
                    damaged = target.read_bytes()
                    with self.assertRaises(ValueError) as error:
                        analyses.write_published(data, directory, check=True)
                    self.assertIn(relative, str(error.exception))
                    self.assertEqual(target.read_bytes(), damaged)

    def test_check_detects_missing_chunk_and_writer_removes_only_stale_json_parts(self):
        data = self.fixture()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            analyses.write_published(data, directory)
            missing = directory / 'analyses/1904-001.json'
            missing.unlink()
            with self.assertRaisesRegex(ValueError, 'analyses/1904-001.json'):
                analyses.write_published(data, directory, check=True)
            self.assertFalse(missing.exists())
            analyses.write_published(data, directory)
            stale = directory / 'analyses/1904-999.json'
            stale.write_text('{}\n')
            other = directory / 'another.json'
            other.write_text('{}\n')
            note = directory / 'analyses/notes.txt'
            note.write_text('Примечание')
            with self.assertRaisesRegex(ValueError, 'analyses/1904-999.json'):
                analyses.write_published(data, directory, check=True)
            self.assertTrue(stale.exists())
            analyses.write_published(data, directory)
            self.assertFalse(stale.exists())
            self.assertTrue(other.exists())
            self.assertEqual(note.read_text(), 'Примечание')
            analyses.write_published(data, directory, check=True)


if __name__ == '__main__':
    unittest.main()
