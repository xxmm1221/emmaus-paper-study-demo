"""Import the user's existing CMC text library without rewriting its commentary.
Usage: python scripts/import-commentary.py --source D:/code/Emmaus/data/commentary/books --manifest D:/code/Emmaus/public/bible/manifest.json
"""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--source', required=True, type=Path)
p.add_argument('--manifest', required=True, type=Path)
args = p.parse_args()
root = Path(__file__).resolve().parents[1]
books = json.loads((root / 'data/books.json').read_text(encoding='utf-8'))
source_books = json.loads(args.manifest.read_text(encoding='utf-8'))
out = root / 'data/commentary'
out.mkdir(exist_ok=True)
report = {'source': '圣经综合解读', 'sourceUrl': 'https://cmcbiblereading.com/',
          'format': 1, 'books': [], 'chapters': 0, 'verseRecords': 0, 'commentedVerses': 0,
          'referencePolicy': '原库 ref 是最近有注释节的导航索引，不保证是本节专属或整段注释。界面必须说明跳转。'}
for b in books:
    m = next(x for x in source_books if x['number'] == b['number'])
    raw = (args.source / (m['id'] + '.json')).read_bytes()
    source = json.loads(raw)
    assert source['bookId'] == m['id'] and len(source['chapters']) == b['chapterCount']
    chapters = sorted(source['chapters'], key=lambda c: c['chapter'])
    assert [c['chapter'] for c in chapters] == list(range(1, b['chapterCount'] + 1))
    directory = out / str(b['number'])
    directory.mkdir(exist_ok=True)
    manifest = {'number': b['number'], 'name': b['name'], 'sourceId': m['id'],
                'sha256': hashlib.sha256(raw).hexdigest(), 'chapters': []}
    for c in chapters:
        assert c['url'].startswith('https://cmcbiblereading.')
        assert len({v['verse'] for v in c['verses']}) == len(c['verses'])
        assert any(v.get('text', '').strip() for v in c['verses'])
        assert '\ufffd' not in json.dumps(c, ensure_ascii=False)
        data = {'number': b['number'], 'source': source['source'], 'sourceUrl': source['sourceUrl'], **c}
        encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        (directory / f"{c['chapter']}.json").write_bytes(encoded)
        # Exact equality is intentional: no summarization, synthetic completion or shifted verse text.
        restored = json.loads(encoded)
        assert all(restored[k] == value for k, value in c.items())
        count = sum(bool(v.get('text', '').strip()) for v in c['verses'])
        manifest['chapters'].append({'chapter': c['chapter'], 'bytes': len(encoded),
                                    'sha256': hashlib.sha256(encoded).hexdigest(), 'comments': count})
        report['chapters'] += 1
        report['verseRecords'] += len(c['verses'])
        report['commentedVerses'] += count
    report['books'].append(manifest)
assert len(report['books']) == 66 and report['chapters'] == 1189
(out / 'manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
print(json.dumps({k: v for k, v in report.items() if k not in ('books', 'referencePolicy')}, ensure_ascii=True))
