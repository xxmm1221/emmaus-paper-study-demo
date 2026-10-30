// Independent acceptance for the compact window chrome. Interactions use real
// pointer/keyboard events; model seeding only prepares independent scenarios.
const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('../src/window-model.js');
const M=globalThis.EmmausWindows;
const url=process.env.DEMO_URL||'http://127.0.0.1:8769/';
const out=path.resolve(__dirname,'../.build/window-ux');
fs.mkdirSync(out,{recursive:true});
const checks=[],failures=[],errors=[];
const delay=650;
let browser;

function seed({twoFloats=false,pair=false,noSelection=false}={}){
  const s=M.fresh();
  const main=M.openPrimary(s,'reading',{book:45,chapter:8,verse:noSelection?undefined:28});
  const reading=M.openNew(s,'reading',{book:43,chapter:3,verse:16});
  reading.floatTop=.37;reading.height=.55;
  if(pair)M.pair(s,reading.id);
  let note;
  if(twoFloats){
    note=M.openNew(s,'note',{citation:{book:45,chapter:8,verse:28},text:'查考笔记 · 约3:16\n\n'+Array.from({length:16},(_,i)=>`第 ${i+1} 段：保留阅读现场，对照经文并记录观察。`).join('\n\n')});
    note.floatTop=.47;note.height=.46;
  }
  return{s,main,reading,note};
}

async function start(s,{width=390,theme='light'}={}){
  const ctx=await browser.newContext({viewport:{width,height:800},isMobile:width<600,hasTouch:width<600,colorScheme:theme});
  await ctx.addInitScript(raw=>{
    if(window===window.top&&!sessionStorage.getItem('window-ux-seeded')){
      sessionStorage.setItem('window-ux-seeded','yes');
      localStorage.setItem('codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]),JSON.stringify({privateContent:raw}));
    }
  },s);
  const p=await ctx.newPage();
  p.on('pageerror',e=>errors.push({width,theme,message:e.message}));
  await p.goto(url);
  const f=p.frameLocator('iframe');
  await expect(f.locator('.ep-main .ep-pane[data-ready=true]').first()).toBeVisible();
  await p.waitForTimeout(delay);
  const st=()=>p.frames().find(x=>x!==p.mainFrame()).evaluate(()=>window.openai.widgetState.privateContent);
  const pane=id=>f.locator(`.ep-pane[data-window-id="${id}"]`);
  const sheet=id=>f.locator(`.ep-sheet[data-window-id="${id}"]`);
  async function reveal(id){
    const target=pane(id);
    if(await target.getAttribute('data-tools-visible')==='true')return;
    if(await sheet(id).count())await sheet(id).locator('.ep-handle').click();
    else{await target.focus();await p.keyboard.press('Enter');}
    await expect(target).toHaveAttribute('data-tools-visible','true');
  }
  async function act(id,name){
    await reveal(id);
    await pane(id).locator(`[data-act="${name}"]`).last().click();
    await p.waitForTimeout(delay);
  }
  return{ctx,p,f,st,pane,sheet,reveal,act};
}

async function test(name,run){
  let app;
  try{
    await run(async(s,opts)=>app=await start(s,opts));
    checks.push(name);console.log('PASS '+name);
  }catch(e){
    const failure={name,message:e.message};failures.push(failure);
    console.error('FAIL '+name+'\n'+e.message);
    if(app)await app.p.screenshot({path:path.join(out,'failure-'+failures.length+'.png')}).catch(()=>{});
  }finally{if(app)await app.ctx.close();}
}

async function usable(control,{container=null,hit=true,minHeight=0,requireEnabled=true}={}){
  await expect(control).toBeVisible();if(requireEnabled)await expect(control).toBeEnabled();
  if(!requireEnabled&&await control.isDisabled())hit=false;
  const result=await control.evaluate((el,{minHeight,hit})=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el),at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    return{rect:{x:r.x,y:r.y,width:r.width,height:r.height},inert:!!el.closest('[inert]'),opacity:Number(style.opacity),inside:r.x>=-1&&r.y>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,heightOK:r.height>=minHeight-.5,hit:!hit||!!at&&(el===at||el.contains(at))};
  },{minHeight,hit});
  assert(result.inside,'按钮超出视口');assert(!result.inert,'可见按钮被 inert 禁用');assert(result.opacity>0,'按钮透明不可见');assert(result.heightOK,`点击区不足 ${minHeight}px`);assert(result.hit,'按钮中心被其他元素遮挡');
  if(container){
    const box=await container.boundingBox(),r=await control.boundingBox();
    assert(r.x>=box.x-1&&r.y>=box.y-1&&r.x+r.width<=box.x+box.width+1&&r.y+r.height<=box.y+box.height+1,'按钮被容器边界裁切');
  }
}

