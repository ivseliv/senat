#!/usr/bin/env python3
"""Собирает корпус для поиска и аналитики из распознанных томов.

  python3 lex/build.py            # все тома, у которых есть ocr/<год>/volume.txt

Читает:   ocr/<том>/volume.txt
Пишет:    lex/data/meta.json        метаданные решений (без текстов)
          lex/data/text-<том>.json  тексты решений (оригинальная орфография)
          lex/data/index.json       обратный индекс для поиска в браузере
          lex/data/analytics.json   готовая аналитика
          lex/data/backmatter-<том>.txt  указатели из конца тома (пока не разбираются)

Нормализация (modernize, stem, tokens) намеренно продублирована в lex/index.html
и проверяется тестом lex/test_parity.py, чтобы запрос и индекс совпадали.
"""
import collections, glob, json, math, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'lex', 'data')

# ---------------------------------------------------------------- нормализация

def modernize(s):
    for a, b in (('ѣ', 'е'), ('Ѣ', 'Е'), ('ѳ', 'ф'), ('Ѳ', 'Ф'), ('ѵ', 'и'), ('Ѵ', 'И'), ('і', 'и'), ('І', 'И')):
        s = s.replace(a, b)
    s = re.sub(r'(?<=[бвгджзйклмнпрстфхцчшщБВГДЖЗЙКЛМНПРСТФХЦЧШЩ])[ъЪ](?![а-яА-ЯёЁ])', '', s)
    s = re.sub(r'(?<=[жчшщЖЧШЩ])аго(?![а-яА-ЯёЁ])', 'его', s)
    s = re.sub(r'ого(?![а-яА-ЯёЁ])', 'ого', s)
    s = re.sub(r'аго(?![а-яА-ЯёЁ])', 'ого', s)
    s = re.sub(r'яго(?![а-яА-ЯёЁ])', 'его', s)
    s = re.sub(r'(?<=[кгхжчшщ])ія(?![а-яА-ЯёЁ])', 'ие', s)
    s = re.sub(r'ыя(?![а-яА-ЯёЁ])', 'ые', s)
    s = re.sub(r'ія(?![а-яА-ЯёЁ])', 'ия', s)
    s = re.sub(r'(?<![а-яА-ЯёЁ])чрез(?![а-яА-ЯёЁ])', 'через', s)
    return s

ENDINGS = sorted(['иями', 'ями', 'ами', 'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ать', 'ять', 'ить', 'еть', 'ыть', 'ует',
                  'ают', 'яет', 'ает', 'ой', 'ый', 'ий', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ых', 'их', 'ов', 'ев', 'ей',
                  'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ую', 'юю', 'ою', 'ею', 'ия', 'ии', 'ью', 'ье', 'ья', 'а', 'я', 'о',
                  'е', 'ы', 'и', 'у', 'ю', 'ь', 'й'], key=len, reverse=True)
STOP = set('и в во на по что не как с со к ко от из о об для за при или но а же ли бы то это этот эта эти был была были было '
           'быть есть либо также ему его ее их им ими они она оно он до над под про без между через так тем чем то'.split())

def stem(w):
    if w.isdigit():
        return w
    if len(w) <= 5:
        return w[:-1] if len(w) >= 4 and w[-1] in 'аяуюыиеоь' else w
    for e in ENDINGS:
        if w.endswith(e) and len(w) - len(e) >= 4:
            w = w[:-len(e)]
            break
    return w[:7]

def tokens(text):
    t = modernize(text).lower().replace('ё', 'е')
    return [w for w in re.findall(r'[а-я0-9]+', t) if len(w) > 1 and w not in STOP]

def stems(text):
    return [stem(w) for w in tokens(text)]

# ---------------------------------------------------------------- разбор тома

