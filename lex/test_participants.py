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
        self.assertEqual(len(entries), 790)
        self.assertEqual(len({e['id'] for e in entries}), 790)
        covered = {d for e in entries for d in e['decisions']}
        expected = ({f'1897-{n:03d}' for n in range(1,101) if n != 94}
                    | {f'1904-{n:03d}' for n in range(1,121) if n not in (19, 33)}
                    | {f'1905-{n:03d}' for n in range(1,116) if n not in (59, 115)})
        self.assertEqual(covered, expected)
        self.assertEqual({year: sum(e['year'] == year for e in entries) for year in (1897,1904,1905)},
                         {1897: 243, 1904: 275, 1905: 272})

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

    def test_1904_and_1905_preserve_repeated_records_and_compound_references(self):
        docs = json.loads((ROOT/'lex/data/meta.json').read_text())['decisions']
        entries = load_participants(ROOT, docs)
        rail_admin = [e for e in entries if e['year'] == 1904 and e['label'] == 'Управленіе желѣзныхъ дорогъ']
        self.assertEqual(len(rail_admin), 2)  # В указателе есть запись под «Ж» и повтор под «У».
        broken = next(e for e in rail_admin if len(e['sources']) == 2)
        self.assertEqual(broken['decisions'], [f'1904-{n:03d}' for n in (3,14,20,31,32,38,39,43,61,91,93,102,106)])
        balkashin = next(e for e in entries if e['year'] == 1905 and e['label'].startswith('Балкашинъ'))
        self.assertEqual(balkashin['decisions'], ['1905-049','1905-055'])
        don = next(e for e in entries if e['year'] == 1905 and e['label'].startswith('Донскаго войска'))
        self.assertEqual(don['decisions'], ['1905-013','1905-014'])
        self.assertTrue(all(not source.get('image') for e in entries if e['year'] in (1904,1905) for source in e['sources']))

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
