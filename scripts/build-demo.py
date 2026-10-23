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
fragment = (root / 'src' / 'paper-study.html').read_text(encoding='utf-8')
for marker, filename in [
    ('__EMMAUS_WINDOW_CSS__', 'paper-study.css'),
    ('__EMMAUS_WINDOW_MODEL__', 'window-model.js'),
    ('__EMMAUS_REFERENCES__', 'scripture-references.js'),
    ('__EMMAUS_WINDOW_APP__', 'paper-study.js'),
]:
    if fragment.count(marker) != 1:
        raise RuntimeError(f'Expected exactly one {marker} placeholder.')
    fragment = fragment.replace(marker, (root / 'src' / filename).read_text(encoding='utf-8'))
metadata = (root / 'data' / 'books.json').read_text(encoding='utf-8')
if fragment.count('__EMMAUS_BOOKS__') != 1:
    raise RuntimeError('Expected exactly one book metadata placeholder.')
build_directory = root / '.build'
build_directory.mkdir(exist_ok=True)
prepared = build_directory / 'paper-study.html'
prepared.write_text(fragment.replace('__EMMAUS_BOOKS__', metadata.replace('<', '\\u003c')), encoding='utf-8')
subprocess.run([
    sys.executable, str(args.renderer.resolve()),
    str(prepared), str(destination),
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
@media(min-width:760px) {
  html #emmaus-paper-study .ep-stage { padding:20px 24px; }
  html #emmaus-paper-study .ep-phone { max-width:1440px;height:calc(100vh - 40px);height:calc(100dvh - 40px);border-radius:24px; }
}
@media(max-width:600px) {
  html #emmaus-paper-study .ep-stage { padding:0; }
  html #emmaus-paper-study .ep-phone { height:100vh;height:100dvh;max-width:none;border:0;border-radius:0;box-shadow:none; }
}
</style>'''
page = destination.read_text(encoding='utf-8')
# The standalone website stores full local history, not a tiny conversation widget
# summary. Keep the existing key/receipt protocol; quota failures remain visible.
page = page.replace('16 * 1024', '8 * 1024 * 1024').replace('16 KiB', '8 MiB')
page = page.replace("default-src 'none';", "default-src 'none'; connect-src 'self';", 1)
page = page.replace('<html lang="en"', '<html lang="zh-CN"', 1)
migration_backup = '''<script>
try {
  const key='codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]);
  const old=localStorage.getItem(key),version=old&&JSON.parse(old)?.privateContent?.version;
  if([3,4,5,6].includes(version)&&!localStorage.getItem(key+':before-v7'))localStorage.setItem(key+':before-v7',old);
}catch(_){}
</script>'''
page = page.replace('</head>', outer_css + migration_backup + '\n</head>', 1)
pattern = re.compile(r'(<iframe\b[^>]*\bdata-srcdoc=")(.*?)(")', re.DOTALL)
match = pattern.search(page)
if not match:
    raise RuntimeError('Expected sandboxed export frame; refusing to emit a partial build.')
frame = html.unescape(match.group(2))
frame = frame.replace('<html lang="en"', '<html lang="zh-CN"', 1)
frame = frame.replace('</head>', inner_css + '\n</head>', 1)
page = page[:match.start(2)] + html.escape(frame, quote=True) + page[match.end(2):]
bridge = '''<script>
(() => {
  const frame=document.getElementById('codex-visualization'),cache=new Map();
  const sendViewport=()=>{const v=window.visualViewport;frame.contentWindow?.postMessage({type:'emmaus-visible-viewport',bottom:(v ? v.offsetTop+v.height : innerHeight)-frame.getBoundingClientRect().top},'*');};
  window.visualViewport?.addEventListener('resize',sendViewport);
  window.visualViewport?.addEventListener('scroll',sendViewport);
  window.addEventListener('resize',sendViewport); frame.addEventListener('load',sendViewport);
  window.addEventListener('message',async event=>{
    const request=event.data;
    if(event.source===frame.contentWindow && request?.type==='emmaus-viewport-request'){sendViewport();return;}
    if(event.source===frame.contentWindow&&request?.type==='emmaus-export-request'&&request.data?.version===7){
      const blob=new Blob([JSON.stringify(request.data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='Emmaus-reading-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
    }
    if(event.source!==frame.contentWindow||request?.type!=='emmaus-bible-request'||typeof request.id!=='string'||request.id.length>120||!Number.isInteger(request.book)||request.book<1||request.book>66)return;
    try {
      let pending=cache.get(request.book);
      if(!pending){pending=fetch(new URL('data/bible/'+request.book+'.json',location.href),{credentials:'omit'}).then(response=>{if(!response.ok)throw Error('Unavailable');return response.json();});cache.set(request.book,pending);}
      const data=await pending;
      frame.contentWindow.postMessage({type:'emmaus-bible-response',id:request.id,data},'*');
    }catch(error){cache.delete(request.book);frame.contentWindow.postMessage({type:'emmaus-bible-response',id:request.id,error:'Unavailable'},'*');}
  });
})();
</script>'''
page = page.replace('</body>', bridge + '\n</body>', 1)
destination.write_text(page, encoding='utf-8', newline='\n')
print('Built mobile web demo with isolated viewport and unchanged browser storage keys.')
