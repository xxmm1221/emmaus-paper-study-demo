(function () {
  'use strict';
  const M = globalThis.EmmausWindows, root = document.getElementById('emmaus-paper-study'), phone = root.querySelector('.ep-phone');
  const q = selector => phone.querySelector(selector), qa = selector => [...phone.querySelectorAll(selector)];
  const books = JSON.parse(root.querySelector('#ep-books').textContent), cache = new Map(), requests = new Map(), panes = new Map();
  const stamp = 'paper-' + Date.now() + '-' + Math.random().toString(36).slice(2), clamp = (n,a,b) => Math.max(a, Math.min(b,n));
  const info = n => books.find(b => b.number === Number(n));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const button = (act,label,name,id,cls='ep-icon') => `<button type="button" class="${cls}" data-act="${act}"${id ? ` data-id="${esc(id)}"` : ''} aria-label="${esc(label)}">${name ? icon(name) : ''}${cls === 'ep-text' ? esc(label) : ''}</button>`;
  const title = w => w?.kind === 'reading' ? `${info(M.page(w)?.book)?.name || '读经'} ${M.page(w)?.chapter || ''}` : w?.kind === 'note' ? (state.notes[w.contentId]?.text.split('\n').find(t => t.trim())?.replace(/^>\s*/, '').slice(0,18) || '研读笔记') : w?.citation?.book === 45 && w.citation.chapter === 8 && [28,29].includes(w.citation.verse) ? '益处，不止于顺境' : `${info(w?.citation?.book)?.name || '经文'} ${w?.citation?.chapter || ''}${w?.citation?.verse ? ':'+w.citation.verse : ''} · 研读`;
  const sceneTitle = scene => scene.members.map(id => title(M.get(state,id))).join(' · ');
  let state, drawerOpen = false, directory = null, rootCatalog = {book:null,testament:'旧约'}, directorySerial = 0, requestId = 0;
  let menuTarget = null, selection = null, toastTimer, saveTimer, noteTimer, saveSerial = 0, historyFilter = 'all', historyLimit = 50, gesture = null, ignoreClickUntil = 0, lastModalFocus = null;
  const dirtyNotes = new Set();

  function icons() { globalThis.lucide?.createIcons({root:phone,attrs:{width:18,height:18}}); }
  function announce(message) { q('.ep-toast').textContent = message; q('.ep-toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => q('.ep-toast').hidden = true, 2300); }
  function loadBook(number) {
    if (cache.has(number)) return Promise.resolve(cache.get(number));
    if (requests.has(number)) return requests.get(number);
    if (!info(number)) return Promise.reject(Error('书卷不存在'));
    const promise = new Promise((resolve,reject) => {
      const id = stamp + '-book-' + ++requestId;
      const receive = event => {
        if (event.source !== parent || event.data?.type !== 'emmaus-bible-response' || event.data.id !== id) return;
        clearTimeout(timer); window.removeEventListener('message', receive);
        const data = event.data.data;
        if (data?.number !== number || !Array.isArray(data.chapters) || data.chapters.length !== info(number).chapterCount) { reject(Error('经文暂未载入，请重试')); return; }
        cache.set(number,data); resolve(data);
      };
      const timer = setTimeout(() => { window.removeEventListener('message',receive); reject(Error('经文加载超时，请重试')); },20000);
      window.addEventListener('message',receive); parent.postMessage({type:'emmaus-bible-request',id,book:number},'*');
    }).finally(() => requests.delete(number));
    requests.set(number,promise); return promise;
  }
  function capture() {
    panes.forEach((node,id) => {
      if (!node.isConnected || !node.getClientRects().length || node._restoring || node.dataset.ready !== 'true') return;
      const w = M.get(state,id), scroll = node.querySelector(w.kind === 'note' ? 'textarea' : '.ep-scroll');
      if (w.kind === 'reading') {
        const p = M.page(w); p.scroll = scroll.scrollTop;
        const r = scroll.getBoundingClientRect(), verse = [...scroll.querySelectorAll('.ep-verse')].find(v => v.getBoundingClientRect().bottom > r.top + 8);
        if (verse) p.anchor = {verse:Number(verse.dataset.verse),offset:verse.getBoundingClientRect().top - r.top};
      } else { if (!scroll.hidden) w.scroll = scroll.scrollTop; if (w.kind === 'note') w.outerScroll = node.querySelector('.ep-scroll').scrollTop; }
    });
  }
  function flushNotes() { clearTimeout(noteTimer); for (const id of dirtyNotes) M.commitNote(state,id); dirtyNotes.clear(); }
  function persist(captureNow = true) {
    clearTimeout(saveTimer); if (captureNow) capture();
    if (state.recoveryOriginal) { q('.ep-storage-error').hidden = false; return; }
    const serial = ++saveSerial;
    try {
      M.assert(state);
      const snapshot = M.copy(state); snapshot.sender = stamp;
      const saved = window.openai?.setWidgetState({modelContent:{design:'纸间研读',main:M.top(state)?.members.length || 0,floating:state.floating.length,tabs:state.tabs.length,history:state.events.length},privateContent:snapshot});
      if (!saved) throw Error('本地保存不可用');
      Promise.resolve(saved).then(() => { if (serial === saveSerial) q('.ep-storage-error').hidden = true; },() => { if (serial === saveSerial) q('.ep-storage-error').hidden = false; });
    } catch (_) { q('.ep-storage-error').hidden = false; }
  }
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist,220); };
  let motionOrigin = null, drawerTimer;
  // Focus/chrome are transient UI state, never another persisted window mode.
  let activeWindowId = null, toolsVisible = false;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const windowMotions = new Set();
  const snapshotProperties = ('display position inset top right bottom left z-index box-sizing width height min-width min-height max-width max-height margin padding border border-radius background background-color background-image color box-shadow overflow overflow-x overflow-y opacity visibility font font-family font-size font-weight font-style line-height letter-spacing text-align text-indent text-decoration white-space word-break overflow-wrap vertical-align flex flex-direction flex-wrap align-items align-self justify-content gap grid-template-columns grid-template-rows transform transform-origin object-fit appearance mask-image').split(' ');
  // Freeze the source appearance before reparenting: inherited colors, typography,
  // scroll offsets and textarea content must travel with the original object.
  function freezeSurface(node) {
    const clone = node.cloneNode(true), scrolls = [];
    const originals = [node,...node.querySelectorAll('*')], copies = [clone,...clone.querySelectorAll('*')];
    originals.forEach((source,index) => {
      const copy = copies[index], css = getComputedStyle(source);
      for (const name of snapshotProperties) copy.style.setProperty(name,css.getPropertyValue(name));
      copy.style.setProperty('transition','none','important'); copy.style.setProperty('animation','none','important');
      for (const attr of [...copy.attributes]) if (attr.name === 'id' || attr.name === 'class' || attr.name.startsWith('data-')) copy.removeAttribute(attr.name);
      if (source instanceof HTMLTextAreaElement) copy.value = source.value;
      if (source.scrollTop || source.scrollLeft) scrolls.push([copy,source.scrollTop,source.scrollLeft]);
    });
    Object.assign(clone.style,{position:'absolute',inset:'0 auto auto 0',margin:'0',transform:'none',visibility:'visible',opacity:'1',borderRadius:'0',boxShadow:'none',border:'0',background:'transparent'});
    return {clone,restore:() => scrolls.forEach(([n,y,x]) => { n.scrollTop=y; n.scrollLeft=x; })};
  }
  function surfaces() {
    const result = new Map();
    qa('.ep-main .ep-pane,.ep-sheet,.ep-tabs .ep-tab').forEach(node => {
      const id = node.dataset.windowId || node.dataset.tab;
      if (id) result.set(id,{node,placement:node.closest('.ep-main') ? 'main' : node.classList.contains('ep-sheet') ? 'float' : 'tab',rect:node.getBoundingClientRect(),radius:getComputedStyle(node).borderRadius,shadow:getComputedStyle(node).boxShadow});
    });
    return result;
  }
  function finishWindowMotions() { for (const finish of [...windowMotions]) finish(); }
  function flySurface(from, to, source, destination, target, id, retiring=false) {
    const bounds = phone.getBoundingClientRect(), shell = document.createElement('div');
    shell.dataset.motionGhost = id; shell.setAttribute('aria-hidden','true'); shell.inert = true;
    Object.assign(shell.style,{position:'absolute',left:from.left-bounds.left-phone.clientLeft+'px',top:from.top-bounds.top-phone.clientTop+'px',width:from.width+'px',height:from.height+'px',overflow:'hidden',pointerEvents:'none',zIndex:((source?.placement==='main' && (!destination || destination.placement==='main')) || (!source && destination?.placement==='main')) ? 4 : retiring?6:12,background:'var(--paper)',boxShadow:source?.shadow || 'none',borderRadius:source?.radius || '20px',transformOrigin:'0 0'});
    const oldLayer = source?.frozen, newLayer = destination?.frozen;
    if (oldLayer) shell.append(oldLayer.clone);
    if (newLayer) shell.append(newLayer.clone);
    phone.append(shell); oldLayer?.restore(); newLayer?.restore();
    const previousVisibility = target?.style.visibility;
    if (target) target.style.visibility = 'hidden';
    const duration = 540, easing = 'cubic-bezier(.32,0,.2,1)', animations = [];
    const run = (node,frames,timing=easing) => { const a = node.animate(frames,{duration,easing:timing,fill:'both'}); animations.push(a); return a; };
    // Geometry moves throughout; the original content remains legible until the
    // object reaches its destination. No early dissolve / target-style flash.
    const flight = run(shell,[{transform:'translate(0px,0px)',width:from.width+'px',height:from.height+'px',borderRadius:source?.radius || '20px',opacity:1},{transform:`translate(${to.left-from.left}px,${to.top-from.top}px)`,width:to.width+'px',height:to.height+'px',borderRadius:destination?.radius || '20px',opacity:retiring?0:1}]);
    if (oldLayer) run(oldLayer.clone,[{transform:'scale(1,1)',transformOrigin:'0 0',offset:0},{transform:`scale(${to.width/from.width})`,transformOrigin:'0 0',offset:1}]);
    // Keep source opaque for most of the journey; appearance changes only at arrival.
    if (oldLayer && newLayer) {
      run(oldLayer.clone,[{opacity:1,offset:0},{opacity:1,offset:.72},{opacity:0,offset:1}],'linear');
      run(newLayer.clone,[{opacity:0,offset:0},{opacity:0,offset:.72},{opacity:1,offset:1}],'linear');
    }
    if (newLayer) run(newLayer.clone,[{transform:`scale(${from.width/to.width})`,transformOrigin:'0 0'},{transform:'scale(1,1)',transformOrigin:'0 0'}]);
    let cleaned = false;
    const finish = () => {
      if (cleaned) return; cleaned = true;
      animations.forEach(a=>a.cancel()); shell.remove();
      if (target) target.style.visibility = previousVisibility;
      windowMotions.delete(finish);
    };
    windowMotions.add(finish); flight.finished.then(finish,finish);
  }
  function animateWindows(before, origin) {
    if (reduceMotion()) return;
    const after = surfaces();
    // Freeze all destinations before hiding any ancestor/child.
    after.forEach(item => { item.frozen = freezeSurface(item.node); });
    after.forEach((item,id) => {
      const previous = before.get(id), from = previous?.rect || origin, to = item.rect;
      if (!from || !to.width || !to.height) return;
      if (previous && Math.abs(from.left-to.left)+Math.abs(from.top-to.top)+Math.abs(from.width-to.width)+Math.abs(from.height-to.height)<1) return;
      flySurface(from,to,previous,item,item.node,id);
    });
    before.forEach((item,id) => {
      if (after.has(id)) return;
      // A covered scene goes behind the incoming window, not into an unrelated
      // corner. Closed windows leave toward the lower edge.
      const retained = state.scenes.some(s=>s.members.includes(id));
      const to = {...item.rect,left:item.rect.left-(retained?24:0),top:item.rect.top+(retained?0:60),width:item.rect.width,height:item.rect.height};
      flySurface(item.rect,to,item,null,null,id,true);
    });
  }
  let pendingCapacity = null, capacityFocus = null;
  function closeCapacity() {
    q('.ep-capacity').hidden = true; pendingCapacity = null; updateInert();
    if (capacityFocus?.isConnected) capacityFocus.focus({preventScroll:true});
  }
  function showCapacity(error, callback, origin) {
    closeMenu(); capacityFocus = document.activeElement;
    pendingCapacity = {callback,origin}; const isFloat = error.code === 'FLOAT_LIMIT';
    const ids = isFloat ? [...state.floating].reverse() : state.tabs.map(t=>t.id);
    q('.ep-capacity').innerHTML = `<div class="ep-capacity-card"><span class="ep-kicker">保留你的阅读现场</span><h2>${isFloat ? '已有两个浮窗' : '三个标签已满'}</h2><p>${isFloat ? '旧浮窗不会被自动替换。选择一个收起或关闭，再继续刚才的操作。' : '标签不会自动回收。关闭一个标签，再继续收起当前窗口。'}</p><div class="ep-capacity-list">${ids.map(id=>`<article><strong>${esc(title(M.get(state,id)))}</strong><div>${isFloat && state.tabs.length<3 ? button('capacity-minimize','收为标签并继续','minus',id,'ep-text') : ''}${button('capacity-close',isFloat ? '关闭浮窗并继续' : '关闭标签并继续','x',id,'ep-text')}</div></article>`).join('')}</div><small>${isFloat && state.tabs.length>=3 ? '标签也已满；如需保留窗口，可取消后将一个浮窗最大化。' : '关闭只移除窗口入口，笔记与阅读记录仍留在历史中。'}</small>${button('capacity-cancel','取消，保持原样',null,null,'ep-text')}</div>`;
    q('.ep-capacity').hidden = false; icons(); updateInert();
    q('[data-act="capacity-cancel"]').focus({preventScroll:true});
  }
  function change(callback, origin = motionOrigin) {
    finishWindowMotions(); capture(); flushNotes();
    // Execute against a draft: rejection never changes placement, creates phantom
    // notes, loses the selected verse, or leaves a half-completed compound action.
    const previous = state; state = M.copy(state);
    try { callback(); M.assert(state); }
    catch (error) {
      state = previous;
      if (['FLOAT_LIMIT','TAB_LIMIT'].includes(error.code)) { showCapacity(error,callback,origin); return false; }
      throw error;
    }
    const before = surfaces();
    if (!reduceMotion()) before.forEach(item => { item.frozen = freezeSurface(item.node); });
    const newFloat=state.floating.find(id=>!previous.floating.includes(id));
    const nextMain=M.top(state), changedMain=nextMain?.id!==M.top(previous)?.id;
    if(newFloat) { activeWindowId=newFloat; toolsVisible=false; }
    else if(changedMain && nextMain && !nextMain.members.includes(activeWindowId)) { activeWindowId=nextMain.members[0]; toolsVisible=false; }
    selection = null; closeMenu(); render();
    panes.forEach((node,id) => { if(node.isConnected && node.dataset.ready==='true') restorePosition(node,M.get(state,id)); });
    animateWindows(before,origin); persist(false); return true;
  }
  let hostViewportBottom = Infinity;
  const wideLayout=()=>phone.clientWidth>=700;
  const unpairLabel=()=>wideLayout()?'拆除对读，左窗置顶':'拆除对读，上窗置顶';
  function pairMetrics(scene=M.top(state)) {
    const wide=wideLayout(), body=q('.ep-scene-body');
    const span=Math.max(1,(wide?body?.clientWidth:body?.clientHeight)-27 || 1);
    const min=wide?Math.max(.25,Math.min(.5,320/span)):.25;
    return {wide,span,min,max:1-min,ratio:clamp(scene?.ratio || .5,min,1-min)};
  }
  function layoutPair() {
    const wide=wideLayout(); phone.classList.toggle('is-wide',wide);
    const scene=M.top(state), body=q('.ep-scene-body'); if(!scene || !body) return;
    const paired=scene.members.length===2;
    q('.ep-scene-head>span').textContent=paired ? wide?'左右对读':'上下对读' : 'EMMAUS';
    if(!paired) return;
    const {ratio}=pairMetrics(scene), tracks=`minmax(0,${ratio}fr) 27px minmax(0,${1-ratio}fr)`;
    body.style.gridTemplateColumns=wide?tracks:'minmax(0,1fr)';
    body.style.gridTemplateRows=wide?'minmax(0,1fr)':tracks;
    const divider=q('.ep-divider'), label=wide?'交换左右窗口':'交换上下窗口';
    divider.setAttribute('aria-label',label);
    divider.setAttribute('aria-description',wide?'点按交换；左右拖动或方向键调整宽度比例':'点按交换；上下拖动或方向键调整高度比例');
    divider.title=wide?'点按交换左右窗口 · 拖动调宽度':'点按交换上下窗口 · 拖动调高度';
    divider.dataset.axis=wide?'x':'y'; divider.dataset.ratio=String(ratio);
    qa('.ep-scene-actions [data-act="unpair"]').forEach(b=>{ b.setAttribute('aria-label',unpairLabel()); b.title=unpairLabel(); });
  }
  function resizeViewport() {
    finishWindowMotions(); capture();
    if(gesture) { if(gesture.mode) endGesture({pointerId:gesture.pointer},true); else gesture=null; }
    if(phone.classList.contains('is-wide')!==wideLayout()) closeMenu();
    layoutPair(); layoutFloats();
    panes.forEach((node,id)=>{if(node.isConnected && node.dataset.ready==='true')restorePosition(node,M.get(state,id));});
  }
  function floatGeometry(w) {
    const h = phone.clientHeight, available = Math.max(100,Math.min(h,window.visualViewport?.height || h,hostViewportBottom-phone.getBoundingClientRect().top));
    const topInset = Math.max(12,parseFloat(getComputedStyle(phone).getPropertyValue('--safe-top')) || 0);
    const bottomInset = Math.max(12,parseFloat(getComputedStyle(phone).getPropertyValue('--safe-bottom')) || 0);
    const height = clamp((w.height || .4)*h,Math.min(205,available-topInset-bottomInset),available-topInset-bottomInset);
    return {height,top:clamp((w.floatTop ?? .98-w.height)*h,topInset,available-bottomInset-height),available,topInset,bottomInset};
  }
  function layoutFloats() {
    let reserve = 100;
    qa('.ep-sheet').forEach(sheet=>{
      const w=M.get(state,sheet.dataset.windowId); if(!w) return;
      const g=floatGeometry(w); sheet.style.top=g.top+'px'; sheet.style.height=g.height+'px';
      sheet.style.zIndex=String(state.floating.indexOf(w.id)+1);
      sheet.dataset.front=String(state.floating.at(-1)===w.id);
      reserve=Math.max(reserve,phone.clientHeight-g.top+30);
    });
    q('.ep-main').style.setProperty('--floating-space',reserve+'px');
  }
  function raiseFloat(id) { M.raise(state,id); layoutFloats(); scheduleSave(); }

  function syncChrome() {
    const visible=[...(M.top(state)?.members || []),...state.floating];
    if(!visible.includes(activeWindowId)) { activeWindowId=null; toolsVisible=false; }
    panes.forEach((node,id)=>{
      const active=id===activeWindowId, revealed=active && toolsVisible;
      node.classList.toggle('is-active',active); node.classList.toggle('is-quiet',!revealed);
      node.dataset.toolsVisible=String(revealed);
      node.querySelectorAll('.ep-window-shortcuts,.ep-content-tools').forEach(n=>n.inert=!revealed);
      const sheet=node.closest('.ep-sheet');
      if(sheet) { sheet.classList.toggle('is-quiet',!revealed); sheet.classList.toggle('is-active',active); sheet.querySelector('.ep-window-shortcuts').inert=!revealed; }
    });
    const scene=M.top(state), shown=toolsVisible && scene?.members.includes(activeWindowId);
    const sceneActions=q('.ep-scene-actions'); if(sceneActions) { sceneActions.inert=!shown; sceneActions.classList.toggle('is-hidden',!shown); }
    phone.dataset.activeWindow=activeWindowId || '';
  }
  function activateWindow(id, reveal=true) {
    if(!M.get(state,id)) return;
    if(activeWindowId!==id) { closeMenu(); activeWindowId=id; toolsVisible=false; }
    if(state.floating.includes(id)) raiseFloat(id);
    if(reveal) toolsVisible=true;
    syncChrome();
  }
  function hideTools() { toolsVisible=false; closeMenu(); syncChrome(); }
  function setQuiet(node,quiet) { if(quiet) { if(node.dataset.windowId===activeWindowId) hideTools(); } else activateWindow(node.dataset.windowId); }
  function watchScroll(node,scroll) {
    let inputUntil=0, touchStart=null;
    scroll._resetQuiet=()=>{};
    const begin=()=>{ inputUntil=performance.now()+1500; if(node.dataset.windowId!==activeWindowId) activateWindow(node.dataset.windowId,false); hideTools(); };
    scroll.addEventListener('wheel',begin,{passive:true});
    scroll.addEventListener('touchstart',e=>{const t=e.touches[0];touchStart=t && {x:t.clientX,y:t.clientY};},{passive:true});
    scroll.addEventListener('touchmove',e=>{ const t=e.touches[0]; if(t && touchStart && Math.abs(t.clientY-touchStart.y)>9 && Math.abs(t.clientY-touchStart.y)>Math.abs(t.clientX-touchStart.x)*1.25) begin(); },{passive:true});
    scroll.addEventListener('keydown',e=>{if(e.target instanceof HTMLTextAreaElement || e.target.isContentEditable)return;if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(e.key))begin();});
    scroll.addEventListener('scroll',()=>{
      // Programmatic anchor restoration must not count as a reading gesture.
      if(node.dataset.ready==='true' && performance.now()>(node._suppressUntil||0) && performance.now()<inputUntil && node.dataset.windowId===activeWindowId && toolsVisible) hideTools();
      scheduleSave();
    },{passive:true});
  }
  function windowActions(id) {
    const scene=M.top(state), floating=state.floating.includes(id), paired=scene?.members.length===2 && scene.members.includes(id);
    const actions=floating ? [
      {act:'pair',label:'对读',icon:'rows-2',disabled:!scene || scene.members.length!==1},
      {act:'promote',label:'最大化',icon:'maximize-2'},
      {act:'minimize',label:'收为悬浮标签',icon:'minus'},
    ] : [...(paired ? [{act:'promote',label:'最大化此窗口',icon:'maximize-2'}] : []),{act:'move-float',label:paired?'移出对读，转为浮窗':'转为浮窗',icon:'panel-bottom'}];
    actions.push({act:'pin',label:'复制为浮窗',icon:'copy'});
    if(floating) for(const other of state.floating.filter(x=>x!==id)) actions.push({act:'raise-float',id:other,label:'切换到：'+title(M.get(state,other)),icon:'layers'});
    actions.push({act:'close-window',label:'关闭窗口',icon:'x'});
    return actions.map(a=>({id,...a}));
  }
  function contentActions(w) {
    if(w.kind==='reading') {
      const p=M.page(w), selected=!!citation(w.id)?.verse;
      return [
        {act:'prev',label:'上一章',icon:'chevron-left',disabled:p.book===1 && p.chapter===1},
        {act:'next',label:'下一章',icon:'chevron-right',disabled:p.book===66 && p.chapter===22},
        {act:'back',label:'浏览历史后退',icon:'undo-2',disabled:w.pageIndex===0},
        {act:'forward',label:'浏览历史前进',icon:'redo-2',disabled:w.pageIndex===w.pages.length-1},
        {act:'open-note',label:selected?'为选中经文记笔记':'记笔记（请先选中经文）',icon:'pen-line',disabled:!selected},
        {act:'open-reference',label:selected?'研读选中经文':'研读（请先选中经文）',icon:'book-open',disabled:!selected},
      ].map(a=>({id:w.id,...a}));
    }
    if(w.kind==='note') return [{act:'note-edit',label:panes.get(w.id)?.dataset.editing==='true'?'完成编辑':'编辑笔记',icon:panes.get(w.id)?.dataset.editing==='true'?'check':'pen-line',id:w.id}];
    return [{act:'reference-reading',label:'查看引用经文',icon:'book-open',disabled:!w.citation?.book},{act:'open-note',label:'为引用经文记笔记',icon:'pen-line',disabled:!w.citation?.verse}].map(a=>({id:w.id,...a}));
  }
  function actionButtons(actions, compact=true) {
    return actions.map(a=>button(a.act,a.label,a.icon,a.id,compact?'ep-icon':'ep-text').replace('<button ',`<button title="${esc(a.label)}"${a.disabled?' disabled':''} `)).join('');
  }
  function windowShortcuts(id) { return `<div class="ep-window-shortcuts" role="group" aria-label="窗口操作">${actionButtons(windowActions(id))}${button('pane-menu','窗口操作菜单','ellipsis',id)}</div>`; }
  function restorePosition(node,w) {
    node._suppressUntil = performance.now() + 400;
    const scroll = node.querySelector(w.kind === 'note' ? 'textarea' : '.ep-scroll');
    if (w.kind === 'reading') {
      const p = M.page(w); scroll.scrollTop = p.scroll || 0;
      const verse = node.querySelector(`[data-verse="${p.anchor?.verse || p.selected}"]`);
      if (verse && (p.anchor || (!p.scroll && p.selected))) scroll.scrollTop += verse.getBoundingClientRect().top - scroll.getBoundingClientRect().top - (p.anchor?.offset ?? 12);
    } else { scroll.scrollTop = w.scroll || 0; if (w.kind === 'note') node.querySelector('.ep-scroll').scrollTop = w.outerScroll || 0; }
    scroll._resetQuiet?.();
    node._restoring = false;
  }
  function paneActions(node,w) {
    const actions=node.querySelector('.ep-pane-actions'), c=w.kind==='reading' && citation(w.id);
    actions.hidden=false;
    actions.innerHTML=`<span class="ep-content-context">${w.kind==='reading' ? c?.verse ? c.chapter+':'+c.verse : '经文' : w.kind==='note' ? '笔记' : '研读'}</span>${actionButtons(contentActions(w))}${button('content-menu',w.kind==='reading'?'经文操作菜单':w.kind==='note'?'笔记操作菜单':'研读操作菜单','ellipsis-vertical',w.id)}`;
    actions.setAttribute('aria-label',w.kind==='reading'?'经文操作':w.kind==='note'?'笔记操作':'研读操作');
    syncChrome();
  }
  function renderNote(node,w) {
    const preview = node.querySelector('.ep-note-preview'); if (!preview) return;
    const text = state.notes[w.contentId].text, refs = globalThis.EmmausReferences.parse(text,books);
    let html = '', offset = 0;
    for (const r of refs) {
      html += esc(text.slice(offset,r.start)) + `<button type="button" class="ep-scripture-link" data-act="note-scripture" data-id="${esc(w.id)}" data-book="${r.book}" data-chapter="${r.chapter}" data-first="${r.verse || ''}" data-last="${r.endVerse || ''}" aria-label="打开经文浮窗：${esc(r.label)}">${esc(r.label)}</button>`;
      offset = r.end;
    }
    preview.innerHTML = html + esc(text.slice(offset)) || '<span class="ep-note-placeholder">暂无正文，点击“编辑笔记”开始记录。</span>';
    const editing = node.dataset.editing === 'true';
    preview.hidden = editing; node.querySelector('textarea').hidden = !editing;
    paneActions(node,w);
    node.querySelectorAll('[data-act="note-edit"]').forEach(toggle=>toggle.setAttribute('aria-pressed',String(editing)));
  }
  let referenceRequest = 0;
  async function openNoteScripture(b) {
    const id=b.dataset.id, w=M.get(state,id), origin=b.getBoundingClientRect(), token=++referenceRequest;
    const book=Number(b.dataset.book), chapter=Number(b.dataset.chapter), verse=Number(b.dataset.first)||null, endVerse=Number(b.dataset.last)||verse;
    const originalText = w?.kind === 'note' && state.notes[w.contentId].text;
    if (w?.kind !== 'note' || !info(book) || chapter<1 || chapter>info(book).chapterCount) return;
    try {
      const data = await loadBook(book), verses=data.chapters[chapter-1];
      if(token!==referenceRequest || !b.isConnected || state.notes[w.contentId].text!==originalText) return;
      if(verse && (!verses.some(v=>v[0]===verse)||!verses.some(v=>v[0]===endVerse))) { announce('引用的节号不存在，请检查笔记'); return; }
      const sourceScene=M.top(state)?.members.includes(id) ? M.top(state) : null;
      change(()=>{ M.openNew(state,'reading',{book,chapter,verse,sourceWindowId:id,citation:{book,chapter,verse,sourceNoteId:id}}); if(sourceScene && M.top(state)?.id!==sourceScene.id) M.resume(state,sourceScene.id); },origin);
    } catch (_) { announce('经文暂未载入，请再点一次引用'); }
  }
  function ensurePane(w) {
    let node = panes.get(w.id);
    if (!node) {
      node = document.createElement('section'); node.className = 'ep-pane is-quiet'; node.tabIndex=0; node.dataset.windowId = w.id; node.setAttribute('aria-label',title(w));
      node.innerHTML = '<header class="ep-pane-head"></header><div class="ep-pane-actions ep-content-tools" role="group"></div><div class="ep-scroll"></div>';
      panes.set(w.id,node); watchScroll(node,node.querySelector('.ep-scroll'));
    }
    const header = node.querySelector('.ep-pane-head'), float = state.floating.includes(w.id);
    node.setAttribute('aria-label',title(w));
    header.innerHTML = `<button class="ep-pane-title" data-act="${w.kind === 'reading' ? 'reading-directory' : 'activate'}" data-id="${esc(w.id)}" aria-label="${w.kind === 'reading' ? '选择书卷和章节' : '显示窗口工具'}"><span data-reading-title>${esc(title(w))}</span>${w.kind === 'reading' ? icon('chevron-down') : ''}</button>` + (!float ? windowShortcuts(w.id) : '');
    const scroll = node.querySelector('.ep-scroll');
    if (w.kind === 'reading') {
      const p = M.page(w), key = `${p.book}:${p.chapter}`;
      if (node.dataset.page !== key || node.dataset.ready !== 'true') {
        node.dataset.page = key; node.dataset.ready = 'loading'; scroll.className = 'ep-scroll ep-reading-scroll';
        scroll.innerHTML = '<p class="ep-empty">经文正在展开…</p>';
        loadBook(p.book).then(data => {
          const current=M.get(state,w.id), currentPage=M.page(current);
          if (node.dataset.page !== key || currentPage?.book !== p.book || currentPage?.chapter !== p.chapter) return;
          const verses = data.chapters[p.chapter-1]; if (!Array.isArray(verses) || !verses.length) throw Error('这一章未载入');
          scroll.innerHTML = `<div class="ep-chapter-cover"><span class="ep-chapter-number">${String(p.chapter).padStart(2,'0')}</span><div><span class="ep-kicker">${esc(info(p.book).name)} · 和合本</span><h1>${p.book === 45 && p.chapter === 8 ? '在盼望中等候' : `第 ${p.chapter} 章`}</h1></div></div>` + verses.map(([n,words]) => `<button type="button" class="ep-verse${currentPage.selected === n ? ' is-selected' : ''}" data-verse="${n}" data-id="${esc(w.id)}" aria-label="${esc(info(p.book).name)} ${p.chapter}:${n}，选择经文" aria-pressed="${currentPage.selected === n}"><span class="ep-verse-number">${n}</span><span class="ep-verse-words">${esc(words)}</span></button>`).join('') + '<footer class="ep-reading-footer"><span>和合本</span></footer>';
          node.dataset.ready = 'true'; requestAnimationFrame(() => restorePosition(node,M.get(state,w.id))); icons();
        }).catch(() => { if (node.dataset.page === key) { node.dataset.ready = 'error'; scroll.innerHTML = `<p class="ep-empty">经文暂未载入。${button('retry','点击重试','rotate-cw',w.id,'ep-text')}</p>`; icons(); } });
      }
    } else if (!node.dataset.ready) {
      node.dataset.ready = 'true';
      if (w.kind === 'note') {
        scroll.className = 'ep-scroll ep-note'; scroll.innerHTML = '<div class="ep-note-heading"><span class="ep-kicker">个人笔记</span></div><div class="ep-note-preview" aria-label="笔记阅读正文"></div><textarea hidden aria-label="研读笔记正文" placeholder="此刻，你读到了什么？"></textarea><small class="ep-note-status">自动保存 · 保留编辑版本</small>';
        const area = scroll.querySelector('textarea'); area.value = state.notes[w.contentId].text; watchScroll(node,area);
        area.addEventListener('input',() => {
          state.notes[w.contentId].text = area.value; dirtyNotes.add(w.contentId);
          panes.forEach((other,id) => { if (id !== w.id && M.get(state,id)?.contentId === w.contentId) { const a = other.querySelector('textarea'); if (a && a.value !== area.value) a.value = area.value; renderNote(other,M.get(state,id)); } });
          clearTimeout(noteTimer); noteTimer = setTimeout(() => { flushNotes(); persist(); },650); scheduleSave();
        });
        area.addEventListener('blur',() => { flushNotes(); persist(); });
      } else {
        const c=w.citation, supported=c?.book===45 && c.chapter===8 && [28,29].includes(c.verse);
        scroll.className = 'ep-scroll ep-reference';
        if (!supported) scroll.innerHTML = `<span class="ep-kicker">研读 · ${esc(info(c?.book)?.name)} ${c?.chapter || ''}:${c?.verse || ''}</span><h2>经文研读</h2><p>${esc(c?.words || '')}</p><p class="ep-empty">本节暂无已接入的研读资料。</p><small class="ep-source-credit">当前为交互原型，不生成或套用其他经文的注释。</small>`;
        else scroll.innerHTML = `<span class="ep-kicker">研读札记 · 罗马书 8:${c.verse}</span><h2>益处，不止于顺境。</h2><p class="ep-lead">“万事互相效力”，不是说每一件事本身都是好的。</p><p>把目光放到下一节：“效法他儿子的模样”。保罗所说的益处，也关乎我们在经历中，逐渐成为怎样的人。</p><div class="ep-thought"><span class="ep-kicker">带着这个问题，再读一遍</span><p>我盼望的，是处境改变，<br>还是生命也被更新？</p></div><small class="ep-source-credit">原创演示札记；仅适用于罗马书 8:28–29，不冒充其他经节的注释。</small>`;
      }
    }
    if (w.kind === 'note') renderNote(node,w);
    paneActions(node,w); return node;
  }
  function render() {
    panes.forEach(node => node._restoring = true);
    const scene = M.top(state), main = q('.ep-main'), slot = q('.ep-float-slot');
    main.replaceChildren();
    if (!scene) renderDirectory(main,rootCatalog,true);
    else {
      const wrap = document.createElement('div'); wrap.className = 'ep-main-scene' + (scene.members.length === 2 ? ' ep-paired' : ''); wrap.dataset.sceneId = scene.id;
      wrap.innerHTML = `<header class="ep-scene-head">${button('drawer','打开后台','panel-left')}<span>${scene.members.length === 2 ? '上下对读' : 'EMMAUS'}</span>${scene.members.length === 2 ? `<div class="ep-scene-actions" role="group" aria-label="对读组合操作">${button('unpair',unpairLabel(),'rows-2',scene.id)}${button('close-scene','关闭整个组合','x',scene.id)}${button('scene-menu','组合操作菜单','ellipsis',scene.id)}</div>` : ''}</header><div class="ep-scene-body"></div>`;
      const body = wrap.querySelector('.ep-scene-body');
      scene.members.forEach((id,index) => { if (index) { const div = document.createElement('button'); div.type = 'button'; div.className = 'ep-divider'; div.dataset.scene = scene.id; div.dataset.act='swap-pair'; div.dataset.id=scene.id; div.innerHTML = '<span></span>'; body.append(div); } body.append(ensurePane(M.get(state,id))); });
      main.append(wrap);
    }
    for (const sheet of [...slot.children]) if (!state.floating.includes(sheet.dataset.windowId)) sheet.remove();
    for (const id of state.floating) {
      const w=M.get(state,id);
      let sheet = [...slot.children].find(n=>n.dataset.windowId===id);
      if (!sheet) { sheet = document.createElement('article'); sheet.className = 'ep-sheet'; sheet.dataset.windowId = id; sheet.dataset.presentation = 'floating'; slot.append(sheet); }
      sheet.setAttribute('aria-label','浮窗：'+title(w));
      let bar = sheet.querySelector('.ep-sheet-bar'); if (!bar) { bar = document.createElement('header'); bar.className = 'ep-sheet-bar'; sheet.prepend(bar); }
      bar.innerHTML = `<button class="ep-handle" data-id="${esc(id)}" aria-label="上下移动浮窗" title="拖动上下移动，点按显示工具" type="button"><span class="ep-handle-mark" aria-hidden="true"></span><span class="ep-window-kind">${w.kind === 'reading' ? '经文' : w.kind === 'note' ? '笔记' : '研读'}</span></button>` + windowShortcuts(id);
      bar.insertAdjacentHTML('beforeend','<span class="ep-sheet-rule" aria-hidden="true"></span>');
      sheet.querySelector('.ep-resize')?.remove();
      sheet.append(ensurePane(w));
      sheet.insertAdjacentHTML('beforeend',`<button class="ep-resize" data-id="${esc(id)}" aria-label="调整浮窗高度" title="拖动下边缘调整高度" type="button"><span></span></button>`);
    }
    layoutPair(); layoutFloats();
    q('.ep-tabs').innerHTML = state.tabs.map(t => { const w = M.get(state,t.id); return `<div class="ep-tab-item"><button class="ep-tab" data-tab="${esc(t.id)}" aria-label="以浮窗打开：${esc(title(w))}">${icon(w.kind === 'note' ? 'notebook-pen' : 'book-open')}<span>${esc(title(w))}</span></button>${button('close-window','关闭标签：'+title(w),'x',t.id,'ep-icon ep-tab-close')}</div>`; }).join('');
    renderSaved(); icons(); updateInert(); syncChrome();
    requestAnimationFrame(() => panes.forEach((node,id) => { if (node.isConnected && node.dataset.ready === 'true') restorePosition(node,M.get(state,id)); }));
  }
  function renderSaved() {
    q('[data-saved-count]').textContent = state.scenes.length;
    q('.ep-saved-list').innerHTML = [...state.scenes].reverse().map(scene => `<button class="ep-nav-row${scene === M.top(state) ? ' is-current' : ''}" data-resume="${esc(scene.id)}">${icon(scene.members.length === 2 ? 'rows-2' : 'book-open')}<span>${esc(sceneTitle(scene))}<small>${scene === M.top(state) ? '当前阅读' : '点按最大化继续'}${scene.members.length === 2 ? ' · 双窗' : ''}</small></span></button>`).join('') || '<p class="ep-empty">留下的阅读现场，会在这里继续。</p>';
  }
  function closeMenu() { menuTarget = null; q('.ep-popover').hidden = q('.ep-menu-scrim').hidden = true; }
  function menu(id,anchor,isScene=false,isContent=false) {
    closeMenu(); menuTarget = id; const panel=q('.ep-popover'), w=M.get(state,id);
    const label=isScene?'对读组合操作':isContent ? w?.kind==='reading'?'经文操作':w?.kind==='note'?'笔记操作':'研读操作' : '窗口操作';
    const actions=isScene ? [{act:'unpair',label:unpairLabel(),icon:'rows-2',id},{act:'close-scene',label:'关闭整个组合',icon:'x',id}] : isContent ? contentActions(w) : windowActions(id);
    panel.setAttribute('aria-label',label); panel.dataset.scope=isScene?'scene':isContent?'content':'window';
    panel.innerHTML=`<span class="ep-menu-label">${label}</span>`+actionButtons(actions,false);
    panel.hidden = q('.ep-menu-scrim').hidden = false; const a=anchor.getBoundingClientRect(), p=phone.getBoundingClientRect();
    panel.style.left=clamp(a.right-p.left-220,12,phone.clientWidth-232)+'px'; panel.style.top=clamp(a.bottom-p.top+5,12,Math.max(12,phone.clientHeight-panel.offsetHeight-15))+'px'; icons();
  }
  function updateInert() {
    const capacityOpen = !q('.ep-capacity').hidden;
    const modal = capacityOpen || drawerOpen || !!directory || !q('.ep-history-panel').hidden;
    q('.ep-main').inert = modal; q('.ep-floating-layer').inert = modal;
    q('.ep-drawer').inert = capacityOpen || !drawerOpen || !!directory || !q('.ep-history-panel').hidden;
    q('.ep-history-panel').inert = capacityOpen; q('.ep-directory').inert = capacityOpen;
  }
  function drawerProgress(progress, dragging=false) {
    phone.classList.toggle('ep-drawer-dragging',dragging);
    const width = q('.ep-drawer').offsetWidth;
    q('.ep-drawer').style.transform = `translateX(${(progress-1)*width}px)`;
    q('.ep-drawer-scrim').style.opacity = progress;
    for (const node of [q('.ep-main'),q('.ep-floating-layer')]) {
      node.style.transform = `translateX(${width*.88*progress}px) scale(${1-.08*progress})`;
      node.style.borderRadius = `${24*progress}px`;
    }
  }
  function drawer(open) {
    finishWindowMotions();
    if (open) { capture(); flushNotes(); closeMenu(); if (directory) closeDirectory(); q('.ep-history-panel').hidden = true; lastModalFocus = document.activeElement; renderSaved(); }
    clearTimeout(drawerTimer);
    const el = q('.ep-drawer'), wasHidden = el.hidden;
    el.hidden = q('.ep-drawer-scrim').hidden = false;
    if (wasHidden) { drawerProgress(0,true); el.getBoundingClientRect(); }
    drawerOpen = open; drawerProgress(open ? 1 : 0);
    el.inert = !open;
    if (!open) drawerTimer = setTimeout(() => { if (!drawerOpen && gesture?.mode !== 'drawer') el.hidden = q('.ep-drawer-scrim').hidden = true; },reduceMotion()?0:380);
    updateInert(); icons(); if (open) el.querySelector('button').focus({preventScroll:true}); else if (lastModalFocus?.isConnected && !directory) lastModalFocus.focus({preventScroll:true});
  }
  function openDirectory(id) {
    drawer(false); closeMenu(); directory = {id:id || null,book:null,testament:'旧约',serial:++directorySerial,busy:false};
    q('.ep-directory').hidden = false; renderDirectory(q('.ep-directory'),directory,false); updateInert(); q('.ep-directory button').focus({preventScroll:true});
  }
  function closeDirectory() { directory = null; directorySerial++; q('.ep-directory').hidden = true; updateInert(); }
  function renderDirectory(container,catalog,isRoot) {
    const book = info(catalog.book), kind = isRoot ? 'root' : 'modal';
    container.innerHTML = `<div class="${isRoot ? 'ep-root-directory' : 'ep-directory-inner'}" data-catalog="${kind}" style="display:flex;flex-direction:column;min-height:0;height:100%"><header class="ep-directory-head">${book ? button('directory-back','返回书卷目录','arrow-left') : isRoot ? button('drawer','打开后台','panel-left') : ''}<h2>${book ? esc(book.name) + ' · 选章' : isRoot ? '书卷目录' : catalog.id ? '选择书卷' : '新建读经'}</h2>${isRoot ? button('history','历史记录','history') : button('directory-close','取消选择','x')}</header>${!book && isRoot ? '<p class="ep-directory-intro">翻开话语，继续今天的旅程。</p>' : ''}<div class="ep-directory-tabs"${book ? ' hidden' : ''}><button data-testament="旧约" aria-pressed="${catalog.testament === '旧约'}">旧约</button><button data-testament="新约" aria-pressed="${catalog.testament === '新约'}">新约</button></div><div class="ep-directory-content">${book ? `<div class="ep-chapter-grid">${Array.from({length:book.chapterCount},(_,i) => `<button data-pick-chapter="${i+1}" aria-label="${esc(book.name)} 第 ${i+1} 章"${catalog.busy ? ' disabled' : ''}>${i+1}</button>`).join('')}</div>` : `<div class="ep-book-grid">${books.filter(b => b.testament === catalog.testament).map(b => `<button data-pick-book="${b.number}">${esc(b.name)}<small>${b.chapterCount} 章</small></button>`).join('')}</div>`}</div><div class="ep-directory-status" role="status">${catalog.busy ? '正在载入经文…' : book ? '选择章节后打开阅读。' : '先选书卷，再选章节。'}</div></div>`; icons();
  }
  async function chooseChapter(number,catalog,isRoot) {
    const origin = motionOrigin;
    if (catalog.busy) return; const book = info(catalog.book); if (!book || number < 1 || number > book.chapterCount) return;
    const serial = catalog.serial, token = catalog.request = (catalog.request || 0)+1, container = isRoot ? q('.ep-main') : q('.ep-directory'); catalog.busy = true; renderDirectory(container,catalog,isRoot);
    try {
      const data = await loadBook(book.number);
      if (catalog.request !== token || catalog.book !== book.number || (isRoot && (M.top(state) || rootCatalog !== catalog)) || (!isRoot && (directory !== catalog || directory.serial !== serial))) return;
      if (!data.chapters[number-1]?.length) throw Error('经文未载入');
      if (!isRoot) closeDirectory(); catalog.busy = false;
      change(() => { if (catalog.id && M.get(state,catalog.id)) M.navigate(state,catalog.id,book.number,number); else M.openPrimary(state,'reading',{book:book.number,chapter:number}); },origin);
    } catch (_) { if ((isRoot && rootCatalog === catalog) || directory === catalog) { catalog.busy = false; renderDirectory(container,catalog,isRoot); container.querySelector('.ep-directory-status').textContent = '经文暂未载入，请点击章节重试。'; } }
  }
  async function navigate(id,delta) {
    const w = M.get(state,id); if (w?.kind !== 'reading') return; const p = M.page(w), oldKey = `${p.book}:${p.chapter}`;
    let book = p.book, chapter = p.chapter + delta;
    if (chapter < 1) { book--; chapter = info(book)?.chapterCount; }
    if (chapter > info(book)?.chapterCount) { book++; chapter = 1; }
    if (!info(book) || !chapter) return;
    try { await loadBook(book); if (!panes.get(id)?.isConnected || `${M.page(M.get(state,id))?.book}:${M.page(M.get(state,id))?.chapter}` !== oldKey) return; change(() => M.navigate(state,id,book,chapter)); } catch (_) { announce('经文暂未载入，请重试'); }
  }
  function citation(id) {
    if (selection?.id === id) return {...selection};
    const w = M.get(state,id); if (w?.kind === 'reading') { const p = M.page(w), verse = p.selected; if (verse) return {book:p.book,chapter:p.chapter,verse,words:cache.get(p.book)?.chapters[p.chapter-1]?.find(v => v[0] === verse)?.[1] || ''}; return null; }
    return w?.citation || null;
  }
  function newNote(id) {
    const c = citation(id); if (!c?.verse) { announce('请先选中一节经文'); return; }
    const text = c ? `> ${info(c.book)?.name} ${c.chapter}:${c.verse}\n> ${c.words || ''}\n\n` : '';
    change(() => M.openNew(state,'note',{citation:c,text,sourceWindowId:id}));
  }
  function showHistory() { drawer(false); closeMenu(); capture(); flushNotes(); persist(); q('.ep-history-panel').hidden = false; historyLimit = 50; renderHistory(); updateInert(); q('[data-act="history-close"]').focus({preventScroll:true}); }
  function renderHistory() {
    qa('[data-filter]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.filter === historyFilter)));
    const events = [...state.events].reverse().filter(e => e.windows.length && (historyFilter === 'all' || historyFilter === 'note' && e.revisionId || historyFilter === 'closed' && /关闭|回收/.test(e.action) || historyFilter === 'reading' && !e.revisionId && e.windows.some(w => w.kind === 'reading')));
    q('.ep-history-list').innerHTML = events.slice(0,historyLimit).map(e => {
      const text = e.revisionId ? state.notes[e.contentId]?.revisions.find(r => r.id === e.revisionId)?.text : '';
      return `<article class="ep-history-item"><button data-restore-event="${esc(e.id)}"><small>${esc(e.action)} · ${new Date(e.at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small><strong>${esc(e.windows.map(title).join(' · '))}</strong>${text ? `<p>${esc(text.slice(0,160))}${text.length > 160 ? '…' : ''}</p>` : ''}</button></article>`;
    }).join('') + (events.length > historyLimit ? button('history-more','查看更早记录','chevrons-down',null,'ep-text') : '') || '<p class="ep-empty">阅读与思考的痕迹，会留在这里。</p>'; icons();
  }
  function exportBackup() { capture(); flushNotes(); persist(); parent.postMessage({type:'emmaus-export-request',data:M.copy(state)},'*'); announce('正在导出本地备份'); }

  phone.addEventListener('click',event => {
    if (performance.now() < ignoreClickUntil) { event.preventDefault(); return; }
    const surface=event.target.closest('.ep-pane,.ep-sheet'), tappedId=surface?.dataset.windowId;
    const wasRevealed=tappedId===activeWindowId && toolsVisible;
    if(tappedId) activateWindow(tappedId);
    const b = event.target.closest('button'); if (!b || b.disabled) return;
    if(b.classList.contains('ep-pane-title') && !wasRevealed) return;
    motionOrigin = b.getBoundingClientRect();
    if (b.dataset.tab) { change(() => M.openFloat(state,b.dataset.tab,'打开悬浮标签')); return; }
    if (b.dataset.resume) { drawer(false); change(() => M.resume(state,b.dataset.resume)); return; }
    if (b.dataset.restoreEvent) { change(() => M.restoreEvent(state,b.dataset.restoreEvent)); q('.ep-history-panel').hidden = true; updateInert(); return; }
    if (b.dataset.filter) { historyFilter = b.dataset.filter; historyLimit = 50; renderHistory(); return; }
    const catalogRoot = b.closest('[data-catalog]'), isRoot = catalogRoot?.dataset.catalog === 'root', catalog = isRoot ? rootCatalog : directory;
    if (b.dataset.testament && catalog) { catalog.testament = b.dataset.testament; renderDirectory(isRoot ? q('.ep-main') : q('.ep-directory'),catalog,isRoot); return; }
    if (b.dataset.pickBook && catalog) { catalog.book = Number(b.dataset.pickBook); renderDirectory(isRoot ? q('.ep-main') : q('.ep-directory'),catalog,isRoot); return; }
    if (b.dataset.pickChapter && catalog) { chooseChapter(Number(b.dataset.pickChapter),catalog,isRoot); return; }
    if (b.dataset.verse) {
      const w = M.get(state,b.dataset.id), p = M.page(w); p.selected = Number(b.dataset.verse);
      selection = {id:w.id,book:p.book,chapter:p.chapter,verse:p.selected,words:b.querySelector('.ep-verse-words').textContent};
      const node = panes.get(w.id); setQuiet(node,false); node.querySelectorAll('.ep-verse').forEach(v => { const selected = v === b; v.classList.toggle('is-selected',selected); v.setAttribute('aria-pressed',String(selected)); }); paneActions(node,w); icons(); persist(); return;
    }
    const id = b.dataset.id, act = b.dataset.act;
    switch (act) {
      case 'capacity-cancel': closeCapacity(); break;
      case 'capacity-minimize':
      case 'capacity-close': {
        const pending=pendingCapacity; closeCapacity();
        if(pending) change(()=>{ if(act==='capacity-minimize') M.minimize(state,id); else M.closeWindow(state,id); pending.callback(); },pending.origin);
        break;
      }
      case 'raise-float': closeMenu(); activateWindow(id); break;
      case 'activate': activateWindow(id); break;
      case 'drawer': drawer(true); break;
      case 'drawer-close': drawer(false); break;
      case 'root-directory': drawer(false); change(() => { state.atDirectory = true; rootCatalog = {book:null,testament:'旧约'}; }); break;
      case 'new-reading': openDirectory(); break;
      case 'reading-directory': openDirectory(id); break;
      case 'directory-close': closeDirectory(); break;
      case 'directory-back': if (catalog) { catalog.book = null; catalog.busy = false; catalog.request = (catalog.request || 0)+1; renderDirectory(isRoot ? q('.ep-main') : q('.ep-directory'),catalog,isRoot); } break;
      case 'note-edit': {
        const node=panes.get(id), w=M.get(state,id); if(w?.kind!=='note') break; referenceRequest++;
        closeMenu(); node.dataset.editing=String(node.dataset.editing!=='true'); renderNote(node,w); icons();
        if(node.dataset.editing==='true') node.querySelector('textarea').focus({preventScroll:true});
        else { flushNotes(); persist(); } break;
      }
      case 'note-scripture': openNoteScripture(b); break;
      case 'open-note': drawer(false); newNote(id); break;
      case 'open-reference': {
        const c = citation(id);
        if (!c?.verse) { announce('请先选中一节经文'); break; }
        change(() => M.openNew(state,'reference',{citation:c,sourceWindowId:id})); break;
      }
      case 'reference-reading': { const c=M.get(state,id)?.citation; if(c?.book) change(()=>M.openNew(state,'reading',{book:c.book,chapter:c.chapter,verse:c.book===45 && c.chapter===8 && [28,29].includes(c.verse) ? 29 : c.verse,sourceWindowId:id})); break; }
      case 'promote': change(() => M.promote(state,id)); break;
      case 'minimize': change(() => M.minimize(state,id)); break;
      case 'move-float': change(() => M.openFloat(state,id,'主窗口变为浮窗')); break;
      case 'pin': change(() => M.pin(state,id)); break;
      case 'pair': change(() => M.pair(state,id)); break;
      case 'unpair': change(() => M.unpair(state,id)); break;
      case 'swap-pair': {
        const hadFocus=document.activeElement===b;
        change(() => M.swapPair(state,id));
        if(hadFocus) q('.ep-divider')?.focus({preventScroll:true});
        break;
      }
      case 'close-window': change(() => M.closeWindow(state,id)); break;
      case 'close-scene': change(() => M.closeScene(state,id)); break;
      case 'pane-menu': menu(id,b); break;
      case 'content-menu': menu(id,b,false,true); break;
      case 'scene-menu': menu(id,b,true); break;
      case 'menu-close': closeMenu(); break;
      case 'next': closeMenu(); navigate(id,1); break;
      case 'prev': closeMenu(); navigate(id,-1); break;
      case 'back': change(() => M.travel(state,id,-1)); break;
      case 'forward': change(() => M.travel(state,id,1)); break;
      case 'retry': { const node = panes.get(id); delete node.dataset.page; node.dataset.ready = 'error'; render(); break; }
      case 'tools': setQuiet(panes.get(id),false); break;
      case 'history': showHistory(); break;
      case 'history-close': q('.ep-history-panel').hidden = true; updateInert(); break;
      case 'history-more': historyLimit += 50; renderHistory(); break;
      case 'export': exportBackup(); break;
    }
  });

  // A floating sheet is NOT modal: only its own boundary consumes wheel/touch input.
  phone.addEventListener('wheel',event => {
    const scroller = event.target.closest('textarea,.ep-scroll,.ep-directory-content,.ep-saved-list,.ep-history-list,.ep-capacity-card,.ep-popover');
    if (!scroller || (event.deltaY < 0 && scroller.scrollTop <= 0) || (event.deltaY > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1)) event.preventDefault();
  },{passive:false});
  let touchY = null;
  phone.addEventListener('touchstart',event => touchY = event.touches[0]?.clientY,{passive:true});
  phone.addEventListener('touchmove',event => {
    if (touchY == null) return; const y = event.touches[0]?.clientY, delta = touchY - y; touchY = y;
    const scroller = event.target.closest('textarea,.ep-scroll,.ep-directory-content,.ep-saved-list,.ep-history-list,.ep-capacity-card,.ep-popover');
    if (!scroller || (delta < 0 && scroller.scrollTop <= 0) || (delta > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1)) { if (event.cancelable) event.preventDefault(); }
  },{passive:false});
  phone.addEventListener('pointerdown',event => {
    if (event.button !== 0) return;
    if (!q('.ep-capacity').hidden) return;
    const rect = phone.getBoundingClientRect(), handle = event.target.closest('.ep-handle,.ep-resize,.ep-divider');
    const sheet=event.target.closest('.ep-sheet'), w=sheet && M.get(state,sheet.dataset.windowId), geometry=w && floatGeometry(w);
    if(w && !drawerOpen && !directory) raiseFloat(w.id);
    gesture = {pointer:event.pointerId,x:event.clientX,y:event.clientY,canOpen:event.clientX-rect.left < rect.width/2,wasOpen:drawerOpen,handle,mode:null,id:w?.id,height:geometry?.height/phone.clientHeight || 0,top:geometry?.top/phone.clientHeight || 0,originalHeight:w?.height,originalTop:w?.floatTop,sceneId:M.top(state)?.id,axis:wideLayout()?'x':'y',originalRatio:M.top(state)?.ratio || .5,ratio:pairMetrics().ratio};
  },true);
  phone.addEventListener('pointermove',event => {
    if (!gesture || gesture.pointer !== event.pointerId) return; const g = gesture, dx = event.clientX-g.x, dy = event.clientY-g.y;
    if (!g.mode) {
      if(g.handle?.classList.contains('ep-divider') && g.axis==='x' && Math.abs(dx)>9 && Math.abs(dx)>Math.abs(dy)*1.25) { g.mode='divider'; }
      else if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)*1.25 && ((g.canOpen && dx > 0) || (g.wasOpen && dx < 0))) {
        g.mode = 'drawer'; clearTimeout(drawerTimer); closeMenu(); if (directory) closeDirectory(); q('.ep-history-panel').hidden = true; renderSaved(); icons(); q('.ep-drawer').hidden = q('.ep-drawer-scrim').hidden = false;
      } else if (g.handle && Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)*1.25) g.mode = g.handle.classList.contains('ep-divider') ? (g.axis==='y'?'divider':null) : g.handle.classList.contains('ep-resize') ? 'height' : 'move';
      else if (Math.abs(dy) > 14 && !g.handle) { ignoreClickUntil=performance.now()+500; gesture = null; return; }
      if (g.mode) { if(g.id && ['height','move'].includes(g.mode)) { activateWindow(g.id,false); hideTools(); } phone.setPointerCapture(event.pointerId); ignoreClickUntil = performance.now()+500; }
    }
    if (!g.mode) { if(Math.hypot(dx,dy)>14)ignoreClickUntil=performance.now()+500; return; } event.preventDefault();
    if (g.mode === 'drawer') {
      const width = q('.ep-drawer').offsetWidth, progress = clamp((g.wasOpen ? width : 0) + dx,0,width)/width; g.progress = progress;
      drawerProgress(progress,true);
    } else if ((g.mode === 'height' || g.mode === 'move') && state.floating.includes(g.id)) {
      const w=M.get(state,g.id), h=phone.clientHeight, bounds=floatGeometry(w);
      if(g.mode==='move') w.floatTop=clamp(g.top+dy/h,bounds.topInset/h,(bounds.available-bounds.bottomInset-bounds.height)/h);
      else { w.floatTop=g.top; w.height=clamp(g.height+dy/h,Math.min(205,bounds.available-bounds.bottomInset-g.top*h)/h,(bounds.available-bounds.bottomInset-g.top*h)/h); }
      layoutFloats();
    } else if (g.mode === 'divider') {
      const scene = M.top(state), body = q('.ep-scene-body'); if (!scene || !body) return;
      const m=pairMetrics(scene); scene.ratio=clamp(g.ratio+(g.axis==='x'?dx:dy)/m.span,m.min,m.max); layoutPair();
    }
  },{capture:true,passive:false});
  function endGesture(event,cancelled=false) {
    const g = gesture; gesture = null; if (!g) return;
    if (phone.hasPointerCapture(event.pointerId)) phone.releasePointerCapture(event.pointerId);
    if (g.mode === 'drawer') { drawer(cancelled ? g.wasOpen : g.progress > (g.wasOpen ? .65 : .35)); }
    if(cancelled && g.mode==='divider') { const scene=state.scenes.find(s=>s.id===g.sceneId); if(scene)scene.ratio=g.originalRatio; layoutPair(); }
    if(cancelled && g.id && ['height','move'].includes(g.mode)) { const w=M.get(state,g.id); w.height=g.originalHeight; w.floatTop=g.originalTop; layoutFloats(); }
    if (g.mode) { ignoreClickUntil = performance.now()+350; persist(); }
  }
  phone.addEventListener('pointerup',event => endGesture(event),true);
  phone.addEventListener('pointercancel',event => endGesture(event,true),true);
  phone.addEventListener('keydown',event => {
    if (event.key === 'Escape') {
      if (!q('.ep-capacity').hidden) closeCapacity(); else if (directory) closeDirectory(); else if (!q('.ep-history-panel').hidden) { q('.ep-history-panel').hidden = true; updateInert(); } else if (menuTarget) closeMenu(); else if (drawerOpen) drawer(false); else hideTools();
      event.preventDefault(); return;
    }
    if(event.target.classList.contains('ep-pane') && ['Enter',' '].includes(event.key)) { event.preventDefault(); activateWindow(event.target.dataset.windowId); return; }
    const handle = event.target.closest('.ep-handle,.ep-resize,.ep-divider');
    const resizeKeys=handle?.classList.contains('ep-divider') && wideLayout()?['ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown'];
    if (handle && resizeKeys.includes(event.key)) {
      event.preventDefault(); const delta = ['ArrowUp','ArrowLeft'].includes(event.key) ? -24 : 24;
      if (!handle.classList.contains('ep-divider')) {
        const w=M.get(state,handle.dataset.id), g=floatGeometry(w), h=phone.clientHeight; raiseFloat(w.id);
        if(handle.classList.contains('ep-handle')) w.floatTop=clamp(g.top+delta,g.topInset,g.available-g.bottomInset-g.height)/h;
        else { w.floatTop=g.top/h; w.height=clamp(g.height+delta,Math.min(205,g.available-g.bottomInset-g.top),g.available-g.bottomInset-g.top)/h; }
        layoutFloats(); persist();
      } else { const scene=M.top(state), m=pairMetrics(scene); scene.ratio=clamp(m.ratio+delta/m.span,m.min,m.max); layoutPair(); persist(); }
      return;
    }
    if (event.key === 'Tab') {
      const modal = !q('.ep-capacity').hidden ? q('.ep-capacity') : directory ? q('.ep-directory') : !q('.ep-history-panel').hidden ? q('.ep-history-panel') : drawerOpen ? q('.ep-drawer') : null;
      if (!modal) return; const items = [...modal.querySelectorAll('button:not(:disabled),textarea')].filter(b => b.getClientRects().length), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); } else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
    }
  });
  window.addEventListener('pagehide',() => { flushNotes(); persist(); });
  document.addEventListener('visibilitychange',() => { if (document.hidden) { flushNotes(); persist(); } });
  const saved = window.openai?.widgetState?.privateContent;
  try { state = M.restore(saved,books); } catch (_) { state = null; }
  if (!state) {
    state = M.fresh(); const reader = M.create(state,'reading',{book:45,chapter:8,verse:28}); M.promote(state,reader.id,'开始阅读');
    M.openNew(state,'reference',{citation:{book:45,chapter:8,verse:28,words:'我们晓得万事都互相效力，叫爱神的人得益处，就是按他旨意被召的人。'}});
    if (saved) { q('.ep-storage-error').hidden = false; q('.ep-storage-error span').textContent = '旧状态无法读取，尚未覆盖原存档。请先导出原存档。'; state.recoveryOriginal = saved; }
  }
  render();
  if (!state.recoveryOriginal) persist();
  window.addEventListener('openai:set_globals',event => {
    const raw = event.detail?.globals?.widgetState?.privateContent;
    if (!raw || raw.sender === stamp || raw.version !== 7) return;
    // Initial host hydration is allowed; delayed foreign state must not overwrite active edits.
    if (dirtyNotes.size) return;
    try { const restored = M.restore(raw,books); if (restored) { state = restored; panes.clear(); render(); } } catch (_) { announce('收到的阅读状态无法恢复，保留当前内容'); }
  });
  new ResizeObserver(resizeViewport).observe(phone);
  window.visualViewport?.addEventListener('resize',layoutFloats);
  window.addEventListener('message',event=>{
    if(event.source!==parent || event.data?.type!=='emmaus-visible-viewport' || !Number.isFinite(event.data.bottom)) return;
    hostViewportBottom=Math.max(100,event.data.bottom); layoutFloats();
  });
  parent.postMessage({type:'emmaus-viewport-request'},'*');
})();
