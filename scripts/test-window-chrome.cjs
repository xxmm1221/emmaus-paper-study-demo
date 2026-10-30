const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
require('../src/window-model.js');
const M=globalThis.EmmausWindows,{reveal}=require('./ui-test-helpers.cjs');
const out=path.resolve(__dirname,'../.build/chrome');fs.mkdirSync(out,{recursive:true});
const checks=[],errors=[],pass=n=>{checks.push(n);console.log('PASS '+n);};
const windowOnly=['pin','pair','unpair','close-scene'];
const contentOnly=['prev','next','back','forward','open-note','open-reference','note-edit','commentary-index','reference-reading'];
async function activate(pane){await pane.focus();await pane.press('Enter');await expect(pane).toHaveAttribute('data-tools-visible','true');}
async function persistent(sheet){
 for(const act of ['promote','minimize']){
  const button=sheet.locator('.ep-pane-head > .ep-window-shortcuts [data-act="'+act+'"]');
  await expect(button).toBeVisible();await expect(button).toBeEnabled();
  assert(await button.evaluate(n=>!n.closest('[inert]')),'常用浮窗控件不能 inert');
 }
}
async function fits(pane){
 const issues=await pane.evaluate(n=>{
  const issues=[];
  for(const selector of ['.ep-pane-head','.ep-pane-actions']){
   const bar=n.querySelector(selector),rect=bar.getBoundingClientRect();
   if(!bar.checkVisibility({visibilityProperty:true,opacityProperty:true}))continue;
   if(bar.scrollWidth>bar.clientWidth+1)issues.push(selector+' horizontal overflow');
   for(const b of bar.querySelectorAll('button')){
    if(!b.checkVisibility({visibilityProperty:true,opacityProperty:true}))continue;
    const r=b.getBoundingClientRect();
    if(r.left<rect.left-1||r.right>rect.right+1||r.top<rect.top-1||r.bottom>rect.bottom+1)issues.push(b.dataset.act+' clipped');
   }
  }
  return issues;
 });
 assert.deepEqual(issues,[],'常用操作不需要横向滚动，也不能被裁切');
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  async function start(s,options={}){
   const ctx=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true,...options});
   await ctx.addInitScript(raw=>{if(window===window.top&&!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','yes');localStorage.setItem('codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]),JSON.stringify({privateContent:raw}));}},s);
   const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.DEMO_URL||'http://127.0.0.1:8769');
   const f=p.frameLocator('iframe');await expect(f.locator('.ep-main .ep-pane[data-ready=true]').first()).toBeVisible();await p.waitForTimeout(650);
   const tap=async selector=>{await reveal(f,selector);await f.locator(selector).last().tap(selector.includes('menu-close')?{position:{x:20,y:60}}:{});await p.waitForTimeout(600);};
   return{ctx,p,f,st:()=>p.frames()[1].evaluate(()=>window.openai.widgetState.privateContent),tap};
  }
  const setup=()=>{const s=M.fresh(),main=M.openPrimary(s,'reading',{book:45,chapter:8,verse:28});return{s,main};};
  {
   const{s}=setup(),note=M.openNew(s,'note',{text:'查阅 罗8:29'}),{ctx,p,f,st,tap}=await start(s);
   const pane=f.locator('.ep-main .ep-pane'),sheet=f.locator('.ep-sheet');
   await expect(pane).toHaveAttribute('data-tools-visible','false');await expect(pane.locator('[data-act=move-float]')).toBeHidden();
   await persistent(sheet);await expect(sheet.locator('[data-act=pane-menu]')).toBeHidden();await expect(sheet.locator('[data-act=close-window]')).toBeHidden();await expect(f.locator('.ep-tools-restore')).toHaveCount(0);
   pass('沉浸态保留浮窗最大化与收标签，不显示悬浮圆形三个点');
   await pane.locator('.ep-pane-title').tap();await expect(f.locator('.ep-directory')).toBeVisible();await tap('[data-act=directory-close]');
   await activate(pane);await expect(pane.locator('.ep-content-tools')).toBeVisible();await expect(f.locator('.ep-directory')).toBeHidden();await expect(sheet.locator('.ep-pane')).toHaveAttribute('data-tools-visible','false');await persistent(sheet);
   pass('标题一次点按直接选章，键盘激活窗口工具且不唤醒其他窗口');
   await tap('.ep-main [data-act=pane-menu]');await expect(f.locator('.ep-popover')).toHaveAttribute('data-scope','window');
   const windowActs=await f.locator('.ep-popover button').evaluateAll(ns=>ns.map(n=>n.dataset.act));
   assert(windowActs.includes('pin'));assert(windowActs.every(a=>windowOnly.includes(a)));assert(!windowActs.some(a=>contentOnly.includes(a)));
   await expect(pane.locator('[data-act=move-float]')).toBeVisible();await expect(pane.locator('[data-act=close-window]')).toBeVisible();
   pass('窗口更多保留低频动作，高频窗口操作直达且不混入内容操作');
   await tap('[data-act=menu-close]');await tap('.ep-main [data-act=content-menu]');await expect(f.locator('.ep-popover')).toHaveAttribute('aria-label','经文操作');
   const contentActs=await f.locator('.ep-popover button').evaluateAll(ns=>ns.map(n=>n.dataset.act));
   assert.deepEqual(contentActs,['back','forward']);
   assert(!contentActs.some(a=>windowOnly.includes(a)));
   for(const act of ['prev','next','open-note','open-reference'])await expect(pane.locator('.ep-content-tools [data-act="'+act+'"]')).toBeVisible();
   for(const act of ['back','forward'])await expect(pane.locator('.ep-content-tools [data-act="'+act+'"]')).toHaveCount(0);
   pass('上下章和选中经文操作直达，浏览历史留在独立内容菜单');await tap('[data-act=menu-close]');
   await p.screenshot({path:path.join(out,'main-active.png')});
   const cdp=await ctx.newCDPSession(p);
   async function swipe(target,dy){const r=await target.locator('.ep-scroll').boundingBox(),x=r.x+80,y=r.y+Math.min(100,r.height/2);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy*i/8}]});await p.waitForTimeout(25);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await p.waitForTimeout(650);}
   await swipe(pane,-85);await expect(pane).toHaveAttribute('data-tools-visible','false');await expect(pane.locator('.ep-content-tools')).toBeHidden();await expect(pane.locator('[data-act=move-float]')).toBeHidden();await persistent(sheet);
   pass('阅读滑动收起主窗工具，浮窗常用控制不跟随消失');await swipe(pane,65);await expect(pane).toHaveAttribute('data-tools-visible','false');pass('反向滚动不自动唤出工具');
   await activate(pane);pass('滚动后可重新显式唤醒工具');
   await sheet.locator('.ep-handle').tap();await expect(pane).toHaveAttribute('data-tools-visible','false');await expect(sheet.locator('.ep-pane')).toHaveAttribute('data-tools-visible','true');await expect(sheet.locator('[data-act=pane-menu]')).toBeVisible();await expect(sheet.locator('[data-act=close-window]')).toBeVisible();await persistent(sheet);
   pass('浮窗点按拖柄独占激活，常用与次级操作有清楚层次');
   await tap('.ep-sheet [data-act=note-edit]');await sheet.locator('textarea').fill('编辑后的笔记\n约3:16');await p.keyboard.press('Space');await p.keyboard.press('ArrowLeft');await expect(sheet.locator('.ep-pane')).toHaveAttribute('data-tools-visible','true');await sheet.locator('textarea').fill('编辑后的笔记\n约3:16');
   pass('笔记编辑空格和方向键不会误触沉浸隐藏');await tap('.ep-sheet [data-act=note-edit]');assert.equal((await st()).notes[note.contentId].text,'编辑后的笔记\n约3:16');
   await expect(sheet.locator('.ep-content-tools [data-act=note-edit]')).toBeVisible();await expect(sheet.locator('[data-act=content-menu]')).toHaveCount(0);
   pass('笔记编辑和完成直达，不复制一个仅含编辑按钮的菜单，正文真实保存');
   await tap('.ep-sheet .ep-scripture-link');assert.equal((await st()).floating.length,2);const front=f.locator('.ep-sheet[data-front=true]');await expect(front.locator('.ep-pane')).toHaveAttribute('data-tools-visible','false');await persistent(front);
   pass('笔记引用短按衍生第二浮窗，新窗工具默认沉浸但常用控制可见');
   await front.locator('.ep-handle').tap();await p.waitForTimeout(200);await p.screenshot({path:path.join(out,'two-floats-active.png')});
   await tap('.ep-sheet[data-front=true] [data-act=pane-menu]');const floats=await f.locator('.ep-popover button').evaluateAll(ns=>ns.map(n=>n.dataset.act));assert(floats.includes('pair')&&floats.includes('pin'));assert(floats.every(a=>windowOnly.includes(a)));await tap('[data-act=menu-close]');
   pass('浮窗更多只含低频复制与对读，不重复最大化、收标签及关闭');
   await swipe(front.locator('.ep-pane'),-55);await expect(front.locator('.ep-pane')).toHaveAttribute('data-tools-visible','false');await persistent(front);await expect(front.locator('[data-act=close-window]')).toBeHidden();
   pass('浮窗内容滑动时保留最大化与收标签，次级按钮收起');
   await front.locator('.ep-handle').tap();await p.setViewportSize({width:320,height:800});await p.waitForTimeout(250);await fits(front.locator('.ep-pane'));
   assert(await front.locator('.ep-pane-actions').evaluate(n=>n.clientHeight>=38&&n.clientHeight<=42));
   await expect(front.locator('.ep-window-aux [data-act=raise-float]')).toBeVisible();
   pass('320px 双浮窗经文工具保持单行，另一浮窗入口完整可操作');
   await tap('.ep-sheet[data-front=true] .ep-window-aux [data-act=raise-float]');assert.equal((await st()).floating.at(-1),note.id);await expect(f.locator('.ep-sheet[data-front=false] .ep-pane')).toHaveAttribute('data-tools-visible','false');await persistent(f.locator('.ep-sheet[data-front=false]'));
   pass('激活工具区可直接切换浮窗，旧窗仅收起次级工具');
   for(const width of [320,430]){await p.setViewportSize({width,height:800});await p.waitForTimeout(250);await fits(f.locator('.ep-sheet[data-front=true] .ep-pane'));await persistent(f.locator('.ep-sheet[data-front=true]'));await p.screenshot({path:path.join(out,'width-'+width+'.png')});pass(width+'px 常用按钮完整可见，不需横向滑动');}
   await p.reload();await expect(f.locator('.ep-sheet')).toHaveCount(2);await expect(f.locator('.ep-sheet .ep-pane').first()).toHaveAttribute('data-tools-visible','false');await persistent(f.locator('.ep-sheet').first());assert.equal((await st()).notes[note.contentId].text,'编辑后的笔记\n约3:16');
   pass('刷新保留笔记与双浮窗，常用控制保留且次级工具收起');await ctx.close();
  }
  {
   const{s,main}=setup();M.page(main).selected=null;M.page(main).book=1;M.page(main).chapter=1;
   const{ctx,p,f,st,tap}=await start(s),pane=f.locator('.ep-main .ep-pane');await activate(pane);await expect(pane.locator('[data-act=prev]')).toBeDisabled();
   for(const act of ['open-note','open-reference'])await expect(pane.locator('.ep-content-tools [data-act="'+act+'"]')).toHaveCount(0);
   await tap('.ep-main [data-act=content-menu]');for(const act of ['open-note','open-reference'])await expect(f.locator('.ep-popover [data-act="'+act+'"]')).toHaveCount(0);assert.equal((await st()).floating.length,0);await tap('[data-act=menu-close]');
   pass('未选经文不展示衍生快捷键，历史菜单无绕过选择入口，首章上一章禁用');
   const history=async act=>{await tap('.ep-main [data-act=content-menu]');await tap('.ep-popover [data-act="'+act+'"]');};
   await tap('.ep-main .ep-content-tools [data-act=next]');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 2');
   await history('back');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 1');await history('forward');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 2');
   pass('顶栏切章与内容菜单历史后退、前进实际可用');
   await tap('.ep-main .ep-content-tools [data-act=next]');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 3');await history('back');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 2');await tap('.ep-main .ep-content-tools [data-act=prev]');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 1');await tap('.ep-main .ep-content-tools [data-act=next]');await expect(pane.locator('[data-reading-title]')).toHaveText('创世记 2');
   pass('连续切章与历史后退保持一致，上一章和下一章均可直接操作');
   await tap('.ep-main [data-verse="1"]');await expect(pane.locator('.ep-content-tools [data-act=open-note]')).toBeEnabled();await expect(pane.locator('.ep-content-tools [data-act=open-reference]')).toBeEnabled();
   await p.setViewportSize({width:320,height:800});await p.waitForTimeout(200);await fits(pane);
   pass('320px 选中经文后新增上下文按钮仍完整呈现');
   await tap('.ep-main .ep-content-tools [data-act=open-note]');const after=await st(),note=after.windows.find(w=>w.id===after.floating[0]);assert.equal(note?.kind,'note');assert.equal(note.citation.book,1);assert.equal(note.citation.chapter,2);assert.equal(note.citation.verse,1);
   pass('选中经文快捷创建笔记并正确绑定引用');await ctx.close();
  }
  {
   const{s,main}=setup(),lower=M.openNew(s,'reading',{book:43,chapter:3});M.pair(s,lower.id);
   const{ctx,p,f,st,tap}=await start(s,{colorScheme:'dark'}),panes=f.locator('.ep-main .ep-pane');
   for(const index of [0,1]){
    await activate(panes.nth(index));await expect(panes.nth(1-index)).toHaveAttribute('data-tools-visible','false');
    await panes.nth(index).locator('[data-act=pane-menu]').tap();await expect(f.locator('.ep-popover [data-act=unpair]')).toBeVisible();await expect(f.locator('.ep-popover [data-act=close-scene]')).toBeVisible();await tap('[data-act=menu-close]');
   }
   pass('对读任一成员均可键盘激活并访问组合操作，不依赖首窗');
   await p.screenshot({path:path.join(out,'dark-pair.png')});await panes.last().focus();await p.keyboard.press('Escape');await expect(panes.last()).toHaveAttribute('data-tools-visible','false');pass('对读独占激活，Escape 收起工具');
   await activate(panes.last());await panes.last().locator('[data-act=pane-menu]').tap();await tap('.ep-popover [data-act=unpair]');assert.equal((await st()).scenes.at(-1).members[0],main.id);assert.equal((await st()).scenes.at(-2).members[0],lower.id);
   pass('从第二成员菜单拆除对读，仍保持上窗顶层、下窗第二层');await ctx.close();
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
 }catch(error){for(const page of browser.contexts().flatMap(c=>c.pages()))await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