async function inspectMenu(app,trigger,{windowMenu=true}={}){
  const{p,f}=app;
  await trigger.click();
  const menu=f.locator('.ep-popover');
  await expect(menu).toBeVisible();await expect(menu).toHaveAttribute('role','menu');
  const items=menu.locator('button');
  assert(await items.count()>0,'菜单不能为空');
  const entries=await items.evaluateAll(ns=>ns.map(n=>({act:n.dataset.act,role:n.getAttribute('role'),height:n.getBoundingClientRect().height,align:getComputedStyle(n).justifyContent,icon:n.querySelector('svg')?.getBoundingClientRect().x,text:n.textContent.trim()})));
  assert(entries.every(e=>e.role==='menuitem'),'每个菜单按钮应为 menuitem');
  assert(entries.every(e=>e.height>=43.5),'菜单项至少 44px 点区');
  assert(entries.every(e=>e.align!=='center'),'菜单不得居中堆叠文本');
  const iconXs=entries.map(e=>e.icon).filter(Number.isFinite);
  assert(iconXs.length===entries.length,'每项应有固定图标槽');
  assert(Math.max(...iconXs)-Math.min(...iconXs)<2,'图标列未对齐');
  if(windowMenu)assert(!entries.some(e=>['promote','minimize','close-window','prev','next','back','forward','open-note','open-reference'].includes(e.act)),'窗口菜单混入高频或内容操作');
  const geometry=await menu.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,w:innerWidth,h:innerHeight};});
  const bounds=geometry,anchor=await trigger.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
  assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=geometry.w+1&&bounds.y+bounds.height<=geometry.h+1,'菜单越出视口');
  const gap=Math.max(0,bounds.y-anchor.y-anchor.height,anchor.y-bounds.y-bounds.height);
  assert(gap<30,'菜单远离触发按钮');
  const enabled=menu.locator('button:not(:disabled)');
  if(await enabled.count()){
    await expect(enabled.first()).toBeFocused();
    await p.keyboard.press('ArrowDown');
    await expect((await enabled.count())>1?enabled.nth(1):enabled.first()).toBeFocused();
    await p.keyboard.press('ArrowUp');await expect(enabled.first()).toBeFocused();
    await p.keyboard.press('ArrowUp');await expect(enabled.last()).toBeFocused();
  }
  await p.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
}

