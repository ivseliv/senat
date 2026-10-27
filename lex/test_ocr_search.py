"""Проверки точных операторов и отдельного слоя OCR без изменения источника."""
import collections
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from build import modernize, stem, stems
from ocr_search import build_search_assets, known_words_for, normalize_ocr

ROOT = Path(__file__).resolve().parent


def field(texts):
    post, lengths = {}, []
    for i, text in enumerate(texts):
        terms = stems(text)
        lengths.append(len(terms))
        for term, count in collections.Counter(terms).items():
            post.setdefault(term, []).extend([i, count])
    return dict(n=len(texts), len=lengths, avgdl=sum(lengths)/max(1, len(texts)), post=post, hpost={})


def fixture(texts, heads=None):
    original = field([heads[i]+' '+text if heads else text for i, text in enumerate(texts)])
    original.update(build_search_assets(texts, stems, modernize, stem, heads=heads))
    return dict(index=original, docs=[dict(i=i, id=str(i)) for i in range(len(texts))],
                volume=dict(original=original, enriched=field(['']*len(texts)), passages=[
                    dict(id=str(i), decision=str(i), start=0, end=len(text)) for i, text in enumerate(texts)]))


def js(data, code):
    with tempfile.TemporaryDirectory() as tmp:
        file = Path(tmp)/'input.json'
        file.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        script = "const assert=require('node:assert/strict'),fs=require('fs'),L=require('./lex.js'),C=require('./concept.js');" \
                 "const input=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));" + code
        result=subprocess.run(['node', '-e', script, str(file)], cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stderr)


