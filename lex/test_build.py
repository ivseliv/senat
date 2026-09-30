#!/usr/bin/env python3
"""Проверки границ решений при составных и повреждённых датах OCR."""
import unittest
from build import split_volume

ANCHOR = '(Предсѣдательствовалъ сенаторъ Ивановъ).'

def decision(header, body):
    return f'{header}\n\n{ANCHOR}\n\n{body}'

class VolumeParsingTests(unittest.TestCase):
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

if __name__ == '__main__':
    unittest.main()
