#!/usr/bin/env python3
"""Проверки границ решений при составных и повреждённых датах OCR."""
import unittest
from build import participant_groups, split_volume

ANCHOR = '(Предсѣдательствовалъ сенаторъ Ивановъ).'

def decision(header, body):
    return f'{header}\n\n{ANCHOR}\n\n{body}'

class VolumeParsingTests(unittest.TestCase):
    def test_printer_signature_does_not_hide_next_header(self):
        raw = '\n\n'.join([
            decision('10.—1897 года февраля 5-го дня. Первое дело.', 'Первое решение.'),
            decision('Гражд. 1897 г. 4 11.—1897 года февраля 12-го дня. Второе дело.', 'Второе решение.'),
        ])
        _, decisions, _ = split_volume(raw)
        self.assertEqual([d['num'] for d in decisions], [10, 11])
        self.assertEqual(decisions[1]['date'], '1897-02-12')
        self.assertEqual(decisions[1]['headnote'], 'Второе дело.')

    def test_printed_date_without_year_word(self):
        # В №7 за 1897 год слово «года» отсутствует в самом издании.
        raw = decision('7.—1897 февраля 5-го дня. Дело Рубинштейна.', 'Рассуждение Сената.')
        _, decisions, _ = split_volume(raw)
        self.assertEqual(decisions[0]['num'], 7)
        self.assertEqual(decisions[0]['date'], '1897-02-05')
        self.assertEqual(decisions[0]['headnote'], 'Дело Рубинштейна.')

    def test_front_index_does_not_hide_decisions(self):
        raw = '\n\n'.join([
            'РѢШЕНІЯ ГРАЖДАНСКАГО КАССАЦІОННАГО ДЕПАРТАМЕНТА.',
            'АЛФАВИТНЫЙ УКАЗАТЕЛЬ лицъ.',
            'Ивановъ — 1. Петровъ — 2.',
            decision('1.—1897 года января 15-го дня. Первое дело.', 'Первое решение.'),
            decision('2.—1897 года января 15-го дня. Второе дело.', 'Второе решение.'),
        ])
        _, decisions, back = split_volume(raw)
        self.assertEqual([d['num'] for d in decisions], [1, 2])
        self.assertEqual(decisions[-1]['text'], 'Второе решение.')
        self.assertEqual(back, '')

    def test_front_and_back_indexes_are_distinguished(self):
        raw = '\n\n'.join([
            'АЛФАВИТНЫЙ УКАЗАТЕЛЬ лицъ передъ текстомъ.',
            decision('1.—1897 года января 15-го дня. Дело.', 'Рассуждение Сената.'),
            'Алфавитный указатель законовъ.',
            'Статья 1254 — решение 1.',
        ])
        _, decisions, back = split_volume(raw)
        self.assertEqual(len(decisions), 1)
        self.assertEqual(decisions[0]['text'], 'Рассуждение Сената.')
        self.assertEqual(back, 'Алфавитный указатель законовъ.\n\nСтатья 1254 — решение 1.')

    def test_compound_date_does_not_merge_adjacent_decisions(self):
        raw = '\n\n'.join([
            decision('41.—1904 года марта 3-го дня. Первое дело.', 'Рассуждение первого решения.'),
            decision('42.—1903/₄ года декабря 17 / февраля 11 -го дня. Дело о завѣщаніи.', 'Рассуждение второго решения.'),
            decision('43.—1904 года апрѣля 21-го дня. Третье дело.', 'Рассуждение третьего решения.'),
        ])
        _, decisions, _ = split_volume(raw)
        self.assertEqual([d['num'] for d in decisions], [41, 42, 43])
        self.assertEqual(decisions[0]['text'], 'Рассуждение первого решения.')
        self.assertEqual(decisions[1]['text'], 'Рассуждение второго решения.')
        self.assertEqual(decisions[2]['text'], 'Рассуждение третьего решения.')
        self.assertEqual(decisions[0]['date'], '1904-03-03')
        self.assertEqual(decisions[2]['date'], '1904-04-21')
        self.assertIsNone(decisions[1]['date'])
        self.assertEqual(decisions[1]['date_label'], '1903/₄ года декабря 17 / февраля 11 -го дня')
        self.assertEqual(decisions[1]['headnote'], 'Дело о завѣщаніи.')

    def test_unparenthesized_court_composition(self):
        raw = decision('94.—1897 года октября 15-го дня. Вопрос нотариусам.', 'Вывод Сената.').replace(ANCHOR, 'Предсѣдательствовалъ сенаторъ Ивановъ.')
        _, decisions, _ = split_volume(raw)
        self.assertEqual([d['num'] for d in decisions], [94])
        self.assertEqual(decisions[0]['text'], 'Вывод Сената.')

    def test_date_with_two_days_keeps_both_days(self):
        raw = decision('95.—1897 года октября 29/30 чиселъ. Дело.', 'Текст.')
        _, decisions, _ = split_volume(raw)
        self.assertIsNone(decisions[0]['date'])
        self.assertEqual(decisions[0]['date_label'], '1897 года октября 29/30 чиселъ')
        self.assertEqual(decisions[0]['headnote'], 'Дело.')

    def test_duplicate_numbers_stop_build(self):
        raw = '\n\n'.join([
            decision('63.—1904 года апрѣля 14-го дня. Дело.', 'Первый ответ OCR.'),
            decision('63.—1904 года апрѣля 14-го дня. Дело.', 'Повторный ответ OCR.'),
        ])
        with self.assertRaisesRegex(ValueError, 'Повторные номера'):
            split_volume(raw)

    def test_two_dates_in_same_year_are_not_reduced_to_first_date(self):
        raw = decision('42.—1904 года марта 3 / апрѣля 21 -го дня. Дело.', 'Текст решения.')
        _, decisions, _ = split_volume(raw)
        self.assertIsNone(decisions[0]['date'])
        self.assertEqual(decisions[0]['date_label'], '1904 года марта 3 / апрѣля 21 -го дня')

    def test_unreadable_numbered_header_stops_build(self):
        raw = '\n\n'.join([
            decision('41.—1904 года марта 3-го дня. Дело.', 'Первое решение.'),
            decision('42.—1904 года [?]. Дело.', 'Второе решение.'),
        ])
        with self.assertRaisesRegex(ValueError, 'Не распознан заголовок'):
            split_volume(raw)


