"""Import only public-domain Bible verses from a local structured-v1 collection."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
books = []
target = root / 'data' / 'bible'
target.mkdir(parents=True, exist_ok=True)
chapter_total = 0
verse_total = 0
for file in args.source.glob('*.json'):
    book = json.loads(file.read_text(encoding='utf-8'))
    if not isinstance(book, dict) or not isinstance(book.get('number'), int) or 'chapters' not in book:
        continue
    assert book.get('format') == 'structured-v1', 'Unsupported source format'
    assert 1 <= book['number'] <= 66
    assert len(book['chapters']) == book['chapterCount']
    chapters = []
    for number, chapter in enumerate(book['chapters'], 1):
        assert chapter['number'] == number
        verses = {}
        for section in chapter['sections']:
            for block in section['blocks']:
                for line in block.get('lines', []):
                    verse = line.get('number')
                    words = line.get('text')
                    if not isinstance(verse, int) or verse <= 0 or not isinstance(words, str) or not words.strip():
                        continue
                    verses[verse] = (verses.get(verse, '') + words).strip()
        assert verses, 'Empty chapter'
        chapters.append([[n, text] for n, text in sorted(verses.items())])
        chapter_total += 1
        verse_total += len(verses)
    metadata = {k: book[k] for k in ('number', 'name', 'abbreviation', 'chapterCount', 'testament')}
    books.append(metadata)
    data = {**metadata, 'chapters': chapters}
    (target / f"{book['number']}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
books.sort(key=lambda b: b['number'])
assert [b['number'] for b in books] == list(range(1, 67))
assert chapter_total == 1189
(root / 'data' / 'books.json').write_text(json.dumps(books, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(json.dumps({'books': len(books), 'chapters': chapter_total, 'verses': verse_total}))
