#!/usr/bin/env python3
"""Convert the pinned, locally supplied RIStat GeoPackage. Never downloads data.

Optional preparation dependency: Shapely 2.1.2. Normal site builds need only the
committed GeoJSON and Python standard library; see GEOGRAPHY.md for provenance.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

SOURCE_SHA256 = '807a7e531950a8f0c57517d13e43dfe781d09ac5309f7f4f02ab4cd3fe09c600'
SOURCE_URL = 'https://doi.org/10.34894/NQOASN'
EXCLUDED = {'62a', '62b', '70a', '70b'}
ROOT = Path(__file__).resolve().parent


def convert(path, memberships):
    from shapely import from_wkb
    from shapely.affinity import translate
    from shapely.geometry import MultiPolygon, box, mapping
    from shapely.geometry.polygon import orient

    if hashlib.sha256(path.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise ValueError('GeoPackage differs from the reviewed source')
    with sqlite3.connect(f'file:{path.resolve()}?mode=ro', uri=True) as db:
        geometry_info = db.execute('SELECT geometry_type_name,srs_id,z,m FROM gpkg_geometry_columns').fetchall()
        if geometry_info != [('MULTIPOLYGON', 4326, 0, 0)]:
            raise ValueError('Unexpected geometry type or coordinate system')
        rows = db.execute('SELECT Gub_ID,prov_RU,prov_ENG,RISTAT_ID,geom FROM provinces_1897').fetchall()
    if len(rows) != 103 or len({r[0] for r in rows}) != 103:
        raise ValueError('Unexpected source inventory')
    features = []
    for ident, label, english, ristat, blob in sorted(rows, key=lambda r: r[0]):
        if ident in EXCLUDED:
            continue
        # GeoPackage header: magic/version/flags/SRS followed by optional envelope.
        if blob[:2] != b'GP':
            raise ValueError('Invalid GeoPackage geometry header')
        envelope_bytes = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(blob[3] >> 1) & 7]
        geom = from_wkb(blob[8 + envelope_bytes:])
        if not geom.is_valid or geom.is_empty:
            raise ValueError('Invalid source geometry: ' + ident)
        polygons = []
        # Clip as whole polygons, preserving holes; never wrap isolated vertices.
        for offset in (0, 360):
            part = geom.intersection(box(-180 + offset, -90, 180 + offset, 90))
            if part.is_empty:
                continue
            if offset:
                part = translate(part, xoff=-offset)
            for polygon in ([part] if part.geom_type == 'Polygon' else part.geoms):
                if polygon.geom_type != 'Polygon':
                    raise ValueError('Unexpected clipped geometry: ' + ident)
                polygons.append(orient(polygon, sign=1.0))
        result = MultiPolygon(polygons)
        if not result.is_valid:
            raise ValueError('Invalid clipped geometry: ' + ident)
        original_label = label
        label = ' '.join(label.split())
        note = ''
        if ident == '58':
            label = 'Область Войска Донского'
            note = 'Название приведено к переписи 1897 года; исходная подпись сохранена в source_label.'
        elif ident == '64':
            label = 'Карсская область'
            note = 'В исходном слое ошибочно названа губернией; тип исправлен по переписи 1897 года, геометрия сохранена.'
        elif ident in {'62', '70'}:
            note = 'Составная территория источника, включая указанный округ. Отдельные перекрывающиеся варианты исключены.'
        elif ident in {'103', '105'}:
            note = 'Ханство под российским протекторатом; не губерния Российской империи.'
        kind = ('protectorate' if ident in {'103', '105'} else 'territory' if ident == '95'
                else 'composite' if ident in {'62', '70'} else 'oblast' if 'област' in label.lower() else 'governorate')
        feature_id = 'gub-' + ident
        properties = dict(label=label, source_label=original_label, source_id=ident,
                          source_english=english, ristat_id=ristat, kind=kind, note=note,
                          province_ids=[p['id'] for p in memberships if feature_id in p['boundary_ids']])
        if ident in {'58', '64'}:
            properties['label_source'] = 'https://www.demoscope.ru/weekly/ssp/rus1897_02.php'
        features.append(dict(type='Feature', id=feature_id, properties=properties, geometry=mapping(result)))
    return dict(type='FeatureCollection', year=1897, source_url=SOURCE_URL,
                source_sha256=SOURCE_SHA256, source_file_url='https://dataverse.nl/api/access/datafile/578936',
                license='CC0; RIStat citation required by the repository terms',
                attribution='Kessler & Markevich, RIStat (2020); GIS: Rombert Stapel, IISH (2021); dataset version 3.3.',
                license_url='https://dataverse.nl/api/datasets/:persistentId/versions/3.3/customlicense?persistentId=doi:10.34894/NQOASN',
                transformations=['Excluded overlapping disaggregations 62a, 62b, 70a, 70b; kept composite regions 62 and 70.',
                                 'Clipped at 180 degrees and translated the eastern piece by -360; RFC 7946 ring orientation.',
                                 'Rounded coordinates to six decimal places; no simplification.',
                                 'Editorial labels for Don Host and Kars; original source labels retained.'],
                features=features)


def rounded(value):
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, (tuple, list)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gpkg', type=Path)
    args = parser.parse_args()
    provinces = json.loads((ROOT / 'geography-provinces-source.json').read_text())['provinces']
    out = ROOT / 'data/province-boundaries-1897.json'
    out.write_text(json.dumps(rounded(convert(args.gpkg, provinces)), ensure_ascii=False, separators=(',', ':')) + '\n')
    print(out, out.stat().st_size)
