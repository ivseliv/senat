"""Указатель: точные источники, существующие решения и сложные печатные строки."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from participants import load_participants

ROOT = Path(__file__).resolve().parent.parent


class IndexTests(unittest.TestCase):
    def test_all_printed_entries_have_current_sources_and_existing_decisions(self):
        docs = json.loads((ROOT/'lex/data/meta.json').read_text())['decisions']
        entries = load_participants(ROOT, docs)
        self.assertEqual(len(entries), 243)
        self.assertEqual(len({e['id'] for e in entries}), 243)
        covered = {d for e in entries for d in e['decisions']}
        self.assertEqual(covered, {f'1897-{n:03d}' for n in range(1,101) if n != 94})
        self.assertTrue(all(not d.get('participant_ids') for d in docs if d['vol'] != 1897))

    def test_page_breaks_shared_braces_and_group_headings_do_not_create_false_identities(self):
        index = json.loads((ROOT/'lex/participants/1897.json').read_text())
        entries = index['entries']
        palmer = next(e for e in entries if e['section']=='Конкурсныя управленія' and e['label'].startswith('Пальмера'))
        self.assertEqual([s['file'] for s in palmer['sources']], ['p0003_L.txt','p0003_R.txt'])
        self.assertEqual(palmer['decisions'], ['1897-080'])
        old_village = [e for e in entries if e['label'].startswith('Старой дер.')]
        self.assertEqual(len(old_village), 2)  # Повтор в издании сохраняется как две записи.
        self.assertTrue(all(e['decisions']==['1897-036'] for e in old_village))
        strutyn = [e for e in entries if e['label'].startswith('Струтын')]
        self.assertEqual(len(strutyn),2)
        self.assertTrue(all(e['decisions']==['1897-015'] for e in strutyn))
        for prefix in ['Неплюевы','Олимпіада','Урусова','Усольцева','Путята']:
            self.assertTrue(all(not e['section'] for e in entries if e['label'].startswith(prefix)))
        state_rail = [e for e in entries if e['section']=='Желѣзныя дороги' and e['label'].startswith('Казенныхъ')][0]
        self.assertEqual(state_rail['decisions'],['1897-017','1897-075','1897-084','1897-099'])

    def fake(self, change):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'ocr/1897').mkdir(parents=True);(root/'lex/participants').mkdir(parents=True)
            text='Ломоносова Марія, жена ст. сов. 44.'
            (root/'ocr/1897/p0001_L.txt').write_text(text)
            (root/'lex/page.webp').write_bytes(b'image')
            data={'year':1897,'sources':{'p0001_L.txt':{'image':'page.webp','ocr_sha256':hashlib.sha256(text.encode()).hexdigest()}},
                  'entries':[{'id':'entry-1','year':1897,'label':'Ломоносова Марія','section':'','decisions':['1897-044'],
                              'sources':[{'file':'p0001_L.txt','text':text}]}]}
            change(data)
            (root/'lex/participants/1897.json').write_text(json.dumps(data))
            return load_participants(root,[{'id':'1897-044','vol':1897}])

    def test_repeated_record_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'повторная'):
            self.fake(lambda d:d['entries'].append(copy.deepcopy(d['entries'][0])))

    def test_unknown_decision_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'неизвестное решение'):
            self.fake(lambda d:d['entries'][0].update(decisions=['1897-045']))

    def test_changed_ocr_requires_recheck(self):
        with self.assertRaisesRegex(ValueError,'устарел'):
            self.fake(lambda d:d['sources']['p0001_L.txt'].update(ocr_sha256='stale'))

    def test_invented_source_line_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'буквальной строки'):
            self.fake(lambda d:d['entries'][0]['sources'][0].update(text='придуманная строка'))

    def test_invented_name_with_real_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError,'название отсутствует'):
            self.fake(lambda d:d['entries'][0].update(label='Придуманный участник'))


if __name__ == '__main__':
    unittest.main()