class ParticipantFacetTests(unittest.TestCase):
    def test_explicit_demographic_and_social_markers(self):
        groups = participant_groups(
            'Прошеніе вдовы Анны, опекуна надъ малолѣтними дѣтьми крестьянина Иванова, '
            'по иску къ земскому банку и сельскому обществу.'
        )
        self.assertIn('Женщины', groups['gender'])
        self.assertIn('Мужчины', groups['gender'])
        self.assertEqual(groups['age'], ['Дети', 'Малолетние'])
        self.assertIn('Вдовы и вдовцы', groups['family'])
        self.assertIn('Крестьяне', groups['estate'])
        self.assertIn('Банки и кредитные учреждения', groups['entity'])
        self.assertIn('Сельские общества и общины', groups['entity'])
        self.assertIn('Опекуны и попечители', groups['role'])

    def test_names_and_representatives_do_not_imply_gender(self):
        groups = participant_groups(
            'Прошеніе повѣреннаго Маріи Ивановой, присяжнаго повѣреннаго Петрова, '
            'объ отмѣнѣ рѣшенія палаты.'
        )
        self.assertNotIn('gender', groups)
        self.assertNotIn('age', groups)

    def test_legal_roles_and_organizations_are_separate_facets(self):
        groups = participant_groups(
            'Прошеніе душеприказчиковъ и наслѣдниковъ купца по иску къ акціонерному '
            'обществу желѣзной дороги и конкурсному управленію несостоятельнаго должника.'
        )
        self.assertIn('Купцы и торговцы', groups['estate'])
        self.assertIn('Компании и товарищества', groups['entity'])
        self.assertIn('Железные дороги и перевозчики', groups['entity'])
        self.assertIn('Опеки и конкурсные управления', groups['entity'])
        self.assertIn('Наследники', groups['role'])
        self.assertIn('Душеприказчики', groups['role'])
        self.assertIn('Несостоятельные должники', groups['role'])

    def test_words_in_company_name_do_not_become_family_members(self):
        groups = participant_groups(
            'Прошеніе несостоятельнаго должника, торговавшаго подъ фирмою '
            '„Джонъ Смитъ и сынъ“, объ отмѣнѣ рѣшенія.'
        )
        self.assertNotIn('family', groups)
        self.assertNotIn('gender', groups)
        self.assertIn('Компании и товарищества', groups['entity'])
        self.assertIn('Несостоятельные должники', groups['role'])

if __name__ == '__main__':
    unittest.main()
