"""Поисковые разделы без изменения проверенных разборов и первоисточника."""
import argparse
import hashlib
import json
from pathlib import Path
from decision_analyses import read, load_texts

DATA = Path(__file__).resolve().parent / 'data'
OUT = DATA / 'analysis-search.json'
KINDS = {
    'question': 'Спор и вопрос', 'party': 'Доводы стороны / инициатора',
    'lower': 'Нижестоящие суды и предшествующее рассмотрение',
    'reasoning': 'Рассуждение Сената', 'ruling': 'Постановление Сената',
    'limits': 'Пределы вывода',
}
SECTION_HEADINGS = {
    'question': ('Спор и внесённый вопрос', 'Спор и внесенный вопрос', 'Спор и требование',
        'Спор и требования', 'О чём спорили', 'Внесенный вопрос', 'Вопрос Сената',
        'Вопросы Сената', 'Вопрос, который разрешает Сенат', 'Вопросы, которые разрешает Сенат',
        'Какой вопрос проверял Сенат'),
    'party': ('Позиция инициатора / Жалоба', 'Позиция инициатора', 'Позиция инициаторов',
        'Позиция инициатора и требование наследниц', 'Жалоба', 'На что жаловались',
        'Доводы жалобы', 'Доводы жалоб', 'Две кассационные жалобы', 'Кассационная жалоба',
        'Жалоба и предел известной позиции', 'Доводы и кассационная жалоба'),
    'lower': ('Предшествующее рассмотрение', 'Предшествующая практика', 'Нижестоящие суды',
        'Нижестоящее рассмотрение', 'Что решили нижестоящие суды'),
    'reasoning': ('Рассуждение Сената', 'Как рассуждал Сенат'),
    'ruling': ('Постановление', 'Что постановил Сенат'),
    'limits': ('Пределы вывода', 'Оговорки и пределы'),
}
SECTION_KINDS = {heading:kind for kind, headings in SECTION_HEADINGS.items() for heading in headings}


def section_kind(heading):
    # Каждый опубликованный заголовок отнесён явно. Новому заголовку нужна проверка.
    if heading not in SECTION_KINDS:
        raise ValueError(f'Не определён вид раздела: {heading}')
    return SECTION_KINDS[heading]


def build(analyses=None, catalog=None, meta=None):
    analyses = analyses if analyses is not None else read(DATA / 'decision-analyses.json')
    catalog = catalog if catalog is not None else read(DATA / 'topic-catalog.json')
    meta = meta if meta is not None else read(DATA / 'meta.json')
    texts = load_texts(meta)
    if set(analyses['decisions']) != set(texts):
        raise ValueError('Поиск разборов должен охватывать весь корпус')
    rows, cases = [], {}
    for ident, analysis in analyses['decisions'].items():
        text = texts[ident]
        if hashlib.sha256(text.encode()).hexdigest() != analysis['source_sha256']:
            raise ValueError(f'{ident}: устаревший источник разбора')
        case = catalog['decisions'][ident]
        cases[ident] = dict(id=ident, year=analysis['year'], department=analysis['department'],
            title=case['title'], summary=case['summary'], source_sha256=analysis['source_sha256'],
            topics=[t['id'] for t in case['topics']])
        for index, section in enumerate(analysis['sections']):
            quotes, evidence = [], []
            for ev in section['evidence']:
                if text[ev['start']:ev['end']] != ev['text'] or not ev['scans']:
                    raise ValueError(f'{ident}: цитата раздела не подтверждена')
                quotes.append(ev['text'])
                evidence.append(dict(start=ev['start'],end=ev['end'],printed_pages=ev['printed_pages']))
            rows.append(dict(id=f'{ident}:s{index}', decision=ident, section=index,
                kind=section_kind(section['heading']), heading=section['heading'],
                speaker=section['speaker'], summary=section['summary'], quotes=quotes, evidence=evidence))
    payload = dict(schema_version=1, label='Поиск по редакционным разборам, подготовленным с помощью ИИ',
        kinds=KINDS, count=len(cases), section_count=len(rows), decisions=cases, sections=rows)
    payload['revision'] = hashlib.sha256(json.dumps(payload,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    return payload


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    data=build();encoded=json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n'
    if args.check:
        if not OUT.is_file() or OUT.read_text()!=encoded: raise SystemExit('analysis-search.json устарел')
    else: OUT.write_text(encoded,encoding='utf-8')
    print(f'Поиск разборов: {data["count"]} дел, {data["section_count"]} разделов.')
