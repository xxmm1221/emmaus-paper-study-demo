"""Read-only full CDN audit; verify every published scripture/commentary file."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import time
import urllib.request

p = argparse.ArgumentParser()
p.add_argument('--url', default='https://xxmm1221.github.io/emmaus-paper-study-demo/')
args = p.parse_args()
root = Path(__file__).resolve().parents[1]
paths = [root / 'index.html', root / 'data/books.json', root / 'data/commentary/manifest.json']
paths += sorted((root / 'data/bible').glob('*.json'))
paths += sorted((root / 'data/commentary').glob('*/*.json'))
assert len(paths) == 1258

def verify(path):
    rel = path.relative_to(root).as_posix()
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    for attempt in range(3):
        try:
            request = urllib.request.Request(args.url.rstrip('/') + '/' + rel,
                                             headers={'User-Agent': 'Emmaus-data-verification/1.0'})
            with urllib.request.urlopen(request, timeout=35) as r:
                data = r.read()
            if hashlib.sha256(data).hexdigest() != sha:
                raise ValueError('hash mismatch')
            return {'path': rel, 'sha256': sha, 'bytes': len(data), 'ok': True}
        except Exception as e:
            if attempt == 2:
                return {'path': rel, 'ok': False, 'error': type(e).__name__}
            time.sleep(1 + attempt)

results = []
with ThreadPoolExecutor(max_workers=8) as pool:
    jobs = [pool.submit(verify, path) for path in paths]
    for job in as_completed(jobs):
        results.append(job.result())
        if len(results) % 200 == 0:
            print(f'{len(results)}/{len(paths)} checked', flush=True)
report = {'url': args.url, 'checkedAt': time.time(), 'checked': len(results),
          'passed': sum(r['ok'] for r in results), 'files': sorted(results, key=lambda r: r['path'])}
(root / '.build').mkdir(exist_ok=True)
(root / '.build/deployment-data-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'files'}))
assert report['passed'] == len(paths), 'Deployed files incomplete or mismatched; inspect audit report'
