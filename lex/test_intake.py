"""Проверка локального PDF без копирования, OCR и публикации."""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from intake import inspect, pdf_info, inspect_pages
from volumes import apply_registry, decision_id, intake_constraints, load_registry, volume_record
from build_scans import file_sha256, fragment_asset, page_asset, publish_assets, save_manifest, leaf_image
from PIL import Image

ROOT = Path(__file__).parent
CANDIDATE = dict(volume_id='senat-civil-1898-first', year=1898, department_id='civil',
                 department='Гражданский кассационный департамент', edition='Проверяемое издание', status='staged')


def fixture_pdf(path):
    """Две малые тестовые страницы с настоящими xref-смещениями."""
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
    for text in (b'First page evidence', b'Second page evidence'):
        stream = b'BT /F1 12 Tf 20 350 Td (' + text + b') Tj ET'
        objects.append(b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream')
    data = b'%PDF-1.4\n'
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f'{i} 0 obj\n'.encode() + obj + b'\nendobj\n'
    xref = len(data)
    data += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
    data += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    data += f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    path.write_bytes(data)


class RegistryTests(unittest.TestCase):
    def test_current_public_ids_remain_unchanged(self):
        meta = json.loads((ROOT / 'data/meta.json').read_text())
        original = copy.deepcopy(meta)
        enriched = apply_registry(meta)
        self.assertEqual(meta, original)
        self.assertEqual([d['id'] for d in enriched['decisions']], [d['id'] for d in meta['decisions']])
        self.assertTrue(all(d['volume_id'] for d in enriched['decisions']))

    def test_ambiguous_year_and_duplicate_decision_fail_closed(self):
        meta = json.loads((ROOT / 'data/meta.json').read_text())
        duplicate = copy.deepcopy(meta)
        duplicate['volumes'].append(copy.deepcopy(duplicate['volumes'][0]))
        with self.assertRaisesRegex(ValueError, 'Два тома'):
            apply_registry(duplicate)
        meta['decisions'].append(copy.deepcopy(meta['decisions'][0]))
        with self.assertRaisesRegex(ValueError, 'Коллизия ID'):
            apply_registry(meta)

    def test_new_department_has_own_identity_but_is_not_publishable(self):
        candidate = {**CANDIDATE, 'year':1897, 'volume_id':'senat-criminal-1897-first',
                     'department_id':'criminal', 'department':'Уголовный кассационный департамент'}
        self.assertEqual(decision_id(candidate, 1), 'senat-criminal-1897-first-001')
        self.assertTrue(any('миграция' in blocker for blocker in intake_constraints(candidate)))
        existing = load_registry()['volumes'][0]
        with self.assertRaisesRegex(ValueError, 'уже принадлежит'):
            intake_constraints({**existing, 'edition':'Другое издание'})

    def test_source_build_rejects_unknown_volume_before_any_data_write(self):
        import build
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'ocr/1898';source.mkdir(parents=True)
            (source/'volume.txt').write_text('Тестовый источник')
            out=root/'lex/data';out.mkdir(parents=True)
            sentinel=out/'backmatter-1898.txt';sentinel.write_text('Прежняя опубликованная запись')
            before={p.name:p.read_bytes() for p in out.iterdir()}
            with patch('build.ROOT',str(root)),patch('build.OUT',str(out)),patch('build.split_volume',return_value=('гражданскаго кассаціоннаго',[],'Новое содержание')):
                with self.assertRaisesRegex(ValueError,'одобренная запись'):
                    build.main()
            self.assertEqual({p.name:p.read_bytes() for p in out.iterdir()},before)


class IntakeTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('pdfinfo') and shutil.which('pdftotext'), 'Poppler не установлен')
    def test_real_pdf_resume_no_copy_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            pdf, output = root / 'small.pdf', root / 'inspection'
            fixture_pdf(pdf)
            before = file_sha256(pdf)
            first = inspect(pdf, output, CANDIDATE, batch_pages=1, max_pages=1)
            self.assertFalse(first['complete'])
            self.assertEqual(first['pages_inspected'], 1)
            self.assertFalse(first['publication']['approved'])
            with self.assertRaisesRegex(ValueError, 'уже существует'):
                inspect(pdf, output, CANDIDATE)
            with patch('intake.inspect_pages', wraps=inspect_pages) as extract:
                final = inspect(pdf, output, CANDIDATE, resume=True, batch_pages=1)
                self.assertEqual(extract.call_args.args[1:], (2, 2))
            self.assertTrue(final['complete'])
            self.assertEqual(final['text_layer']['pages_with_text'], 2)
            self.assertFalse(final['publication']['ready'])
            self.assertEqual(file_sha256(pdf), before)
            self.assertEqual({p.name for p in output.iterdir()}, {'manifest.json', 'report.md'})
            saved = (output / 'manifest.json').read_bytes()
            pdf.write_bytes(pdf.read_bytes() + b'% changed')
            with self.assertRaisesRegex(ValueError, 'PDF изменился'):
                inspect(pdf, output, CANDIDATE, resume=True)
            self.assertEqual((output / 'manifest.json').read_bytes(), saved)

    def test_lfs_pointer_is_not_downloaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); pdf = root / 'pointer.pdf'
            pdf.write_text('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 999999\n')
            with self.assertRaisesRegex(ValueError, 'не локальный PDF'):
                inspect(pdf, root / 'inspection', CANDIDATE)
            self.assertFalse((root / 'inspection').exists())

    def test_interruption_resumes_last_complete_batch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();pdf=root/'fixture.pdf';fixture_pdf(pdf)
            page=dict(page=1,characters=4,text_sha256='a'*64,replacement_characters=0,sample='text')
            with patch('intake.pdf_info', return_value={'pages':2}), patch('intake.inspect_pages', side_effect=[[page], ValueError('interrupt')]):
                with self.assertRaisesRegex(ValueError, 'interrupt'):
                    inspect(pdf, root/'out', CANDIDATE, batch_pages=1)
            saved=json.loads((root/'out/manifest.json').read_text())
            self.assertEqual(saved['pages_inspected'],1)
            self.assertFalse((root/'out/.intake.lock').exists())
            with patch('intake.inspect_pages',return_value=[{**page,'page':2}]) as extract:
                final=inspect(pdf,root/'out',CANDIDATE,resume=True)
                self.assertEqual(extract.call_args.args[1:],(2,2))
                self.assertTrue(final['complete'])


