const {chromium,expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
require('../src/window-model.js');const M=globalThis.EmmausWindows;
const out=path.resolve(__dirname,'../.build/responsive');fs.mkdirSync(out,{recursive:true});const checks=[],errors=[];
const pass=n=>{checks.push(n);console.log('PASS '+n);};
const setup=()=>{const s=M.fresh(),a=M.openPrimary(s,'reading',{book:45,chapter:8}),b=M.openNew(s,'reading',{book:43,chapter:3});M.pair(s,b.id);M.top(s).ratio=.4;return{s,a,b};};
{
 const{s,a,b}=setup(),windows=JSON.stringify(s.windows);M.openNew(s,'note',{text:'保留'});const scene=M.top(s),floats=JSON.stringify(s.floating),notes=JSON.stringify(s.notes);
 M.swapPair(s,scene.id);assert.deepEqual(scene.members,[b.id,a.id]);assert.equal(scene.ratio,.6);assert.equal(JSON.stringify(s.windows.slice(0,2)),windows);assert.equal(JSON.stringify(s.floating),floats);assert.equal(JSON.stringify(s.notes),notes);M.assert(s);pass('交换只改对读次序与比例，保留视图、笔记和浮窗');
 M.swapPair(s,scene.id);assert.deepEqual(scene.members,[a.id,b.id]);assert.equal(scene.ratio,.4);pass('连续交换恢复原位置和尺寸');M.swapPair(s,scene.id);M.unpair(s,scene.id);assert.equal(M.top(s).members[0],b.id);assert.equal(s.scenes.at(-2).members[0],a.id);pass('交换后拆除，以当前左侧或上方窗口置顶');const raw=JSON.stringify(s);assert.equal(M.swapPair(s,M.top(s).id),false);assert.equal(M.swapPair(s,'missing'),false);assert.equal(JSON.stringify(s),raw);pass('非对读场景交换无副作用');
}
(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
for(const mobile of [false,true]){
 const{s,a,b}=setup(),ctx=await browser.newContext({viewport:mobile?{width:390,height:800}:{width:1280,height:900},isMobile:mobile,hasTouch:true});
 await ctx.addInitScript(raw=>{if(window===window.top&&!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','yes');localStorage.setItem('codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]),JSON.stringify({privateContent:raw}));}},s);
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.DEMO_URL||'http://127.0.0.1:8769/');const f=p.frameLocator('iframe'),st=()=>p.frames()[1].evaluate(()=>window.openai.widgetState.privateContent),div=f.locator('.ep-divider');await expect(f.locator('.ep-main .ep-pane[data-ready=true]')).toHaveCount(2);await p.waitForTimeout(700);
 const boxes=()=>f.locator('.ep-main .ep-pane').evaluateAll(ns=>ns.map(n=>{const r=n.getBoundingClientRect();return{id:n.dataset.windowId,x:r.x,y:r.y,w:r.width,h:r.height};}));
 let r=await boxes();assert(mobile?r[1].y>r[0].y+r[0].h:r[1].x>r[0].x+r[0].w);await expect(div).toHaveAttribute('data-axis',mobile?'y':'x');pass(mobile?'窄屏上下对读':'宽屏画布与左右对读');
 await div.click();await expect(f.locator('[data-motion-ghost]')).toHaveCount(2);await p.waitForTimeout(700);let now=await st();assert.deepEqual(now.scenes.at(-1).members,[b.id,a.id]);assert.equal(now.scenes.at(-1).ratio,.6);r=await boxes();assert.equal(r[0].id,b.id);pass((mobile?'上下':'左右')+'点按交换，尺寸随窗口保留');
 const cdp=await ctx.newCDPSession(p);
 async function drag(delta,cancel=false){const r=await div.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(mobile?0:delta*i/8),y:y+(mobile?delta*i/8:0)}]});await p.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await p.waitForTimeout(600);}
 await drag(-100);now=await st();assert(now.scenes.at(-1).ratio<.6);assert.deepEqual(now.scenes.at(-1).members,[b.id,a.id]);await expect(f.locator('.ep-drawer')).toBeHidden();pass((mobile?'竖向':'横向')+'触摸拖动调比例，不交换或打开后台');
 const before=now.scenes.at(-1).ratio;await drag(45,true);assert.equal((await st()).scenes.at(-1).ratio,before);pass((mobile?'窄屏':'宽屏')+'取消拖动还原比例');
 await div.focus();await p.keyboard.press(mobile?'ArrowDown':'ArrowRight');await p.waitForTimeout(600);assert((await st()).scenes.at(-1).ratio>before);await p.keyboard.press('Enter');await p.waitForTimeout(700);assert.deepEqual((await st()).scenes.at(-1).members,[a.id,b.id]);pass((mobile?'窄屏':'宽屏')+'方向键调整与 Enter 交换');
 await expect(div).toBeFocused();await p.keyboard.press('Space');await p.waitForTimeout(700);assert.deepEqual((await st()).scenes.at(-1).members,[b.id,a.id]);pass((mobile?'窄屏':'宽屏')+'交换后保持键盘焦点，空格可继续交换');
 const order=(await st()).scenes.at(-1).members,ratio=(await st()).scenes.at(-1).ratio;
 for(const width of (mobile?[844,390]:[760,768,1024,1920,759,1280])){await p.setViewportSize({width,height:900});await p.waitForTimeout(350);r=await boxes();const wide=width>=760;assert(wide?r[1].x>r[0].x+r[0].w:r[1].y>r[0].y+r[0].h);if(wide)assert(r.every(x=>x.w>=319));assert.deepEqual((await st()).scenes.at(-1).members,order);assert.equal((await st()).scenes.at(-1).ratio,ratio);}pass((mobile?'手机旋转':'多档桌面断点')+'自适应且保留次序、比例和可读宽度');
 await p.screenshot({path:path.join(out,mobile?'narrow-pair.png':'wide-pair.png')});await p.emulateMedia({colorScheme:'dark'});await p.screenshot({path:path.join(out,mobile?'narrow-dark.png':'wide-dark.png')});
 await p.reload();await expect(div).toBeVisible();await p.waitForTimeout(650);assert.deepEqual((await st()).scenes.at(-1).members,order);assert.equal((await st()).scenes.at(-1).ratio,ratio);pass((mobile?'窄屏':'宽屏')+'刷新保留对调与比例');
 // Actual shortcut creation uses the same width constraint for all floating windows.
 await f.locator('.ep-main .ep-pane-title').first().click();await f.locator('.ep-main [data-act=pin]').first().click();await p.waitForTimeout(700);await f.locator('.ep-main .ep-pane-title').last().click();await f.locator('.ep-main [data-act=pin]').last().click();await p.waitForTimeout(700);await expect(f.locator('.ep-sheet')).toHaveCount(2);
 const widths=await f.locator('.ep-sheet').evaluateAll(ns=>ns.map(n=>n.getBoundingClientRect().width));assert(widths.every(w=>mobile?w>350&&w<390:w<=440&&w>400));pass((mobile?'窄屏浮窗保留原宽度':'宽屏双浮窗最大宽度 440px'));
 await p.screenshot({path:path.join(out,mobile?'narrow-floats.png':'wide-floats.png')});await ctx.close();
}
assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors}));await browser.close();})().catch(e=>{console.error(e);process.exit(1);});
