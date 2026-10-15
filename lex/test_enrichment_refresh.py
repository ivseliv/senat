#!/usr/bin/env python3
"""Безопасное обновление пояснений без пересборки OCR и смещений источника."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from build import stems
from passages import published_corpus, refresh_published_enrichment


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')


class EnrichmentRefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root/'lex/data'
        self.enrichment = self.root/'lex/enrichment'
        self.enrichment.mkdir(parents=True)
        self.docs, self.ids, self.annotations = [], [], []
        self.original = dict(n=1, avgdl=2.0, len=[2], post={'сенат': [0, 1], 'прав': [0, 1]},
                             hpost={}, vocabulary=['прав', 'сенат'], sequence=[[1, 0]],
                             future_field={'keep_order': ['two', 'one']})
        for i, year in enumerate((1904, 1905)):
            decision = f'{year}-001'
            text = '😀 Сенатъ разсмотрѣлъ доводъ стороны. Жалоба оставлена безъ послѣдствій.'
            # Смещения считаются по Unicode-кодовым точкам, а не байтам/UTF-16.
            start, end = 2, len(text)
            pid = f'{decision}:{start}-{end}'
            sha = hashlib.sha256(text[start:end].encode('utf-8')).hexdigest()
            self.ids.append(pid)
            self.docs.append(dict(id=decision, i=i, vol=year, headnote=f'Дело {year}'))
            self.annotations.append(dict(sha256=sha,
                summary='Сенат рассматривает довод стороны и оставляет жалобу без последствий.',
                concepts=['кассационная жалоба', 'доводы стороны'],
                evidence='Жалоба оставлена безъ послѣдствій.'))
            passage = dict(id=pid, decision=decision, doc=i, start=start, end=end, words=9,
                           pages=[17, 18], sources=[dict(page=17, page_method='verified',
                           file='p0010_R.txt', start=start, end=end, extra='сохраняется')],
                           sha256=sha, extra={'untouched': True}, ai=dict(summary='Старое',
                           concepts=['старое'], evidence='Старое'))
            dump(self.data/f'text-{year}.json', [text])
            dump(self.data/f'passages-{year}.json', dict(passages=[passage],
                original=copy.deepcopy(self.original), enriched={'old': 'index'}, extra='unchanged'))
        dump(self.data/'meta.json', dict(decisions=self.docs))
        dump(self.data/'concepts.json', dict(version=1, method='combined', glossary=[{'понятие': 'источник'}],
            extra='unchanged', volumes=[dict(year=y, file=f'passages-{y}.json', passages=1,
                                            enriched=0, pages_known=1, extra='unchanged')
                                       for y in (1904, 1905)]))

    def annotate(self, index, ann=None):
        year = self.docs[index]['vol']
        dump(self.enrichment/f'{year}.json', dict(provenance='Тест',
            passages={self.ids[index]: self.annotations[index] if ann is None else ann}))

    def snapshot(self):
        return {p.name: p.read_bytes() for p in self.data.glob('*')}

    def test_refresh_preserves_original_and_all_source_metadata(self):
        before = {y: json.loads((self.data/f'passages-{y}.json').read_text()) for y in (1904, 1905)}
        self.annotate(0)
        self.annotate(1)
        report = refresh_published_enrichment(self.root, stems)
        self.assertEqual((report['valid'], report['ignored']), (2, 0))
        self.assertEqual([x['enriched'] for x in report['volumes']], [1, 1])
        for year in (1904, 1905):
            after = json.loads((self.data/f'passages-{year}.json').read_text())
            self.assertEqual(json.dumps(before[year]['original']), json.dumps(after['original']))
            old_passage, new_passage = before[year]['passages'][0], after['passages'][0]
            self.assertEqual({k: v for k, v in old_passage.items() if k != 'ai'},
                             {k: v for k, v in new_passage.items() if k != 'ai'})
            self.assertEqual(after['enriched']['n'], 1)
            self.assertIn(stems('кассационная')[0], after['enriched']['post'])
            self.assertEqual(after['extra'], 'unchanged')
        concepts = json.loads((self.data/'concepts.json').read_text())
        self.assertEqual(concepts['glossary'], [{'понятие': 'источник'}])
        self.assertEqual(concepts['extra'], 'unchanged')
        self.assertTrue(all(v['pages_known'] == 1 and v['extra'] == 'unchanged' for v in concepts['volumes']))

    def test_stale_sha_and_unknown_id_are_ignored_and_old_ai_removed(self):
        self.annotate(0, dict(sha256='former-source', summary='Старое', concepts=[], evidence='Не существует'))
        dump(self.enrichment/'removed.json', dict(passages={'1904-099:0-9': self.annotations[0]}))
        self.annotate(1)
        report = refresh_published_enrichment(self.root, stems)
        self.assertEqual((report['valid'], report['stale'], report['unknown'], report['ignored']), (1, 1, 1, 2))
        current = json.loads((self.data/'passages-1904.json').read_text())
        self.assertNotIn('ai', current['passages'][0])
        self.assertEqual(current['enriched']['post'], {})
        self.assertEqual(current['enriched']['len'], [0])
        self.assertEqual(json.loads((self.enrichment/'1904.json').read_text())['passages'][self.ids[0]]['sha256'], 'former-source')

    def test_invalid_current_quote_in_last_volume_aborts_all_writes(self):
        self.annotate(0)
        self.annotate(1, dict(self.annotations[1], evidence='Цитата изъ другого рѣшенія.'))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'цитата обогащения'):
            refresh_published_enrichment(self.root, stems)
        self.assertEqual(self.snapshot(), before)

    def test_bad_current_summary_aborts_all_writes(self):
        self.annotate(0)
        self.annotate(1, dict(self.annotations[1], summary='   '))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'некорректная аннотация'):
            refresh_published_enrichment(self.root, stems)
        self.assertEqual(self.snapshot(), before)

    def test_source_warning_is_visible_but_excluded_from_enriched_index(self):
        warning = 'В опубликованном OCR смешан порядок колонок; юридическое пояснение недостоверно.'
        self.annotate(0, dict(self.annotations[0], source_warning=warning))
        self.annotate(1)
        refresh_published_enrichment(self.root, stems)
        current = json.loads((self.data/'passages-1904.json').read_text())
        self.assertEqual(current['passages'][0]['ai']['source_warning'], warning)
        self.assertTrue(current['passages'][0]['ai']['concepts'])
        self.assertEqual(current['enriched']['post'], {})
        self.assertEqual(current['enriched']['len'], [0])
        self.assertEqual(current['original'], self.original)

        coverage = json.loads((self.data/'concepts.json').read_text())['volumes'][0]
        self.assertEqual(coverage['source_warnings'], 1)
        self.assertEqual(coverage['enrichment_searchable'], 0)

    def test_invalid_source_warning_aborts_refresh_and_import(self):
        import enrich
        for invalid in ('   ', 42, None):
            with self.subTest(invalid=invalid):
                bad = dict(self.annotations[1], source_warning=invalid)
                self.annotate(0)
                self.annotate(1, bad)
                before = self.snapshot()
                with self.assertRaisesRegex(ValueError, 'предупреждение об источнике'):
                    refresh_published_enrichment(self.root, stems)
                self.assertEqual(self.snapshot(), before)
                response = self.root/'response.json'
                dump(response, dict(passages={self.ids[1]: bad}))
                saved = (self.enrichment/'1905.json').read_bytes()
                with patch.object(enrich, 'ROOT', self.root/'lex'), patch('sys.argv', ['enrich.py', 'import', str(response)]):
                    with self.assertRaisesRegex(ValueError, 'предупреждение об источнике'):
                        enrich.main()
                self.assertEqual((self.enrichment/'1905.json').read_bytes(), saved)

    def test_actual_source_hash_is_checked_before_writes(self):
        self.annotate(0)
        self.annotate(1)
        dump(self.data/'text-1905.json', ['Измѣнённый текстъ, хотя въ пассаже оставленъ прежній SHA-256.'])
        before = self.snapshot()
        with self.assertRaises(ValueError):
            refresh_published_enrichment(self.root, stems)
        self.assertEqual(self.snapshot(), before)
        with self.assertRaises(ValueError):
            published_corpus(self.root)

    def test_duplicate_annotation_id_aborts_all_writes(self):
        self.annotate(0)
        dump(self.enrichment/'duplicate.json', dict(passages={self.ids[0]: self.annotations[0]}))
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'повторные id'):
            refresh_published_enrichment(self.root, stems)
        self.assertEqual(self.snapshot(), before)

    def test_refresh_and_cli_are_idempotent(self):
        import enrich
        self.annotate(0)
        self.annotate(1)
        refresh_published_enrichment(self.root, stems)
        before = self.snapshot()
        report = refresh_published_enrichment(self.root, stems)
        self.assertEqual(report['changed_files'], [])
        with patch.object(enrich, 'ROOT', self.root/'lex'), patch('sys.argv', ['enrich.py', 'refresh']):
            enrich.main()
        self.assertEqual(self.snapshot(), before)

    def test_published_export_uses_actual_unicode_source_slice(self):
        items = published_corpus(self.root)
        self.assertEqual(len(items), 2)
        self.assertTrue(items[0]['text'].startswith('Сенатъ'))
        self.assertEqual(hashlib.sha256(items[0]['text'].encode('utf-8')).hexdigest(), items[0]['sha256'])


if __name__ == '__main__':
    unittest.main()
