"""Производный поисковый слой; исторический исходник не изменяется."""
import collections
import re

LETTERS = 'А-Яа-яЁёѢѣІіѲѳѴѵ'
MIXED = re.compile(r'(?=\w*[а-яёѣіѳѵ])(?=\w*[a-zA-Z])\w+', re.I)
LAT2CYR = str.maketrans('aeopcxyiABCEHKMOPTXI', 'аеорсхуіАВСЕНКМОРТХІ')
JOIN = re.compile(r'([' + LETTERS + r']{3,})-[ \t\r\n]+([а-яёѣіѳѵ]{2,})')


def normalize_ocr(text, modernize, known_words=None):
    """Смешанная латиница и только подтверждённые словарём корпуса переносы."""
    changes = []

    def mixed(match):
        before = match.group()
        after = before.translate(LAT2CYR)
        if before != after:
            changes.append(dict(from_=before, to=after, kind='mixed-script'))
        return after

    text = MIXED.sub(mixed, text)
    if known_words:
        def join(match):
            after = match[1] + match[2]
            key = modernize(after).lower().replace('ё', 'е')
            if key in known_words:
                changes.append(dict(from_=match.group(), to=after, kind='hyphenation'))
                return after
            return match.group()
        text = JOIN.sub(join, text)
    return text, [dict((('from' if k == 'from_' else k), v) for k, v in c.items()) for c in changes]


def known_words_for(texts, modernize):
    """Полные нормализованные слова, встречающиеся в корпусе без переноса."""
    words = set()
    for text in texts:
        cleaned, _ = normalize_ocr(text, modernize)
        words.update(re.findall(r'[а-я]+', modernize(cleaned).lower().replace('ё', 'е')))
    return words


def build_search_assets(bodies, stems, modernize, stem, heads=None, known_words=None):
    """Дополнительные поля для существующего точного индекса.

    ``sequences[doc]`` разделяет заголовок и тело. Независимый OCR-индекс
    использует те же ID документов, хранит исправления только для изменённых
    документов и словарь полных слов. Исходные BM25-поля и тексты не заменяются.
    """
    bodies = list(bodies)
    heads = list(heads) if heads is not None else None
    if heads is not None and len(heads) != len(bodies):
        raise ValueError('Число заголовков не совпадает с числом текстов')
    parts = [([heads[i], body] if heads is not None else [body]) for i, body in enumerate(bodies)]
    if known_words is None:
        known_words = known_words_for((p for group in parts for p in group), modernize)

    def all_stems(text):
        return [stem(w) for w in re.findall(r'[а-я0-9]+', modernize(text).lower().replace('ё', 'е'))]

    original = [[all_stems(part) for part in group] for group in parts]
    fixed, changes = [], {}
    for i, group in enumerate(parts):
        cleaned, edits = [], []
        for part in group:
            result, corrections = normalize_ocr(part, modernize, known_words)
            cleaned.append(result)
            for correction in corrections:
                correction['terms'] = stems(correction['to'])
                if correction not in edits:
                    edits.append(correction)
        fixed.append(cleaned)
        if edits:
            changes[str(i)] = edits

    def encode(groups):
        vocabulary = sorted({term for group in groups for part in group for term in part})
        ids = {term: i for i, term in enumerate(vocabulary)}
        return dict(vocabulary=vocabulary, sequences=[[[ids[t] for t in part] for part in group] for group in groups])

    post, hpost, lengths = {}, {}, []
    lexicon = set()
    for i, group in enumerate(fixed):
        terms = [term for part in group for term in stems(part)]
        lengths.append(len(terms))
        for term, count in collections.Counter(terms).items():
            post.setdefault(term, []).extend([i, count])
        if heads is not None:
            for term, count in collections.Counter(stems(group[0])).items():
                hpost.setdefault(term, []).extend([i, count])
        for part in group:
            lexicon.update(w for w in re.findall(r'[а-я]+', modernize(part).lower().replace('ё', 'е')) if len(w) >= 7)
    ocr = dict(n=len(parts), len=lengths, avgdl=sum(lengths)/max(1, len(parts)),
               post=post, hpost=hpost, changes=changes, lexicon=sorted(lexicon))
    ocr.update(encode([[all_stems(part) for part in group] for group in fixed]))
    assets = encode(original)
    # Пассажи уже используют плоскую sequence; сохраняем согласованные ID,
    # не дублируя ту же последовательность в двух полях JSON.
    if heads is None:
        assets['sequence'] = [group[0] for group in assets.pop('sequences')]
        ocr['sequence'] = [group[0] for group in ocr.pop('sequences')]
    assets['ocr'] = ocr
    return assets
