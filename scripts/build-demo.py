"""Export the editable demo and give the web edition a single viewport.

Usage: python scripts/build-demo.py --renderer /absolute/path/to/render.py
The renderer is the bundled visualization export helper, not a project secret.
"""
import argparse
import html
from pathlib import Path
import re
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--renderer', required=True, type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
destination = root / 'index.html'
subprocess.run([
    sys.executable, str(args.renderer.resolve()),
    str(root / 'src' / 'paper-study.html'), str(destination),
    '--title', 'Emmaus · 纸间研读', '--force',
], check=True)

# The conversation export normally grows to its content. A phone website must
# not scroll that outer document while a reader, note, or floating page scrolls.
outer_css = '''<style id="emmaus-web-viewport">
html,body { width:100%;height:100%;margin:0;padding:0!important;overflow:hidden;overscroll-behavior:none; }
#codex-visualization { width:100%;height:100vh!important;height:100dvh!important;border:0;margin:0;display:block; }
</style>'''
inner_css = '''<style id="emmaus-web-viewport">
html,html>body { width:100%;height:100%;margin:0;padding:0;overflow:hidden;overscroll-behavior:none; }
html #emmaus-paper-study { height:100%; }
html #emmaus-paper-study .ep-stage { height:100vh;height:100dvh;min-height:0;padding:24px 10px;overflow:hidden; }
html #emmaus-paper-study .ep-phone { height:min(800px,calc(100vh - 48px));height:min(800px,calc(100dvh - 48px)); }
@media(max-width:600px) {
  html #emmaus-paper-study .ep-stage { padding:0; }
  html #emmaus-paper-study .ep-phone { height:100vh;height:100dvh;max-width:none;border:0;border-radius:0;box-shadow:none; }
}
</style>'''
page = destination.read_text(encoding='utf-8')
page = page.replace('<html lang="en"', '<html lang="zh-CN"', 1)
page = page.replace('</head>', outer_css + '\n</head>', 1)
pattern = re.compile(r'(<iframe\b[^>]*\bdata-srcdoc=")(.*?)(")', re.DOTALL)
match = pattern.search(page)
if not match:
    raise RuntimeError('Expected sandboxed export frame; refusing to emit a partial build.')
frame = html.unescape(match.group(2))
frame = frame.replace('<html lang="en"', '<html lang="zh-CN"', 1)
frame = frame.replace('</head>', inner_css + '\n</head>', 1)
page = page[:match.start(2)] + html.escape(frame, quote=True) + page[match.end(2):]
destination.write_text(page, encoding='utf-8', newline='\n')
print('Built mobile web demo with isolated viewport and unchanged browser storage keys.')
