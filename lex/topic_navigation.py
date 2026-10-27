"""Единый редакционный каталог навигации с сохранением прежних автоматических меток."""
LEGACY_TOPICS = {
    'Наследство и завещания':'inheritance', 'Опека, недееспособность':'guardianship',
    'Семья и брак':'family', 'Недвижимость и земля':'property', 'Аренда и наём':'rent',
    'Договоры и обязательства':'contracts', 'Векселя, займы, залог':'debt',
    'Торговые и акционерные общества':'companies', 'Несостоятельность':'insolvency',
    'Железные дороги и перевозки':'commerce-transport', 'Возмещение вреда':'damages',
    'Подсудность и процесс':'procedure', 'Судебные издержки и пошлины':'costs',
    'Доказательства':'evidence', 'Нотариат и акты':'notary',
    'Казна и государственная служба':'state', 'Страхование':'insurance',
    'Крестьяне, общины, сословия':'peasants', 'Окраины и местные законы':'local-law',
    'Церковь и духовенство':'church',
}


def apply_catalog(meta, analytics, catalog):
    """Обновляет производные метаданные; повторный вызов сохраняет исходные метки."""
    topics = {t['id']: t for t in catalog['topics']}
    if set(catalog['decisions']) != {d['id'] for d in meta['decisions']}:
        raise ValueError('Каталог тем не совпадает с корпусом')
    aliases = dict(LEGACY_TOPICS, **catalog.get('route_aliases', {}))
    for ident, topic in topics.items():
        aliases[ident] = aliases[topic['title']] = ident
    if any(value not in topics for value in aliases.values()):
        raise ValueError('Неизвестная тема в прежних адресах')
    for doc in meta['decisions']:
        doc.setdefault('automatic_topics', list(doc.get('topics', [])))
        doc['topic_ids'] = [t['id'] for t in catalog['decisions'][doc['id']]['topics']]
        doc['topics'] = [topics[ident]['title'] for ident in doc['topic_ids']]
    meta['topic_aliases'] = aliases
    meta['topic_vocabulary'] = [{k:t[k] for k in ('id','title','count')} for t in topics.values()]
    analytics.setdefault('automatic_topics', dict(analytics.get('topics', {})))
    analytics['topics'] = {t['title']: t['count'] for t in topics.values()}
    analytics['catalog_topics'] = meta['topic_vocabulary']
    return meta, analytics
