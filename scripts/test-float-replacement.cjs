const {chromium,expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');require('../src/window-model.js');const M=globalThis.EmmausWindows,{reveal}=require('./ui-test-helpers.cjs');
const out=path.resolve(__dirname,'../.build/dual');fs.mkdirSync(out,{recursive:true});const checks=[],errors=[];const pass=n=>{checks.push(n);console.log('PASS '+n)};
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
async function start(s,opts={}){const ctx=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true,...opts});await ctx.addInitScript(raw=>{if(window===window.top&&!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','yes');localStorage.setItem('codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]),JSON.stringify({privateContent:raw,modelContent:null}));}},s);const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.DEMO_URL||'http://127.0.0.1:8769/');const f=p.frameLocator('iframe');await expect(f.locator('.ep-main .ep-pane[data-ready=true]').first()).toBeVisible();await p.waitForTimeout(600);return{ctx,p,f,st:()=>p.frames()[1].evaluate(()=>window.openai.widgetState.privateContent),tap:async sel=>{await reveal(f,sel);await f.locator(sel).last().tap(sel.includes('menu-close')?{position:{x:5,y:5}}:{});await p.waitForTimeout(650);}};}
const setup=()=>{const s=M.fresh(),base=M.openPrimary(s,'reading',{book:1,chapter:1}),a=M.openPrimary(s,'reading',{book:45,chapter:8,verse:28});return{s,base,a};};
const placement=s=>JSON.stringify({floating:s.floating,tabs:s.tabs,scenes:s.scenes,windows:s.windows.map(w=>[w.id,w.height,w.floatTop,w.contentId]),notes:s.notes,events:s.events});
for(const scenario of ['new','copy','main','pair-upper','pair-lower','note-reference','tab']){
 const{s,a}=setup();let lower,tab;
 if(scenario.startsWith('pair')){lower=M.openNew(s,'reading',{book:43,chapter:3,verse:16});M.pair(s,lower.id);}
 if(scenario==='tab'){tab=M.openNew(s,'reading');M.minimize(s);}
 const old=M.openNew(s,'note',{text:'查阅 罗8:29',citation:{book:45,chapter:8,verse:28}}),main=M.top(s).id;
 // Keep the note readily tappable when verifying its reference; all others fill both slots.
 if(scenario!=='note-reference')M.openNew(s,'reference',{citation:{book:45,chapter:8,verse:28}});
 const {ctx,p,f,st,tap}=await start(s);
 if(scenario==='note-reference'){
  await tap('.ep-scripture-link');let after=await st();assert.equal(after.floating.length,2);assert.equal(after.floating[0],old.id);assert.equal(after.scenes.at(-1).id,main);await expect(f.locator('.ep-sheet[data-front=true] [data-reading-title]')).toHaveText('罗马书 8');
  await p.screenshot({path:path.join(out,'two-floats-light.png')});await p.emulateMedia({colorScheme:'dark'});await p.waitForTimeout(300);await p.screenshot({path:path.join(out,'two-floats-dark.png')});
  await tap(`.ep-sheet[data-window-id="${old.id}"] .ep-handle`);assert.equal((await st()).floating.at(-1),old.id);
  const before=placement(await st());await tap('.ep-scripture-link');await expect(f.locator('.ep-capacity')).toBeVisible();assert.equal(placement(await st()),before);await tap('[data-act=capacity-cancel]');assert.equal(placement(await st()),before);
  pass('浮窗引用衍生第二浮窗，原笔记不变；点击后窗置顶，第三浮窗取消无副作用');
 }else{
  const before=placement(await st());
  if(scenario==='tab')await tap(`[data-tab="${tab.id}"]`);
  else{const id=scenario==='pair-lower'?lower.id:a.id;await tap(`.ep-main .ep-pane[data-window-id="${id}"] .ep-icon[data-act=pane-menu]`);if(scenario==='new'){await tap('[data-act=menu-close]');await tap(`.ep-main .ep-pane[data-window-id="${id}"] .ep-content-tools [data-act=open-note]`);}else await tap('.ep-popover [data-act='+ (scenario==='copy'?'pin':'move-float')+']');}
  await expect(f.locator('.ep-capacity')).toBeVisible();assert.equal(placement(await st()),before);await expect(f.locator('.ep-main')).toHaveAttribute('inert','');await p.screenshot({path:path.join(out,'capacity-'+scenario+'.png')});
  await tap('[data-act=capacity-cancel]');assert.equal(placement(await st()),before);pass(scenario+' 满额拦截且取消不变');
 }
 await ctx.close();
}
{
 const{s,a}=setup(),old=M.openNew(s,'note',{text:'保留一'}),front=M.openNew(s,'reading');const{ctx,p,f,st,tap}=await start(s);
 await tap('.ep-main .ep-content-tools [data-act=open-note]');await tap(`[data-act=capacity-minimize][data-id="${front.id}"]`);
 const after=await st();assert.equal(after.floating.length,2);assert(after.floating.includes(old.id));assert(after.tabs.some(t=>t.id===front.id));assert.equal(after.windows.length,s.windows.length+1);assert.equal(after.scenes.at(-1).members[0],a.id);pass('明确收起选定浮窗并继续，只新建一次');
 await ctx.close();
}
{
 const{s}=setup();const tabs=[];for(let i=0;i<3;i++){const t=M.openNew(s,'note',{text:'标签'+i});tabs.push(t.id);M.minimize(s);}const a=M.openNew(s,'reading'),b=M.openNew(s,'note',{text:'新笔记'});const{ctx,p,f,st,tap}=await start(s);
 const before=placement(await st());await tap('.ep-sheet[data-front=true] [data-act=minimize]');await expect(f.locator('.ep-capacity')).toContainText('三个标签已满');assert.equal(placement(await st()),before);await tap('[data-act=capacity-cancel]');assert.equal(placement(await st()),before);
 await tap('.ep-sheet[data-front=true] [data-act=minimize]');await tap(`[data-act=capacity-close][data-id="${tabs[1]}"]`);const after=await st();assert.equal(after.tabs.length,3);assert(after.tabs.some(t=>t.id===b.id));assert(!after.tabs.some(t=>t.id===tabs[1]));assert.deepEqual(after.floating,[a.id]);assert.equal(after.notes[M.get(s,tabs[1]).contentId].text,'标签1');pass('标签满额拒绝，显式关闭一个再继续，不删笔记');
 await tap(`.ep-tab-item [data-act=close-window][data-id="${tabs[0]}"]`);assert.equal((await st()).tabs.length,2);pass('悬浮标签有直接关闭入口');await ctx.close();
}
{
 const{s,base,a}=setup(),lower=M.openNew(s,'reading',{book:43,chapter:3});M.pair(s,lower.id);const one=M.openNew(s,'note'),two=M.openNew(s,'reference');const floats=JSON.stringify(s.floating);const{ctx,p,f,st,tap}=await start(s);
 await tap('[data-act=scene-menu]');await tap('[data-act=unpair]');const after=await st();assert.equal(after.scenes.at(-1).members[0],a.id);assert.equal(after.scenes.at(-2).members[0],lower.id);assert.equal(after.scenes[0].members[0],base.id);assert.equal(JSON.stringify(after.floating),floats);await tap('.ep-main [data-act=close-window]');assert.equal((await st()).scenes.at(-1).members[0],lower.id);pass('拆除对读，上窗在顶层，下窗紧随其后，两浮窗保留');await ctx.close();
}
{
 const{s}=setup(),one=M.openNew(s,'reading',{book:43,chapter:3}),two=M.openNew(s,'note',{text:'可上下移动的笔记\n罗8:29'});const{ctx,p,f,st,tap}=await start(s),cdp=await ctx.newCDPSession(p);
 async function drag(selector,dy,dx=0,cancel=false){const r=await f.locator(selector).boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/10,y:y+dy*i/10}]});await p.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await p.waitForTimeout(500);}
 const sel=`.ep-sheet[data-window-id="${two.id}"]`,startBox=await f.locator(sel).boundingBox();await drag(sel+' .ep-handle',-155);const moved=await f.locator(sel).boundingBox();assert(moved.y<startBox.y-140);assert(Math.abs(moved.height-startBox.height)<1);await expect(f.locator('.ep-drawer')).toBeHidden();pass('真实触摸顶柄只移动，固定高度，不误开后台');
 await drag(sel+' .ep-resize',75);const resized=await f.locator(sel).boundingBox();assert(resized.height>moved.height+65);assert(Math.abs(resized.y-moved.y)<1);pass('下柄只调高度，顶部位置不变');
 const original=await st();await drag(sel+' .ep-handle',-50,0,true);assert.equal((await st()).windows.find(w=>w.id===two.id).floatTop,original.windows.find(w=>w.id===two.id).floatTop);pass('取消拖动恢复原位置');
 await reveal(f,sel+' .ep-handle');await f.locator(sel+' .ep-handle').focus();await p.keyboard.press('ArrowUp');await p.waitForTimeout(300);const keyed=await f.locator(sel).boundingBox();assert(Math.abs(keyed.y-resized.y+24)<1);pass('方向键微调浮窗位置');
 const geometry=(await st()).windows.filter(w=>[one.id,two.id].includes(w.id)).map(w=>[w.id,w.height,w.floatTop]);
 await tap('.ep-main [data-act=drawer]');await tap('[data-act=new-reading]');await tap('.ep-directory [data-pick-book="1"]');await tap('.ep-directory [data-pick-chapter="1"]');assert.deepEqual((await st()).windows.filter(w=>[one.id,two.id].includes(w.id)).map(w=>[w.id,w.height,w.floatTop]),geometry);assert.deepEqual((await st()).floating,[one.id,two.id]);pass('目录独立新开最大化，两个浮窗位置与层级不变');
 await p.reload();await expect(f.locator(sel)).toBeVisible();await p.waitForTimeout(650);assert.deepEqual((await st()).windows.filter(w=>[one.id,two.id].includes(w.id)).map(w=>[w.id,w.height,w.floatTop]),geometry);pass('刷新保留两浮窗的高度、位置与顺序');
 await p.setViewportSize({width:320,height:500});await p.waitForTimeout(300);for(const box of await f.locator('.ep-sheet').evaluateAll(ns=>ns.map(n=>({r:n.getBoundingClientRect().toJSON(),phone:n.closest('.ep-phone').getBoundingClientRect().toJSON()})))){assert(box.r.top>=box.phone.top);assert(box.r.bottom<=box.phone.bottom);assert(box.r.width<=box.phone.width);}await p.screenshot({path:path.join(out,'narrow-short.png')});pass('窄屏和视口缩短时两浮窗仍在边界内');
 await ctx.close();
}
{
 const{s}=setup(),note=M.openNew(s,'note',{text:'v6 私人笔记'});s.version=6;s.floating=note.id;delete note.floatTop;const{ctx,p,f,st,tap}=await start(s);assert.equal((await st()).version,7);assert.deepEqual((await st()).floating,[note.id]);const backup=await p.evaluate(()=>{const key='codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]);return JSON.parse(localStorage.getItem(key+':before-v7'));});assert.equal(backup.privateContent.version,6);assert.equal(backup.privateContent.notes[note.contentId].text,'v6 私人笔记');pass('v6 升级前本地备份，升级后内容不变');await ctx.close();
}
{
 const{s}=setup();M.openNew(s,'note',{text:'导出与移动验证'});const reader=M.openNew(s,'reading',{book:43,chapter:3});const{ctx,p,f,st,tap}=await start(s),cdp=await ctx.newCDPSession(p);
 const sel=`.ep-sheet[data-window-id="${reader.id}"]`,scroller=f.locator(sel+' .ep-scroll'),r=await scroller.boundingBox(),before=await st(),oldScroll=await scroller.evaluate(e=>e.scrollTop);
 const x=r.x+r.width/2,y=r.y+r.height*.7;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*7}]});await p.waitForTimeout(30);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(700);
 const after=await st();assert.equal(after.windows.find(w=>w.id===reader.id).floatTop,reader.floatTop);assert.equal(after.windows.find(w=>w.id===reader.id).height,reader.height);assert(await scroller.evaluate(e=>e.scrollTop)>oldScroll);assert.equal(after.windows.find(w=>w.id===M.top(s).members[0]).pages[0].scroll,before.windows.find(w=>w.id===M.top(s).members[0]).pages[0].scroll);pass('正文真实触摸只滚动，不移动浮窗、不穿透主窗');
 const geometry=JSON.stringify(after.windows.map(w=>[w.id,w.height,w.floatTop]));
 await p.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'emmaus-visible-viewport',bottom:420},'*'));await p.waitForTimeout(200);assert((await f.locator(sel).boundingBox()).y+(await f.locator(sel).boundingBox()).height<=420);assert.equal(JSON.stringify((await st()).windows.map(w=>[w.id,w.height,w.floatTop])),geometry);
 await p.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'emmaus-visible-viewport',bottom:800},'*'));await p.waitForTimeout(200);assert.equal(JSON.stringify((await st()).windows.map(w=>[w.id,w.height,w.floatTop])),geometry);pass('可见视口缩短与恢复不覆盖保存的几何');
 await tap('.ep-main [data-act=drawer]');const downloadPromise=p.waitForEvent('download');await f.locator('.ep-drawer [data-act=export]').tap();const download=await downloadPromise;const file=path.join(out,'export-test.json');await download.saveAs(file);const exported=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(exported.version,7);assert.equal(exported.floating.length,2);assert(Object.values(exported.notes).some(n=>n.text==='导出与移动验证'));pass('v7 导出可下载并保留两浮窗及笔记');await ctx.close();
}
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors}));await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
