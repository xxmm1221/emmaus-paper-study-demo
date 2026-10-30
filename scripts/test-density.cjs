const {chromium,expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');require('../src/window-model.js');const M=globalThis.EmmausWindows;
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build/density');fs.mkdirSync(out,{recursive:true});const results=[],errors=[];
const baseline=require('child_process').execFileSync('git',['show','ca0ef89:index.html'],{cwd:root,maxBuffer:2*1024*1024});fs.writeFileSync(path.join(out,'baseline.html'),baseline);
(async()=>{const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
for(const mode of ['single','float','pair']){
 const s=M.fresh(),a=M.openPrimary(s,'reading',{book:43,chapter:3,verse:1});if(mode!=='single'){const w=M.openNew(s,'reading',{book:43,chapter:3,verse:1});if(mode==='pair')M.pair(s,w.id);}
 const metrics={};for(const version of ['before','after']){
  const ctx=await b.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true});await ctx.addInitScript(raw=>{if(window===window.top)localStorage.setItem('codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]),JSON.stringify({privateContent:raw}));},s);
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.route('**/data/bible/*.json',r=>r.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'data/bible',new URL(r.request().url()).pathname.split('/').at(-1)))}));
  await p.goto('http://127.0.0.1:8769/'+(version==='before'?'.build/density/baseline.html':''));const f=p.frameLocator('iframe'),pane=f.locator(mode==='float'?'.ep-sheet .ep-pane':'.ep-main .ep-pane').first();await expect(pane).toHaveAttribute('data-ready','true');await p.waitForTimeout(600);await pane.locator('.ep-pane-title').click();await p.waitForTimeout(200);
  metrics[version]=await pane.evaluate(n=>{const sc=n.querySelector('.ep-scroll'),r=sc.getBoundingClientRect();let lines=0;for(const v of sc.querySelectorAll('.ep-verse-words')){const range=document.createRange();range.selectNodeContents(v);for(const rect of range.getClientRects())if(rect.top>=r.top&&rect.bottom<=r.bottom)lines++;}return{bodyHeight:sc.clientHeight,visibleLines:lines,toolHeight:n.querySelector('.ep-pane-actions').clientHeight};});
  await p.screenshot({path:path.join(out,mode+'-'+version+'.png')});
  if(version==='after'){
   assert.equal(metrics.after.toolHeight,36);const rail=pane.locator('.ep-tool-rail');const rect=await rail.boundingBox(),cdp=await ctx.newCDPSession(p),x=rect.x+rect.width-25,y=rect.y+rect.height/2;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-180*i/8,y}]});await p.waitForTimeout(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(500);assert(await rail.evaluate(n=>n.scrollLeft>0));await expect(f.locator('.ep-drawer')).toBeHidden();await expect(pane).toHaveAttribute('data-tools-visible','true');
   for(const width of [320,430,844,1280]){await p.setViewportSize({width,height:800});await p.waitForTimeout(250);assert(await f.locator('.ep-phone').evaluate(n=>n.scrollWidth<=n.clientWidth+1));assert.equal(await rail.evaluate(n=>n.clientHeight),36);}await p.emulateMedia({colorScheme:'dark'});await p.screenshot({path:path.join(out,mode+'-dark-wide.png')});
  }
  await ctx.close();
 }
 assert(metrics.after.bodyHeight>metrics.before.bodyHeight);assert(metrics.after.visibleLines>metrics.before.visibleLines);results.push({mode,...metrics});console.log(JSON.stringify(results.at(-1)));
}
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));await b.close();})().catch(e=>{console.error(e);process.exit(1)});