(async()=>{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});

  for(const width of [390,320,1280])for(const theme of ['light','dark']){
    await test(`${width}px ${theme}：常用窗口动作固定在顶栏，内容工具不横向藏按钮`,async open=>{
      const{s,main,reading,note}=seed({twoFloats:true});
      const app=await open(s,{width,theme}),{f,p,pane,sheet,reveal}=app;
      const front=pane(note.id),head=front.locator('.ep-pane-head');
      await expect(front).toHaveAttribute('data-tools-visible','false');
      await expect(head.locator('.ep-window-shortcuts')).toHaveCount(1);
      for(const act of ['promote','minimize'])await usable(head.locator(`[data-act=${act}]`),{container:head});
      for(const act of ['close-window','pane-menu'])await expect(front.locator(`[data-act=${act}]`)).toBeHidden();
      await reveal(note.id);
      for(const act of ['promote','minimize','close-window','pane-menu'])await usable(head.locator(`[data-act=${act}]`),{container:head});
      const content=front.locator('.ep-content-tools');
      const aux=front.locator('.ep-window-aux');
      await usable(aux.locator('[data-act=raise-float]'),{container:aux});
      await expect(content.locator('[data-act=raise-float],[data-act=pair]')).toHaveCount(0);
      await usable(content.locator('[data-act=note-edit]'),{container:content});
      assert(await front.locator('.ep-tool-rail').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'内容栏仍横向溢出');
      const floatingBox=await sheet(note.id).boundingBox();
      if(width===1280)assert(floatingBox.width<=460,'宽屏浮窗过宽');
      await p.screenshot({path:path.join(out,`chrome-${width}-${theme}.png`)});
      await reveal(main.id);
      await usable(pane(main.id).locator('.ep-pane-head [data-act=move-float]'),{container:pane(main.id).locator('.ep-pane-head'),requireEnabled:false});
      const tools=pane(main.id).locator('.ep-content-tools');
      for(const act of ['prev','next','open-note','open-reference','content-menu'])await usable(tools.locator(`[data-act=${act}]`),{container:tools,requireEnabled:!['open-note','open-reference'].includes(act)});
      assert(await pane(main.id).locator('.ep-tool-rail').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'选中经文后的高频工具被横向隐藏');
      await expect(tools.locator('[data-act=back],[data-act=forward]')).toHaveCount(0);
      assert(await pane(main.id).locator('.ep-window-shortcuts').evaluate(n=>!!n.closest('.ep-pane-head')));
      await p.screenshot({path:path.join(out,`reading-${width}-${theme}.png`)});
      await expect(sheet(reading.id)).toBeVisible();
      await reveal(reading.id);
      const readingRail=pane(reading.id).locator('.ep-tool-rail');
      for(const act of ['prev','next','open-note','open-reference','content-menu','raise-float'])await usable(readingRail.locator(`[data-act=${act}]`),{container:readingRail,minHeight:40,requireEnabled:!['open-note','open-reference'].includes(act)});
      await expect(readingRail.locator('[data-act=pair]')).toHaveCount(0);
      assert(await readingRail.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'双浮窗经文工具及窗口切换需要横滑');
      const railSize=await readingRail.boundingBox();
      assert(railSize.height>=40&&railSize.height<=41.5,`经文浮窗工具应为单行 40px（允许 1px 分隔线），实际 ${railSize.height}px`);
      const switcher=readingRail.locator('[data-act=raise-float]'),switchSize=await switcher.boundingBox();
      assert(switchSize.width>=39.5&&switchSize.height>=39.5,'另一浮窗的触控区域小于 40px');
      await expect(switcher).toHaveAttribute('aria-label',/切换到/);await expect(switcher).toHaveAttribute('title',/切换到/);
      if(width===320)await expect(switcher.locator('span')).toBeHidden();
      await p.screenshot({path:path.join(out,`float-reading-${width}-${theme}.png`)});
    });
  }

  await test('标题单击即开目录，未选经文的笔记/研读不占工具栏',async open=>{
    const{s,main}=seed({noSelection:true});
    const{f,p,pane,reveal,st}=await open(s);
    await pane(main.id).locator('.ep-pane-title').click();await expect(f.locator('.ep-directory')).toBeVisible();
    await f.locator('[data-act=directory-close]').click();await p.waitForTimeout(delay);
    assert.equal((await st()).windows.find(w=>w.id===main.id).pages[0].chapter,8);
    await reveal(main.id);
    await expect(pane(main.id).locator('.ep-content-tools [data-act=open-note],.ep-content-tools [data-act=open-reference]')).toHaveCount(0);
    await pane(main.id).locator('[data-verse="1"]').click();
    for(const action of ['open-note','open-reference'])await usable(pane(main.id).locator(`.ep-content-tools [data-act=${action}]`));
    await pane(main.id).locator('.ep-content-tools [data-act=open-note]').click();await p.waitForTimeout(delay);
    const after=await st(),derived=after.windows.find(w=>w.id===after.floating.at(-1));
    assert.equal(derived.kind,'note');assert.deepEqual([derived.citation.book,derived.citation.chapter,derived.citation.verse],[45,8,1]);
  });

  for(const width of [320,390,1280])await test(`${width}px：轻量窗口菜单定位、44px、方向键和焦点返回`,async open=>{
    const{s,reading}=seed();const app=await open(s,{width});
    await app.reveal(reading.id);
    await inspectMenu(app,app.pane(reading.id).locator('[data-act=pane-menu]'));
  });

  await test('内容历史移入内容菜单，前后章及历史实际可用',async open=>{
    const{s,main}=seed({noSelection:true});const app=await open(s),{pane,act,f,p,st}=app;
    await act(main.id,'next');
    let w=(await st()).windows.find(w=>w.id===main.id);assert.equal(w.pages[w.pageIndex].chapter,9);
    await app.reveal(main.id);await pane(main.id).locator('[data-act=content-menu]').click();
    const acts=await f.locator('.ep-popover [role=menuitem]').evaluateAll(ns=>ns.map(n=>n.dataset.act));
    assert(acts.includes('back')&&acts.includes('forward'),'历史操作缺少内容菜单入口');
    assert(!acts.some(a=>['promote','minimize','close-window','move-float','pin','pair'].includes(a)),'内容菜单混入窗口操作');
    await f.locator('.ep-popover [data-act=back]').click();await p.waitForTimeout(delay);
    w=(await st()).windows.find(w=>w.id===main.id);assert.equal(w.pages[w.pageIndex].chapter,8);
    await app.reveal(main.id);await pane(main.id).locator('[data-act=content-menu]').click();
    await f.locator('.ep-popover [data-act=forward]').click();await p.waitForTimeout(delay);
    w=(await st()).windows.find(w=>w.id===main.id);assert.equal(w.pages[w.pageIndex].chapter,9);
  });

  await test('浮窗滚动后仍可直接收标签；双浮窗切换、笔记保存和刷新保留身份',async open=>{
    const{s,main,reading,note}=seed({twoFloats:true});const app=await open(s),{p,f,pane,sheet,reveal,act,st}=app;
    await reveal(note.id);
    const scroll=pane(note.id).locator('.ep-scroll'),r=await scroll.boundingBox();
    await p.mouse.move(r.x+Math.min(90,r.width/2),r.y+Math.min(65,r.height/2));await p.mouse.wheel(0,150);await p.waitForTimeout(delay);
    await expect(pane(note.id)).toHaveAttribute('data-tools-visible','false');
    for(const action of ['promote','minimize'])await usable(pane(note.id).locator(`.ep-pane-head [data-act=${action}]`));
    await pane(note.id).locator('[data-act=minimize]').click();await p.waitForTimeout(delay);
    assert.deepEqual((await st()).floating,[reading.id]);assert((await st()).tabs.some(t=>t.id===note.id));
    await f.locator(`.ep-tab[data-tab="${note.id}"]`).click();await p.waitForTimeout(delay);
    assert.equal((await st()).floating.at(-1),note.id);
    await act(note.id,'raise-float');assert.equal((await st()).floating.at(-1),reading.id);
    await act(reading.id,'raise-float');assert.equal((await st()).floating.at(-1),note.id);
    await act(note.id,'note-edit');
    const saved='验收保存：恩典与回应\n约3:16';await pane(note.id).locator('textarea').fill(saved);
    await act(note.id,'note-edit');assert.equal((await st()).notes[note.contentId].text,saved);
    const savedTitle=saved.split('\n')[0];
    await expect(pane(note.id).locator('[data-reading-title]')).toHaveText(savedTitle);
    await expect(pane(note.id).locator('.ep-pane-title')).toHaveAttribute('title',savedTitle);
    await expect(pane(note.id)).toHaveAttribute('aria-label',savedTitle);
    await expect(sheet(note.id)).toHaveAttribute('aria-label','浮窗：'+savedTitle);
    assert.deepEqual((await st()).windows.map(w=>w.id),[main.id,reading.id,note.id]);
    await p.reload();await expect(sheet(note.id)).toBeVisible();await p.waitForTimeout(delay);
    const after=await st();assert.equal(after.notes[note.contentId].text,saved);assert.deepEqual(after.floating,[reading.id,note.id]);assert.equal(after.scenes.at(-1).members[0],main.id);
    await usable(pane(note.id).locator('[data-act=promote]'));
    await pane(note.id).locator('[data-act=promote]').click();await p.waitForTimeout(delay);
    assert.equal((await st()).scenes.at(-1).members[0],note.id);assert.deepEqual((await st()).floating,[reading.id]);
  });

  await test('主窗转浮窗及关闭均可顶栏一步操作，不改变其他现场',async open=>{
    const{s,main,reading}=seed();
    const other=M.openPrimary(s,'reading',{book:1,chapter:1});
    const{act,st,f}=await open(s);
    await act(other.id,'move-float');
    let after=await st();assert.deepEqual(after.floating,[reading.id,other.id]);assert.equal(after.scenes.at(-1).members[0],main.id);
    await act(other.id,'close-window');
    after=await st();assert.deepEqual(after.floating,[reading.id]);assert.equal(after.scenes.at(-1).members[0],main.id);
    await expect(f.locator('.ep-popover')).toBeHidden();
  });

  await test('低频复制为浮窗与组成对读仍可在更多菜单完整操作',async open=>{
    const{s,main,reading}=seed();M.closeWindow(s,reading.id);
    const{act,f,p,st}=await open(s);
    await act(main.id,'pane-menu');await f.locator('.ep-popover [data-act=pin]').click();await p.waitForTimeout(delay);
    let after=await st();assert.equal(after.floating.length,1);
    const copyId=after.floating[0],copy=after.windows.find(w=>w.id===copyId);
    assert.notEqual(copyId,main.id);assert.equal(after.scenes.at(-1).members[0],main.id);
    assert.equal(copy.pages[copy.pageIndex].chapter,8);
    await act(copyId,'pane-menu');await f.locator('.ep-popover [data-act=pair]').click();await p.waitForTimeout(delay);
    after=await st();assert.deepEqual(after.scenes.at(-1).members,[main.id,copyId]);assert.deepEqual(after.floating,[]);
  });

  for(const width of [390,1280])await test(`${width}px：对读两侧都有最大化与组合入口，交换不丢现场`,async open=>{
    const{s,main,reading}=seed({pair:true});const{f,p,pane,reveal,st}=await open(s,{width});
    for(const id of [main.id,reading.id]){
      await reveal(id);await usable(pane(id).locator('.ep-pane-head [data-act=promote]'));
      await pane(id).locator('[data-act=pane-menu]').click();
      await expect(f.locator('.ep-popover [data-act=unpair]')).toBeVisible();
      await expect(f.locator('.ep-popover [data-act=close-scene]')).toBeVisible();
      await p.keyboard.press('Escape');
    }
    const before=(await st()).scenes.at(-1);await f.locator('.ep-divider').click();await p.waitForTimeout(delay);
    const after=(await st()).scenes.at(-1);assert.equal(after.id,before.id);assert.deepEqual(after.members,[...before.members].reverse());
    await reveal(reading.id);await pane(reading.id).locator('[data-act=pane-menu]').click();
    await f.locator('.ep-popover [data-act=unpair]').click();await p.waitForTimeout(delay);
    const split=await st();assert.equal(split.scenes.at(-1).members[0],reading.id);assert.equal(split.scenes.at(-2).members[0],main.id);
  });

  await test('侧栏先展示已打开现场，切换主场景保留浮窗和标签',async open=>{
    const{s,main,reading,note}=seed({twoFloats:true});M.minimize(s,reading.id);
    const other=M.openPrimary(s,'reading',{book:1,chapter:1});
    const oldScene=s.scenes.find(x=>x.members.includes(main.id));
    const{f,p,st}=await open(s);
    await f.locator('[data-act=drawer]').click();await expect(f.locator('.ep-drawer')).toBeVisible();
    await expect(f.locator('.ep-drawer>.ep-drawer-caption')).toHaveCount(0);
    await expect(f.locator('.ep-drawer [data-act=root-directory] small,.ep-drawer [data-act=new-commentary] small,.ep-drawer [data-act=history] small')).toHaveCount(0);
    const list=f.locator('.ep-saved-list');
    assert(await list.evaluate(el=>!!(el.compareDocumentPosition(el.ownerDocument.querySelector('[data-act=root-directory]'))&Node.DOCUMENT_POSITION_FOLLOWING)),'已打开现场未排在目录之前');
    await expect(list.locator(`[data-act=focus-float][data-id="${note.id}"]`)).toBeVisible();
    await expect(list.locator(`[data-tab="${reading.id}"]`)).toBeVisible();
    await expect(list.locator(`[data-resume="${oldScene.id}"]`)).toBeVisible();
    await list.locator(`[data-resume="${oldScene.id}"]`).click();await p.waitForTimeout(delay);
    const after=await st();assert.equal(after.scenes.at(-1).members[0],main.id);assert.equal(after.scenes.length,2);assert.deepEqual(after.floating,[note.id]);assert(after.tabs.some(t=>t.id===reading.id));assert(after.windows.some(w=>w.id===other.id));
    await f.locator('[data-act=drawer]').click();await list.locator(`[data-tab="${reading.id}"]`).click();await p.waitForTimeout(delay);
    assert.deepEqual((await st()).floating,[note.id,reading.id]);await expect(f.locator('.ep-drawer')).toBeHidden();
    await f.locator('[data-act=drawer]').click();await list.locator(`[data-act=focus-float][data-id="${note.id}"]`).click();await p.waitForTimeout(delay);
    assert.deepEqual((await st()).floating,[reading.id,note.id]);await expect(f.locator('.ep-drawer')).toBeHidden();
  });

  if(errors.length)failures.push({name:'浏览器运行时错误',message:JSON.stringify(errors)});
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({url,passed:checks.length,checks,failures,errors},null,2));
  console.log(JSON.stringify({passed:checks.length,failed:failures.length,errors:errors.length,out}));
  await browser.close();process.exitCode=failures.length?1:0;
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