MONTHS = {'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6, 'июля': 7, 'августа': 8,
          'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12}
HDR = re.compile(r'^([З\d]{1,3})\s*[.,]\s*[—–\-]?\s*(\d{4})\s+года\s+([А-Яа-яѢѣІі]+)\s+(\d{1,2})', re.I)
ANCHOR = re.compile(r'^\(\s*Предс[ѣе]дательствовал', re.I)
PERSON = re.compile(r'((?:[А-ЯЁІѢ]\.\s?){1,3})\s*([А-ЯЁІѢ][А-Яа-яЁёѢѣІіѲѳѴѵъь\-]+)')
TITLE_WORDS = re.compile(r'\b(первоприсутствующій|сенаторъ|товарищъ|оберъ-прокурора|оберъ-прокуроръ|исп\.|обяз\.|графъ|баронъ|князь)\b', re.I)

def parse_date(month, day, year):
    m = MONTHS.get(modernize(month).lower())
    return f'{year:04d}-{m:02d}-{int(day):02d}' if m else None

def person(s):
    ms = list(PERSON.finditer(s))
    if not ms:
        return None
    m = ms[-1]
    initials = re.sub(r'\s+', ' ', m.group(1)).strip()
    return m.group(2) + ' ' + initials

def department(head):
    h = head.lower()
    if 'общаго собранія' in h or 'общее собрание' in h:
        return 'Общее собрание'
    if 'гражданскаго кассаціоннаго' in h:
        return 'Гражданский кассационный департамент'
    if 'уголовнаго кассаціоннаго' in h:
        return 'Уголовный кассационный департамент'
    return 'Правительствующий Сенат'

def split_volume(text):
    paras = [p.strip() for p in text.split('\n\n') if p.strip()]
    back = next((i for i, p in enumerate(paras) if re.match(r'^Алфавитный указатель', p, re.I)), len(paras))
    front = ' '.join(paras[:8])
    anchors = [i for i, p in enumerate(paras[:back]) if ANCHOR.match(p)]
    heads = []
    for i in anchors:
        h = paras[i - 1]
        m = HDR.match(h)
        if m:
            heads.append((i - 1, i, m, h))
    decs = []
    for k, (hi, ai, m, h) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else back
        num = int(m.group(1).replace('З', '3'))
        year, day = int(m.group(2)), m.group(4)
        head_rest = re.sub(r'^.*?\d{1,2}[-\s]*(?:го|ое|е)?\s*дня\.?\s*', '', h, count=1, flags=re.I)
        anchor = paras[ai]
        pm = re.search(r'Предс[ѣе]дательствовал[ъ]?\s*(.*?);\s*докладывал[ъ]?\s*д[ѣе]ло\s*(.*?);\s*заключеніе\s*давал[ъ]?\s*(.*?)\)?\s*$', anchor, re.I | re.S)
        body = '\n\n'.join(paras[ai + 1:end])
        decs.append(dict(num=num, date=parse_date(m.group(3), day, year), headnote=head_rest.strip(),
                         presiding=person(pm.group(1)) if pm else None, reporter=person(pm.group(2)) if pm else None,
                         prosecutor=person(pm.group(3)) if pm else None, anchor=anchor, text=body))
    return front, decs, '\n\n'.join(paras[back:])

# ---------------------------------------------------------------- теги

TOPICS = [
    ('Наследство и завещания', r'наслед|завещ|душеприказч|легат|отказополуч'),
    ('Опека, недееспособность', r'опек|попечит|прещени|малолетн|несовершеннолетн|душевн\w+ болез'),
    ('Семья и брак', r'брак|развод|супруг|алимент|незаконнорожд|усыновл|раздельн\w+ жительств'),
    ('Недвижимость и земля', r'недвижим|земельн|участк|дач|межев|крепост|запродаж|сервитут|владени'),
    ('Аренда и наём', r'аренд|наем|найм|съем'),
    ('Договоры и обязательства', r'договор|обязательств|неустойк|поручительств|задаток|подряд|купл|продаж'),
    ('Векселя, займы, залог', r'вексел|заем|займ|заклад|ипотек|залог|заемн'),
    ('Торговые и акционерные общества', r'торгов|акционер|товариществ|компани|биржев|фирм|общество'),
    ('Несостоятельность', r'несостоятельн|конкурс|банкрот'),
    ('Железные дороги и перевозки', r'желез\w+ дорог|перевоз|вагон|пароход|грузов'),
    ('Возмещение вреда', r'возмещени\w+ (?:вреда|ущерба|убытк)|вред|увечь|убытк'),
    ('Подсудность и процесс', r'подсудн|подведомств|кассаци|апелляци|давност|обжалован'),
    ('Судебные издержки и пошлины', r'издержк|пошлин|гербов|право бедности'),
    ('Доказательства', r'доказательств|свидетел|присяг|экспертиз|расписк|показани'),
    ('Нотариат и акты', r'нотариус|нотариальн|акт[аы]?\b|реестр'),
    ('Казна и государственная служба', r'казн|казенн|ведомств|чиновник|служб\w+|пенси'),
    ('Страхование', r'страхов'),
    ('Крестьяне, общины, сословия', r'крестьян|волост|общин|сословн|мещан|казак'),
    ('Окраины и местные законы', r'польск|варшав|прибалти|лифлянд|эстлянд|курлянд|закавказ|финлянд|остзейск|кавказ'),
    ('Церковь и духовенство', r'духовн|церков|приход|монастыр|епархи'),
]
TOPIC_RX = [(n, re.compile(rx)) for n, rx in TOPICS]

def topics_for(headnote, body):
    hn, bd = modernize(headnote).lower(), modernize(body).lower()
    sc = []
    for name, rx in TOPIC_RX:
        s = 4 * len(rx.findall(hn)) + len(rx.findall(bd)) * 1000 / max(1000, len(bd))
        if s >= 3:
            sc.append((s, name))
    return [n for _, n in sorted(sc, reverse=True)[:3]]

def outcome_for(text):
    t = modernize(text).lower()
    i = max(t.rfind('определяет'), t.rfind('определил'), t.rfind('полагает'))
    res = t[i:] if i >= 0 else t[-600:]
    res = res[:900]
    if re.search(r'отмен', res) and re.search(r'(передат|направит|обратит|возврат|для нового)', res):
        return 'Отменено, дело направлено на новое рассмотрение', res
    if re.search(r'отмен', res):
        return 'Отменено', res
    if re.search(r'без (последствий|уважения|рассмотрения)', res):
        return 'Просьба оставлена без последствий', res
    if re.search(r'отказат', res):
        return 'В просьбе отказано', res
    if re.search(r'утвердит|оставить в силе', res):
        return 'Оставлено в силе', res
    if re.search(r'разъясн|предписат|указ\b', res):
        return 'Разъяснение / предписание', res
    if re.search(r'удовлетвор', res):
        return 'Просьба удовлетворена', res
    return 'Иное', res

CODES = [
    ('УГС', 'Устав гражданского судопроизводства', r'уст(?:ав\w*|\.)?\s*гр(?:аж\w*|\.)?\s*суд'),
    ('УУС', 'Устав уголовного судопроизводства', r'уст(?:ав\w*|\.)?\s*уг(?:ол\w*|\.)?\s*суд'),
    ('УСУ', 'Учреждение судебных установлений', r'учр(?:еждени\w*|\.)?\s*суд(?:еб\w*|\.)?\s*уст'),
    ('УТ', 'Устав торговый (Свод законов, т. XI ч. 2)', r'уст(?:ав\w*|\.)?\s*торг|т\.?\s*xi\b|т\.?\s*хi\b|т\.?\s*хи\b'),
    ('СЗГ', 'Свод законов гражданских (т. X ч. 1)', r'св\.?\s*зак\.?\s*гр|т\.?\s*[xх]\s*ч\.?\s*1|[xх]\s*т\.?\s*1\s*ч|1\s*ч\.?\s*[xх]\s*т|зак\.?\s*гражд'),
    ('УЖД', 'Общий устав российских железных дорог', r'общ\.?\s*уст\.?\s*(?:росс\.?\s*)?ж(?:ел)?\.?\s*д|уст\.?\s*жел'),
    ('ГКП', 'Гражданский кодекс Царства Польского', r'гр\.?\s*код|гражд\.?\s*код'),
    ('УН', 'Уложение о наказаниях', r'улож\.?\s*о\s*нак|уст\.?\s*о\s*нак'),
    ('ПОЛ', 'Положение о введении Судебных уставов (1865)', r'полож\.?\s*(?:19\s*окт|о\s*введ)'),
]
CODE_RX = [(c, n, re.compile(rx)) for c, n, rx in CODES]
ART = re.compile(r'\bст(?:ст)?\.?\s*((?:\d+[¹²³⁰-⁹]*(?:\s*п\.\s*\d+)?(?:\s*[—–-]\s*\d+)?(?:\s*(?:,|и)\s*)?)+)')
PRE_ART = re.compile(r'(?<![\d\w])(\d{3,4})\s*ст\.?\s*(?=(?:[xх]\s*т|1\s*ч))')   # «683 ст. X т. 1 ч.»

def code_near(t, a, b):
    after, before = t[b:b + 80], t[max(0, a - 60):a]
    best = None
    for c, n, rx in CODE_RX:
        m = rx.search(after)
        if m and m.start() < 45 and (best is None or m.start() < best[0]):
            best = (m.start(), c)
    if best:
        return best[1]
    for c, n, rx in CODE_RX:            # код назван перед номером: «Уст. гр. суд. ст. 186»
        ms = list(rx.finditer(before))
        if ms and len(before) - ms[-1].end() < 8:
            return c
    return None

def statutes_for(text):
    t = modernize(text).lower()
    out = collections.Counter()
    for m in PRE_ART.finditer(t):
        out[f'СЗГ ст. {m.group(1)}'] += 1
    last_code, last_end = None, -999
    for m in ART.finditer(t):
        tail = t[m.end():m.end() + 25]
        if re.match(r'\s*(?:настоящ\w+\s+)?(?:договор|контракт|устав[аеу]?\s+(?:общ|товар|банк|акц)|акта|положени\w+\s+о\s+(?!введ))', tail):
            continue                     # статья договора или устава организации
        code = code_near(t, m.start(), m.end())
        if code:
            last_code, last_end = code, m.end()
        elif last_code and m.start() - last_end < 250:
            code = last_code             # «… ст. 683 т. X ч. 1 …, ст. 684» — тот же кодекс
            last_end = m.end()
        code = code or '?'
        for part in re.split(r'\s*(?:,|и)\s*', m.group(1).strip().rstrip(',')):
            part = re.sub(r'\s+', ' ', part).replace('—', '–').replace('-', '–').strip()
            if not part or (code == '?' and re.fullmatch(r'[0-9]{1,2}', part) and int(part) < 30):
                continue
            out[f'{code} ст. {part}'] += 1
    return dict(out)

CITE = re.compile(r'(\d{4})\s*г(?:ода|\.)?[,\s]*(?:№|n)\s*(\d+(?:\s*(?:,|и)\s*(?:№\s*)?\d+)*)')

def cites_for(text, own_year):
    t = modernize(text).lower()
    found = set()
    for m in CITE.finditer(t):
        if 'реш' not in t[max(0, m.start() - 120):m.start()] and 'по дел' not in t[max(0, m.start() - 60):m.start()]:
            continue
        y = int(m.group(1))
        if not 1860 <= y <= own_year + 1:
            continue
        for n in re.findall(r'\d+', m.group(2)):
            if int(n) <= 600:
                found.add((y, int(n)))
    return sorted(found)

# ---------------------------------------------------------------- сборка

def main():
    os.makedirs(OUT, exist_ok=True)
    vols, docs, texts = [], [], {}
    for vf in sorted(glob.glob(os.path.join(ROOT, 'ocr', '*', 'volume.txt'))):
        year = os.path.basename(os.path.dirname(vf))
        if not year.isdigit():
            continue
        raw = open(vf, encoding='utf-8').read()
        front, decs, back = split_volume(raw)
        dept = department(front)
        nums = [d['num'] for d in decs]
        gaps = [n for n in range(min(nums), max(nums) + 1) if n not in nums] if nums else []
        vols.append(dict(year=int(year), dept=dept, decisions=len(decs), gaps=gaps, file=f'text-{year}.json'))
        open(os.path.join(OUT, f'backmatter-{year}.txt'), 'w', encoding='utf-8').write(back)
        vt = []
        for d in decs:
            i = len(docs)
            oc, res = outcome_for(d['text'])
            full = d['headnote'] + '\n' + d['text']
            docs.append(dict(i=i, id=f'{year}-{d["num"]:03d}', vol=int(year), num=d['num'], date=d['date'], dept=dept,
                             headnote=d['headnote'], presiding=d['presiding'], reporter=d['reporter'],
                             prosecutor=d['prosecutor'], outcome=oc, topics=topics_for(d['headnote'], d['text']),
                             statutes=statutes_for(full), cites=[list(c) for c in cites_for(full, int(year))],
                             words=len(tokens(d['text'])), _stems=stems(full), _hstems=stems(d['headnote'])))
            vt.append(d['text'])
        texts[year] = vt
    unify_persons(docs)
    # --- обратный индекс
    df = collections.Counter(); post = {}; hpost = {}; lens = []
    for d in docs:
        tf = collections.Counter(d['_stems'])
        lens.append(len(d['_stems']))
        for s, c in tf.items():
            post.setdefault(s, []).extend([d['i'], c])
        for s, c in collections.Counter(d['_hstems']).items():
            hpost.setdefault(s, []).extend([d['i'], c])
    index = dict(n=len(docs), avgdl=sum(lens) / max(1, len(lens)), len=lens, post=post, hpost=hpost)
    # --- похожие решения (косинус по tf-idf)
    N = len(docs); idf = {s: math.log(1 + N / (len(p) / 2)) for s, p in post.items()}
    vec = []
    for d in docs:
        tf = collections.Counter(d['_stems'])
        v = {s: (1 + math.log(c)) * idf[s] for s, c in tf.items() if len(post[s]) // 2 < N * 0.5 and len(s) > 2}
        nrm = math.sqrt(sum(x * x for x in v.values())) or 1
        vec.append({s: x / nrm for s, x in v.items()})
    inv = collections.defaultdict(list)
    for i, v in enumerate(vec):
        for s, x in v.items():
            inv[s].append((i, x))
    for i, v in enumerate(vec):
        sc = collections.Counter()
        for s, x in v.items():
            for j, y in inv[s]:
                if j != i:
                    sc[j] += x * y
        docs[i]['similar'] = [[j, round(s, 3)] for j, s in sc.most_common(5) if s > 0.12]
    for d in docs:
        d.pop('_stems'); d.pop('_hstems')
    # --- аналитика
    an = analytics(docs, vols)
    for name, obj in (('meta', dict(volumes=vols, decisions=docs)), ('index', index), ('analytics', an)):
        with open(os.path.join(OUT, f'{name}.json'), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    for year, vt in texts.items():
        with open(os.path.join(OUT, f'text-{year}.json'), 'w', encoding='utf-8') as f:
            json.dump(vt, f, ensure_ascii=False, separators=(',', ':'))
    print(f'томов {len(vols)}, решений {len(docs)}, основ в индексе {len(post)}')
    for v in vols:
        print(f'  {v["year"]}: {v["decisions"]} решений, пропуски номеров: {v["gaps"] or "нет"}')

def lev(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

def unify_persons(docs):
    """Современное написание фамилий и слияние вариантов распознавания (Граве/Гравѣ/Гравъ)."""
    roles = ('presiding', 'reporter', 'prosecutor')
    cnt = collections.Counter()
    for d in docs:
        for r in roles:
            if d[r]:
                d[r] = modernize(d[r]); cnt[d[r]] += 1
    names = [n for n, _ in cnt.most_common()]
    canon = {}
    for n in names:
        sur, ini = n.rsplit(' ', 1) if ' ' in n else (n, '')
        for c in names:
            if c == n or cnt[c] < cnt[n]:
                continue
            cs, ci = c.rsplit(' ', 1) if ' ' in c else (c, '')
            same = ci == ini and lev(sur.lower(), cs.lower()) <= 1
            typo = sur.lower() == cs.lower() and lev(ini, ci) <= 1 and cnt[n] <= 2      # ошибка в инициале
            if (same or typo) and len(sur) > 3 and cnt[c] > cnt[n]:
                canon[n] = canon.get(c, c)
                break
    for d in docs:
        for r in roles:
            if d[r] in canon:
                d[r] = canon[d[r]]

def analytics(docs, vols):
    A = {}
    A['by_year'] = collections.Counter(d['vol'] for d in docs)
    A['by_month'] = collections.Counter((d['date'] or '')[:7] for d in docs if d['date'])
    A['outcomes'] = collections.Counter(d['outcome'] for d in docs)
    A['topics'] = collections.Counter(t for d in docs for t in d['topics'])
    st = collections.Counter(); stdoc = collections.defaultdict(set)
    for d in docs:
        for s in d['statutes']:
            st[s] += 1; stdoc[s].add(d['i'])
    A['statutes'] = [[s, len(stdoc[s])] for s, _ in st.most_common(200) if not s.startswith('?')][:60]
    A['codes'] = {c: n for c, n, _ in CODES}
    cited = collections.Counter(); ids = {(d['vol'], d['num']): d['i'] for d in docs}
    for d in docs:
        for y, n in d['cites']:
            cited[(y, n)] += 1
    A['cited'] = [[y, n, c, ids.get((y, n))] for (y, n), c in cited.most_common(40)]
    for role in ('presiding', 'reporter', 'prosecutor'):
        A[role] = collections.Counter(d[role] for d in docs if d[role]).most_common(25)
    A['words_median'] = sorted(d['words'] for d in docs)[len(docs) // 2] if docs else 0
    A['total_words'] = sum(d['words'] for d in docs)
    for k in ('by_year', 'by_month', 'outcomes', 'topics'):
        A[k] = dict(sorted(A[k].items(), key=lambda kv: (-kv[1], kv[0])) if k in ('outcomes', 'topics') else sorted(A[k].items()))
    return A

def build_single():
    """Один HTML-файл с данными внутри: lex/dist/senat-lex.html (открывается без сервера)."""
    d = os.path.join(ROOT, 'lex')
    html = open(os.path.join(d, 'index.html'), encoding='utf-8').read()
    inline = {}
    for f in sorted(os.listdir(OUT)):
        if f.endswith('.json'):
            inline[f] = json.load(open(os.path.join(OUT, f), encoding='utf-8'))
    blob = json.dumps(inline, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    js = lambda n: open(os.path.join(d, n), encoding='utf-8').read().replace('</script', '<\\/script')
    html = html.replace('<script src="lex.js"></script>', '<script>window.LEX_INLINE=' + blob + '</script>\n<script>' + js('lex.js') + '</script>')
    html = html.replace('<script src="app.js"></script>', '<script>' + js('app.js') + '</script>')
    html = html.replace('<title>Решения Сената: поиск и аналитика</title>', '<title>Сенат: поиск решений</title>')
    os.makedirs(os.path.join(d, 'dist'), exist_ok=True)
    out = os.path.join(d, 'dist', 'senat-lex.html')
    open(out, 'w', encoding='utf-8').write(html)
    print(f'единый файл: {out} ({os.path.getsize(out) / 1e6:.1f} МБ)')

if __name__ == '__main__':
    main()
    if '--single' in sys.argv:
        build_single()