class SearchOcrTests(unittest.TestCase):
    def test_phrase_order_stopwords_boundaries_and_minus_only(self):
        data = fixture(['срок исковой давности', 'давности срок', 'срок давности',
                        'заем без передачи денег', 'заем с передачей денег', 'передачи денег',
                        'наследство 2', 'наследство 3', 'не быть'], heads=['']*5+['заем без']+['']*3)
        js(data, r'''
const engine=L.makeEngine(input.index,input.docs);
const ids=q=>engine.search(q,{gloss:false,ocr:false}).hits.map(h=>h.i).sort((a,b)=>a-b);
assert.deepEqual(ids('"срок давности"'),[2]);
assert.deepEqual(ids('«давности срок»'),[1]);
assert.deepEqual(ids('"заем без передачи денег"'),[3]);
assert.deepEqual(ids('"не быть"'),[8]);
assert.deepEqual(ids('наследство 2'),[6]);
assert.deepEqual(ids('наследство 4'),[]);
assert.deepEqual(ids('-наследство'),[0,1,2,3,4,5,8]);
assert.deepEqual(ids('-"срок давности"'),[0,1,3,4,5,6,7,8]);
''')

    def test_ocr_repairs_are_separate_labeled_and_ranked_after_exact(self):
        # Искусственные повреждения проверяют алгоритм, не частоту ошибок корпуса.
        data = fixture(['наследство', 'наслѣд- ство', 'Слiозберга', 'оберъ- прокуроръ', 'наследство 2'])
        js(data, r'''
const engine=L.makeEngine(input.index,input.docs),strict=engine.search('наследство',{gloss:false,ocr:false});
const result=engine.search('наследство',{gloss:false});
assert.deepEqual(result.hits.slice(0,strict.hits.length),strict.hits);
const joined=result.hits.find(h=>h.i===1);assert(joined.ocr);
assert(joined.corrections.some(c=>c.kind==='hyphenation' && c.from==='наслѣд- ство'));
assert(!engine.search('Слиозберга',{ocr:false}).hits.length);
const repaired=engine.search('Слиозберга').hits;assert.equal(repaired.length,1);
assert(repaired[0].ocr);assert.equal(repaired[0].corrections[0].kind,'mixed-script');
assert.equal(engine.search('оберпрокурор',{ocr:true}).hits.length,0);
assert.equal(engine.search('наследство 3',{gloss:false}).hits.length,0);
const semantic=C.makeEngines([input.volume],[]);
const sense=C.searchAll(semantic,'Слиозберга','baseline');assert.equal(sense.hits.length,1);
assert(sense.hits[0].ocr);assert.equal(sense.hits[0].corrections[0].kind,'mixed-script');
assert.equal(C.searchAll(semantic,'Слиозберга','baseline',{ocr:false}).hits.length,0);
''')

    def test_fuzzy_is_one_long_word_unambiguous_and_never_a_number(self):
        data = fixture(['наследство', 'наследство 2', 'нотариальное', 'поверенный'])
        js(data, r'''
const e=L.makeEngine(input.index,input.docs);
const hits=e.search('наслдство',{gloss:false}).hits;assert(hits.length);
assert(hits.every(h=>h.ocr && h.corrections.some(c=>c.kind==='typo' && c.to==='наследство')));
assert.equal(e.search('наслдство',{gloss:false,ocr:false}).hits.length,0);
assert.equal(e.search('"наслдство"',{gloss:false}).hits.length,0);
assert.equal(e.search('наслдство -залог',{gloss:false}).hits.length,0);
assert.equal(e.search('наслдство 3',{gloss:false}).hits.length,0);
assert.equal(e.search('нас1едство',{gloss:false}).hits.length,0);
assert.equal(e.search('наслдство нотриальное',{gloss:false}).hits.length,0);
assert.equal(L.fuzzyQuery('проверка',[{post:{},lexicon:['промерка','проверки']}]),null);
const c=C.makeEngines([input.volume],[]);
const fuzzy=C.searchAll(c,'наслдство','baseline').hits;assert(fuzzy.length && fuzzy.every(h=>h.ocr));
assert.equal(C.searchAll(c,'не наслдство','baseline').hits.length,0);
assert.deepEqual(C.parse('аренда без выкупа',[]).unsupportedOperators,['negation']);
''')

    def test_filter_precedes_partial_choice(self):
        data = fixture(['нотариус отвечает криптовалюты', 'нотариус отвечает'])
        js(data, r'''
const es=C.makeEngines([input.volume],[]);
const result=C.searchAll(es,'нотариус отвечает криптовалюты','baseline',{partial:true,filter:p=>p.decision==='1'});
assert(result.partial);assert.equal(result.hits.length,1);assert.equal(result.hits[0].passage.decision,'1');
''')

    def test_global_exact_prevents_fuzzy_and_ocr_completes_partial(self):
        data=dict(a=fixture(['наследство']), b=fixture(['наслдство']),
                  partial=fixture(['нотариус Слiозберга отвечает']))
        js(data, r'''
input.a.volume.passages[0].id='a';input.a.volume.passages[0].decision='a';
input.b.volume.passages[0].id='b';input.b.volume.passages[0].decision='b';
const es=C.makeEngines([input.a.volume,input.b.volume],[]);
const exact=C.searchAll(es,'наслдство','baseline');
assert.equal(exact.hits.length,1);assert.equal(exact.hits[0].passage.id,'b');assert(!exact.hits[0].ocr);
const partial=C.searchAll(C.makeEngines([input.partial.volume],[]),'нотариус Слиозберга отвечает','baseline',{partial:true});
assert.equal(partial.hits.length,1);assert(!partial.partial);assert(partial.hits[0].ocr);
''')

    def test_mixed_and_hyphenation_python_js_parity(self):
        samples=['Слiозберга', 'сдѣлка', 'не сдѣлка', 'наслѣд- ство', 'оберъ- прокуроръ', 'Latin', 'арендnаго', 'сумма 123']
        known=known_words_for(['наследство'],modernize)
        expected=[]
        for sample in samples:
            text,corrections=normalize_ocr(sample,modernize,known)
            expected.append(dict(text=text,corrections=corrections))
        js(dict(samples=samples,known=sorted(known),expected=expected), r'''
assert.deepEqual(input.samples.map(s=>L.normalizeOcr(s,new Set(input.known))),input.expected);
''')

    def test_highlight_preserves_damaged_text_and_selects_its_window(self):
        js({}, r'''
const text='Начало & <текст> Слiозберга; наслѣд-\n ство. Отдельно: сл и озберга.';
const corrections=[{from:'Слiозберга',to:'Сліозберга',kind:'mixed-script'},
 {from:'наслѣд-\n ство',to:'наслѣдство',kind:'hyphenation'}];
const html=C.highlightEvidence(text,['Слиозберга','наследство'],'Начало',corrections);
assert(html.includes('<mark>Слiозберга</mark>'));assert(html.includes('<mark>наслѣд-\n ство</mark>'));
assert(!html.includes('<mark>Начало</mark>'));assert(!html.includes('<mark>сл</mark>'));
assert.equal(html.replace(/<\/?mark>/g,''),L.esc(text));
const modern=L.modernize(text),shown=C.highlight(modern,['Слиозберга','наследство'],corrections);
assert(shown.includes('<mark>наслед-\n ство</mark>'));
assert.equal(shown.replace(/<\/?mark>/g,''),L.esc(modern));
const snippet=L.snippet('Вводный текст. '.repeat(80)+text,L.stems('Слиозберга'),180,corrections);
assert(snippet.includes('<mark>Слiозберга</mark>'));assert(snippet.startsWith('… '));
assert.equal(C.highlight('123',['1']),'123');
''')

    def test_real_published_mixed_script_example(self):
        # Реальное наблюдение в опубликованном OCR; не оценка CER и не новая сверка скана.
        meta=json.loads((ROOT/'data/meta.json').read_text())['decisions']
        docs=[d for d in meta if d['vol']==1904]
        texts=json.loads((ROOT/'data/text-1904.json').read_text())
        text=texts[next(i for i,d in enumerate(docs) if d['id']=='1904-058')]
        self.assertEqual(text[5046:5056],'Слiозберга')
        source=text[4161:6048]
        data=fixture([source])
        js(data, r'''
const e=L.makeEngine(input.index,input.docs),c=C.makeEngines([input.volume],[]);
assert.equal(e.search('Слиозберга',{ocr:false}).hits.length,0);
assert.equal(e.search('Слиозберга').hits.length,1);
assert.equal(C.searchAll(c,'Слиозберга','baseline',{ocr:false}).hits.length,0);
const hit=C.searchAll(c,'Слиозберга','baseline').hits[0];assert(hit.ocr);
assert(hit.corrections.some(x=>x.from==='Слiозберга' && x.kind==='mixed-script'));
''')
        self.assertEqual(source,text[4161:6048])


if __name__=='__main__':
    unittest.main()