class ImmutableScansTests(unittest.TestCase):
    def test_both_layouts_use_pdf_identity_and_crop_geometry(self):
        self.assertNotEqual(page_asset(1904,'p0001_L','a'*64), page_asset(1904,'p0001_L','b'*64))
        one=fragment_asset(1904,'1904-001:0-50','p0001_L','a'*64,[0,.1,1,.3])
        self.assertNotEqual(one,fragment_asset(1904,'1904-001:0-50','p0001_L','b'*64,[0,.1,1,.3]))
        self.assertNotEqual(one,fragment_asset(1904,'1904-001:0-50','p0001_L','a'*64,[0,.2,1,.3]))

    def test_old_urls_and_manifest_are_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);stage=root/'stage';lex=root/'lex';asset='scans/1904/pages/new.webp'
            (stage/asset).parent.mkdir(parents=True);(stage/asset).write_bytes(b'new')
            old=lex/'scans/1904/pages/old.webp';old.parent.mkdir(parents=True);old.write_bytes(b'old')
            publish_assets(stage,lex,{asset});publish_assets(stage,lex,{asset})
            self.assertEqual(old.read_bytes(),b'old')
            self.assertEqual((lex/asset).read_bytes(),b'new')
            (stage/asset).write_bytes(b'different')
            with self.assertRaisesRegex(ValueError,'Запрещена замена'):
                publish_assets(stage,lex,{asset})
            self.assertEqual((lex/asset).read_bytes(),b'new')
            manifest=lex/'data/scans-1904.json';manifest.parent.mkdir();manifest.write_text('{"year":1904,"old":true}')
            saved=manifest.read_bytes();save_manifest(manifest,{'year':1904,'new':True})
            self.assertEqual(next((lex/'data/scan-history/1904').glob('*.json')).read_bytes(),saved)

    def test_spread_does_not_reuse_png_without_source_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);cache=root/'cache';cache.mkdir();legacy=root/'work/1904';legacy.mkdir(parents=True)
            Image.new('L',(20,20),10).save(legacy/'p0001_L.png')
            spread=Image.new('L',(60,40),200);spread.paste(70,(0,0,30,40));spread.save(cache/'1904-verified-0001.png')
            with patch('build_scans.subprocess.run') as run:
                image=leaf_image(root,1904,'p0001_L',root/'not-needed.pdf',cache,False,'verified')
                self.assertEqual(image.size,(30,40));self.assertEqual(image.getpixel((0,0)),70)
                right=leaf_image(root,1904,'p0001_R',root/'not-needed.pdf',cache,False,'verified')
                self.assertEqual(right.getpixel((0,0)),200);run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
