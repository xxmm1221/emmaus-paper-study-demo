const {chromium,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
require('../src/window-model.js');const M=globalThis.EmmausWindows;
const root=path.resolve(__dirname,'..'),out=path.join(root,'.build/density');fs.mkdirSync(out,{recursive:true});
const results=[],errors=[],baseURL=(process.env.DEMO_URL||'http://127.0.0.1:8769/').replace(/\/?$/,'/');
// Density is still compared with the original ca0ef89 version. Typography is
// compared with the last deployed UI: its 18px reading size predates this change.
// Keep the two baselines explicit; neither comparator is the current build.
const baselines={density:'ca0ef89',typography:'627caf85'};
for(const [name,commit] of Object.entries(baselines)){
 const html=require('child_process').execFileSync('git',['show',commit+':index.html'],{cwd:root,maxBuffer:2*1024*1024});
 fs.writeFileSync(path.join(out,name+'-baseline.html'),html);
}
async function visibleControlsFit(pane,width){
 const metrics=await pane.evaluate(n=>{
  const problems=[],actions=n.querySelector('.ep-pane-actions');
  for(const selector of ['.ep-pane-head','.ep-pane-actions']){
   const bar=n.querySelector(selector),bounds=bar.getBoundingClientRect();
   if(bar.scrollWidth>bar.clientWidth+1)problems.push(selector+' horizontal overflow');
   for(const b of bar.querySelectorAll('button')){
    if(!b.checkVisibility({visibilityProperty:true,opacityProperty:true}))continue;
    const r=b.getBoundingClientRect();
    if(r.left<bounds.left-1||r.right>bounds.right+1||r.top<bounds.top-1||r.bottom>bounds.bottom+1)problems.push(b.dataset.act+' clipped');
    if(b.closest('[inert]'))problems.push(b.dataset.act+' visible but inert');
   }
  }
  return{height:actions.clientHeight,problems,contentButtons:[...actions.querySelectorAll('.ep-content-tools button')].filter(b=>b.checkVisibility({visibilityProperty:true,opacityProperty:true})).map(b=>b.dataset.act)};
 });
 assert.deepEqual(metrics.problems,[],width+'px 顶栏不得横向溢出、裁切或呈现不可用的工具');
 assert(metrics.height>=38&&metrics.height<=42,width+'px 常用内容工具应保持 40px 单行：'+metrics.height);
 for(const act of ['prev','next','open-note','open-reference','content-menu'])assert(metrics.contentButtons.includes(act),'选中经文时 '+act+' 应直接可见');
 return metrics;
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  for(const mode of ['single','float','pair']){
   const s=M.fresh();M.openPrimary(s,'reading',{book:43,chapter:3,verse:1});
   if(mode!=='single'){const w=M.openNew(s,'reading',{book:43,chapter:3,verse:1});if(mode==='pair')M.pair(s,w.id);}
   const metrics={};
   for(const version of ['before','typographyBefore','after']){
    const ctx=await browser.newContext({viewport:{width:390,height:800},isMobile:true,hasTouch:true});
    await ctx.addInitScript(raw=>{if(window===window.top)localStorage.setItem('codex:visualization-widget-state-v2:'+JSON.stringify([location.pathname,location.search]),JSON.stringify({privateContent:raw}));},s);
    const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
    await p.route('**/data/bible/*.json',r=>r.fulfill({contentType:'application/json',body:fs.readFileSync(path.join(root,'data/bible',new URL(r.request().url()).pathname.split('/').at(-1)))}));
    await p.goto(baseURL+(version==='before'?'.build/density/density-baseline.html':version==='typographyBefore'?'.build/density/typography-baseline.html':''));
    const f=p.frameLocator('iframe'),pane=f.locator(mode==='float'?'.ep-sheet .ep-pane':'.ep-main .ep-pane').first();
    await expect(pane).toHaveAttribute('data-ready','true');await p.waitForTimeout(600);
    if(version!=='after')await pane.locator('.ep-pane-title').click();
    else if(mode==='float')await f.locator('.ep-sheet .ep-handle').click();
    else {await pane.focus();await pane.press('Enter');}
    await expect(pane).toHaveAttribute('data-tools-visible','true');await p.waitForTimeout(200);
    metrics[version]=await pane.evaluate(n=>{
     const sc=n.querySelector('.ep-scroll'),r=sc.getBoundingClientRect();let lines=0;
     for(const v of sc.querySelectorAll('.ep-verse-words')){const range=document.createRange();range.selectNodeContents(v);for(const rect of range.getClientRects())if(rect.top>=r.top&&rect.bottom<=r.bottom)lines++;}
     const font=getComputedStyle(sc.querySelector('.ep-verse-words'));
     return{bodyHeight:sc.clientHeight,visibleLines:lines,toolHeight:n.querySelector('.ep-pane-actions').clientHeight,fontSize:parseFloat(font.fontSize),lineHeight:parseFloat(font.lineHeight)};
    });
    await p.screenshot({path:path.join(out,mode+'-'+version+'.png')});
    if(version==='after'){
     metrics.widths=[];metrics.widths.push({width:390,...await visibleControlsFit(pane,390)});
     await expect(f.locator('.ep-drawer')).toBeHidden();await expect(pane).toHaveAttribute('data-tools-visible','true');
     // Buttons are reachable in place; horizontal swiping is no longer part of
     // the control contract. Check every displayed control at each real width.
     for(const width of [320,430,844,1280]){
      await p.setViewportSize({width,height:800});await p.waitForTimeout(250);
      assert(await f.locator('.ep-phone').evaluate(n=>n.scrollWidth<=n.clientWidth+1),'页面不能横向溢出');
      metrics.widths.push({width,...await visibleControlsFit(pane,width)});
      await expect(pane.locator('.ep-content-tools [data-act=content-menu]')).toBeVisible();
      await pane.locator('.ep-content-tools [data-act=content-menu]').click();await expect(f.locator('.ep-popover')).toHaveAttribute('data-scope','content');
      await f.locator('[data-act=menu-close]').click({position:{x:20,y:60}});
     }
     await p.emulateMedia({colorScheme:'dark'});await p.screenshot({path:path.join(out,mode+'-dark-wide.png')});
    }
    await ctx.close();
   }
   assert(metrics.after.bodyHeight>metrics.before.bodyHeight,mode+' 正文高度应高于 ca0ef89');
   assert(metrics.after.visibleLines>metrics.before.visibleLines,mode+' 实际可见经文行应增加');
   assert(metrics.after.fontSize>=metrics.typographyBefore.fontSize-.01,mode+' 不得缩小本轮前线上版本 627caf85 的正文字号：'+JSON.stringify(metrics));
   assert(metrics.after.lineHeight>=metrics.typographyBefore.lineHeight-.01,mode+' 不得压缩本轮前线上版本的正文行距');
   assert(metrics.after.lineHeight>=metrics.after.fontSize*1.5,mode+' 行距仍应适合长篇阅读');
   results.push({mode,...metrics});console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({baselines,results,errors},null,2));
 }catch(error){for(const page of browser.contexts().flatMap(c=>c.pages()))await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
