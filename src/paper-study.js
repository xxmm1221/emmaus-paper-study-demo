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
  const title = w => w?.kind === 'reading' ? `${info(M.page(w)?.book)?.name || '读经'} ${M.page(w)?.chapter || ''}` : w?.kind === 'note' ? (state.notes[w.contentId]?.text.split('\n').find(t => t.trim())?.replace(/^>\s*/, '').slice(0,18) || '研读笔记') : '益处，不止于顺境';
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
      } else { w.scroll = scroll.scrollTop; if (w.kind === 'note') w.outerScroll = node.querySelector('.ep-scroll').scrollTop; }
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
      const saved = window.openai?.setWidgetState({modelContent:{design:'纸间研读',main:M.top(state)?.members.length || 0,floating:!!state.floating,tabs:state.tabs.length,history:state.events.length},privateContent:snapshot});
      if (!saved) throw Error('本地保存不可用');
      Promise.resolve(saved).then(() => { if (serial === saveSerial) q('.ep-storage-error').hidden = true; },() => { if (serial === saveSerial) q('.ep-storage-error').hidden = false; });
    } catch (_) { q('.ep-storage-error').hidden = false; }
  }
  const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist,220); };
  let motionOrigin = null, drawerTimer;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function surfaces() {
    const result = new Map();
    qa('.ep-main .ep-pane,.ep-sheet:not([data-motion-ghost]),.ep-tabs .ep-tab').forEach(node => {
      const id = node.dataset.windowId || node.dataset.tab;
      if (id) result.set(id,{node,rect:node.getBoundingClientRect()});
    });
    return result;
  }
  function animateWindows(before, origin) {
    if (reduceMotion()) return;
    const after = surfaces(), options = {duration:460,easing:'cubic-bezier(.22,.8,.25,1)'};
    after.forEach(({node,rect},id) => {
      const from = before.get(id)?.rect || origin;
      if (!from || !rect.width || !rect.height) return;
      const dx = from.left-rect.left, dy = from.top-rect.top, sx = from.width/rect.width, sy = from.height/rect.height;
      if (Math.abs(dx)+Math.abs(dy)+Math.abs(sx-1)+Math.abs(sy-1) < .5) return;
      node.animate([{transformOrigin:'0 0',transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`,opacity:before.has(id)?1:.35,borderRadius:'22px'}, {transformOrigin:'0 0',transform:'none',opacity:1,borderRadius:getComputedStyle(node).borderRadius}],options);
    });
    before.forEach(({rect,ghost},id) => {
      if (after.has(id)) return;
      const bounds = phone.getBoundingClientRect(), scene = state.scenes.find(s => s.members.includes(id));
      const target = scene && q(`[data-resume="${scene.id}"]`);
      const to = target && !q('.ep-drawer').hidden ? target.getBoundingClientRect() : {left:bounds.left+20,top:bounds.top+24,width:44,height:44};
      Object.assign(ghost.style,{position:'absolute',margin:'0',inset:'auto',left:rect.left-bounds.left+'px',top:rect.top-bounds.top+'px',width:rect.width+'px',height:rect.height+'px',minHeight:'0',maxHeight:'none',zIndex:30,pointerEvents:'none',transformOrigin:'0 0'});
      ghost.dataset.motionGhost = 'true'; ghost.setAttribute('aria-hidden','true'); ghost.inert = true; phone.append(ghost);
      ghost.animate([{transform:'none',opacity:1},{transform:`translate(${to.left-rect.left}px,${to.top-rect.top}px) scale(${to.width/rect.width},${to.height/rect.height})`,opacity:0}],options).finished.catch(()=>{}).finally(()=>ghost.remove());
    });
  }
  function change(callback, origin = motionOrigin) {
    capture(); flushNotes(); qa('[data-motion-ghost]').forEach(n=>n.remove()); phone.getAnimations({subtree:true}).forEach(a => { if (a.effect?.target?.closest?.('.ep-main,.ep-floating-layer')) a.finish(); }); const before = surfaces();
    before.forEach(item => { item.ghost = item.node.cloneNode(true); });
    selection = null; closeMenu(); callback(); render(); animateWindows(before,origin); persist(false);
  }

  function setQuiet(node,quiet) {
    node.classList.toggle('is-quiet',quiet); node.querySelector('.ep-tools-restore').hidden = !quiet;
    const scene = node.closest('.ep-main-scene'); if (scene) scene.classList.toggle('is-quiet',quiet);
  }
  function watchScroll(node,scroll) {
    let previous = 0, inputUntil = 0, distance = 0;
    scroll._resetQuiet = () => { previous = scroll.scrollTop; distance = 0; };
    scroll.addEventListener('wheel',() => inputUntil = performance.now() + 700,{passive:true});
    scroll.addEventListener('touchstart',() => inputUntil = performance.now() + 1500,{passive:true});
    scroll.addEventListener('touchmove',() => inputUntil = performance.now() + 1500,{passive:true});
    scroll.addEventListener('scroll',() => {
      const y = scroll.scrollTop, delta = y - previous; previous = y;
      if (node.dataset.ready === 'true' && performance.now() > (node._suppressUntil || 0) && performance.now() < inputUntil) {
        if (Math.sign(delta) !== Math.sign(distance)) distance = 0;
        distance += delta;
        if (distance > 24 && y > 60) { setQuiet(node,true); distance = 0; }
        else if (distance < -16) { setQuiet(node,false); distance = 0; }
      } else distance = 0;
      scheduleSave();
    },{passive:true});
  }
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
    const actions = node.querySelector('.ep-pane-actions'), selected = selection?.id === w.id;
    actions.innerHTML = (selected ? `<span class="ep-selected-ref">${esc(info(selection.book)?.abbreviation)} ${selection.chapter}:${selection.verse}</span>` : '') + button('open-reference','研读','book-open',w.id,'ep-text') + button('open-note',selected ? '记笔记' : '笔记','pen-line',w.id,'ep-text');
  }
  function ensurePane(w) {
    let node = panes.get(w.id);
    if (!node) {
      node = document.createElement('section'); node.className = 'ep-pane'; node.dataset.windowId = w.id; node.setAttribute('aria-label',title(w));
      node.innerHTML = `<header class="ep-pane-head"></header><div class="ep-scroll"></div><div class="ep-pane-actions"></div>${button('tools','显示阅读工具','ellipsis',w.id,'ep-icon ep-tools-restore')}`;
      node.querySelector('.ep-tools-restore').hidden = true; panes.set(w.id,node); watchScroll(node,node.querySelector('.ep-scroll'));
    }
    const header = node.querySelector('.ep-pane-head'), float = state.floating === w.id;
    node.setAttribute('aria-label',title(w));
    header.innerHTML = `<button class="ep-pane-title" data-act="${w.kind === 'reading' ? 'reading-directory' : 'pane-menu'}" data-id="${esc(w.id)}" aria-label="${w.kind === 'reading' ? '选择书卷和章节' : '窗口操作'}"><span data-reading-title>${esc(title(w))}</span>${w.kind === 'reading' ? icon('chevron-down') : ''}</button>` + (w.kind === 'reading' ? button('back','浏览历史后退','arrow-left',w.id) + button('forward','浏览历史前进','arrow-right',w.id) : '') + (!float ? button('pane-menu','窗口更多操作','ellipsis',w.id) : '');
    if (w.kind === 'reading') { header.querySelector('[data-act="back"]').disabled = w.pageIndex === 0; header.querySelector('[data-act="forward"]').disabled = w.pageIndex === w.pages.length - 1; }
    const scroll = node.querySelector('.ep-scroll');
    if (w.kind === 'reading') {
      const p = M.page(w), key = `${p.book}:${p.chapter}`;
      if (node.dataset.page !== key || node.dataset.ready !== 'true') {
        node.dataset.page = key; node.dataset.ready = 'loading'; scroll.className = 'ep-scroll ep-reading-scroll';
        scroll.innerHTML = '<p class="ep-empty">经文正在展开…</p>';
        loadBook(p.book).then(data => {
          if (node.dataset.page !== key || M.page(w)?.book !== p.book || M.page(w)?.chapter !== p.chapter) return;
          const verses = data.chapters[p.chapter-1]; if (!Array.isArray(verses) || !verses.length) throw Error('这一章未载入');
          scroll.innerHTML = `<div class="ep-chapter-cover"><span class="ep-chapter-number">${String(p.chapter).padStart(2,'0')}</span><div><span class="ep-kicker">${esc(info(p.book).name)} · 和合本</span><h1>${p.book === 45 && p.chapter === 8 ? '在盼望中等候' : `第 ${p.chapter} 章`}</h1></div></div>` + verses.map(([n,words]) => `<button type="button" class="ep-verse${p.selected === n ? ' is-selected' : ''}" data-verse="${n}" data-id="${esc(w.id)}" aria-label="${esc(info(p.book).name)} ${p.chapter}:${n}，选择经文" aria-pressed="${p.selected === n}"><span class="ep-verse-number">${n}</span><span class="ep-verse-words">${esc(words)}</span></button>`).join('') + `<footer class="ep-reading-footer">${button('prev','上一章','arrow-left',w.id,'ep-text')}<span>和合本</span>${button('next','下一章','arrow-right',w.id,'ep-text')}</footer>`;
          const first = p.book === 1 && p.chapter === 1, last = p.book === 66 && p.chapter === 22;
          scroll.querySelector('[data-act="prev"]').disabled = first; scroll.querySelector('[data-act="next"]').disabled = last;
          node.dataset.ready = 'true'; requestAnimationFrame(() => restorePosition(node,w)); icons();
        }).catch(() => { if (node.dataset.page === key) { node.dataset.ready = 'error'; scroll.innerHTML = `<p class="ep-empty">经文暂未载入。${button('retry','点击重试','rotate-cw',w.id,'ep-text')}</p>`; icons(); } });
      }
    } else if (!node.dataset.ready) {
      node.dataset.ready = 'true';
      if (w.kind === 'note') {
        scroll.className = 'ep-scroll ep-note'; scroll.innerHTML = '<span class="ep-kicker">个人笔记</span><h2>研读笔记</h2><textarea aria-label="研读笔记正文" placeholder="此刻，你读到了什么？"></textarea><small class="ep-note-status">自动保存 · 保留编辑版本</small>';
        const area = scroll.querySelector('textarea'); area.value = state.notes[w.contentId].text; watchScroll(node,area);
        area.addEventListener('input',() => {
          state.notes[w.contentId].text = area.value; dirtyNotes.add(w.contentId);
          panes.forEach((other,id) => { if (id !== w.id && M.get(state,id)?.contentId === w.contentId) { const a = other.querySelector('textarea'); if (a && a.value !== area.value) a.value = area.value; } });
          clearTimeout(noteTimer); noteTimer = setTimeout(() => { flushNotes(); persist(); },650); scheduleSave();
        });
        area.addEventListener('blur',() => { flushNotes(); persist(); });
      } else {
        scroll.className = 'ep-scroll ep-reference'; scroll.innerHTML = `<span class="ep-kicker">研读札记 · 罗马书 8:28</span><h2>益处，不止于顺境。</h2><p class="ep-lead">“万事互相效力”，不是说每一件事本身都是好的。</p><p>把目光放到下一节：“效法他儿子的模样”。保罗所说的益处，也关乎我们在经历中，逐渐成为怎样的人。</p><div class="ep-thought"><span class="ep-kicker">带着这个问题，再读一遍</span><p>我盼望的，是处境改变，<br>还是生命也被更新？</p></div><button class="ep-write-link" data-act="reference-reading" data-id="${esc(w.id)}">${icon('book-open')}再读罗马书 8:29${icon('arrow-up-right')}</button><button class="ep-write-link" data-act="open-note" data-id="${esc(w.id)}">${icon('pen-line')}写下我的回应</button><small class="ep-source-credit">原创演示札记；仅适用于罗马书 8:28–29，不冒充其他经节的注释。</small>`;
      }
    }
    paneActions(node,w); return node;
  }
  function render() {
    panes.forEach(node => node._restoring = true);
    const scene = M.top(state), main = q('.ep-main'), slot = q('.ep-float-slot');
    main.replaceChildren();
    if (!scene) renderDirectory(main,rootCatalog,true);
    else {
      const wrap = document.createElement('div'); wrap.className = 'ep-main-scene' + (scene.members.length === 2 ? ' ep-paired' : ''); wrap.dataset.sceneId = scene.id;
      wrap.innerHTML = `<header class="ep-scene-head">${button('drawer','打开后台','panel-left')}<span>${scene.members.length === 2 ? '上下对读' : 'EMMAUS'}</span>${scene.members.length === 2 ? button('scene-menu','组合更多操作','ellipsis',scene.id) : button('close-scene','关闭主阅读窗口','x',scene.id)}</header><div class="ep-scene-body"></div>`;
      const body = wrap.querySelector('.ep-scene-body');
      scene.members.forEach((id,index) => { if (index) { const div = document.createElement('button'); div.type = 'button'; div.className = 'ep-divider'; div.dataset.scene = scene.id; div.setAttribute('aria-label','调整上下窗口比例'); div.setAttribute('role','separator'); div.setAttribute('aria-orientation','horizontal'); div.innerHTML = '<span></span>'; body.append(div); } body.append(ensurePane(M.get(state,id))); });
      if (scene.members.length === 2) body.style.gridTemplateRows = `minmax(0,${scene.ratio}fr) 27px minmax(0,${1-scene.ratio}fr)`;
      main.append(wrap);
    }
    const w = M.get(state,state.floating);
    main.style.setProperty('--floating-space',w ? clamp((w.height || .4)*phone.clientHeight,205,phone.clientHeight-24)+65+'px' : '100px');
    if (w) {
      let sheet = slot.querySelector('.ep-sheet');
      if (sheet?.dataset.windowId !== w.id) { sheet = document.createElement('article'); sheet.className = 'ep-sheet'; sheet.dataset.windowId = w.id; sheet.setAttribute('aria-label','临时阅读浮窗'); sheet.dataset.presentation = 'floating'; slot.replaceChildren(sheet); }
      sheet.style.height = clamp((w.height || .4) * phone.clientHeight,205,phone.clientHeight-24) + 'px';
      let bar = sheet.querySelector('.ep-sheet-bar'); if (!bar) { bar = document.createElement('header'); bar.className = 'ep-sheet-bar'; sheet.prepend(bar); }
      bar.innerHTML = `<button class="ep-handle" data-id="${esc(w.id)}" aria-label="调整浮窗高度" type="button">${icon('grip-horizontal')}<span>临时参考</span></button>` + button('pair','对读','rows-2',w.id,'ep-text') + button('promote','最大化','maximize-2',w.id) + button('minimize','收为悬浮标签','minus',w.id) + button('pane-menu','浮窗更多操作','ellipsis',w.id);
      bar.querySelector('[data-act="pair"]').disabled = !scene || scene.members.length !== 1;
      sheet.append(ensurePane(w));
    } else slot.replaceChildren();
    q('.ep-tabs').innerHTML = state.tabs.map(t => { const w = M.get(state,t.id); return `<button class="ep-tab" data-tab="${esc(t.id)}" aria-label="以浮窗打开：${esc(title(w))}">${icon(w.kind === 'note' ? 'notebook-pen' : 'book-open')}<span>${esc(title(w))}</span></button>`; }).join('');
    renderSaved(); icons(); updateInert();
    requestAnimationFrame(() => panes.forEach((node,id) => { if (node.isConnected && node.dataset.ready === 'true') restorePosition(node,M.get(state,id)); }));
  }
  function renderSaved() {
    q('[data-saved-count]').textContent = state.scenes.length;
    q('.ep-saved-list').innerHTML = [...state.scenes].reverse().map(scene => `<button class="ep-nav-row${scene === M.top(state) ? ' is-current' : ''}" data-resume="${esc(scene.id)}">${icon(scene.members.length === 2 ? 'rows-2' : 'book-open')}<span>${esc(sceneTitle(scene))}<small>${scene === M.top(state) ? '当前阅读' : '点按最大化继续'}${scene.members.length === 2 ? ' · 双窗' : ''}</small></span></button>`).join('') || '<p class="ep-empty">留下的阅读现场，会在这里继续。</p>';
  }
  function closeMenu() { menuTarget = null; q('.ep-popover').hidden = q('.ep-menu-scrim').hidden = true; }
  function menu(id,anchor,isScene=false) {
    closeMenu(); menuTarget = id; const panel = q('.ep-popover'), w = M.get(state,id);
    panel.innerHTML = isScene ? button('unpair','拆分为两个主窗口','rows-2',id,'ep-text') + button('close-scene','关闭整个组合','x',id,'ep-text') : (state.floating === id ? button('promote','最大化','maximize-2',id,'ep-text') + button('minimize','收为悬浮标签','minus',id,'ep-text') : button('move-float','变为浮窗','panel-bottom',''+id,'ep-text') + button('pin','固定此处为浮窗','pin',id,'ep-text')) + button('open-note','新建笔记浮窗','pen-line',id,'ep-text') + button('close-window','关闭窗口','x',id,'ep-text');
    if (w?.kind === 'reference') panel.insertAdjacentHTML('beforeend',button('reference-reading','打开所引经文','book-open',id,'ep-text'));
    if (w?.kind === 'reading') panel.insertAdjacentHTML('beforeend',button('prev','上一章','chevron-left',id,'ep-text') + button('next','下一章','chevron-right',id,'ep-text'));
    panel.hidden = q('.ep-menu-scrim').hidden = false; const a = anchor.getBoundingClientRect(), p = phone.getBoundingClientRect();
    panel.style.left = clamp(a.right-p.left-220,12,phone.clientWidth-232) + 'px'; panel.style.top = clamp(a.bottom-p.top+5,12,phone.clientHeight-panel.offsetHeight-15) + 'px'; icons();
  }
  function updateInert() {
    const modal = drawerOpen || !!directory || !q('.ep-history-panel').hidden;
    q('.ep-main').inert = modal; q('.ep-floating-layer').inert = modal;
    q('.ep-drawer').inert = !drawerOpen || !!directory || !q('.ep-history-panel').hidden;
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
    try { await loadBook(book); if (`${M.page(w).book}:${M.page(w).chapter}` !== oldKey) return; change(() => M.navigate(state,id,book,chapter)); } catch (_) { announce('经文暂未载入，请重试'); }
  }
  function citation(id) {
    if (selection?.id === id) return {...selection};
    const w = M.get(state,id); if (w?.kind === 'reading') { const p = M.page(w), verse = p.selected; if (verse) return {book:p.book,chapter:p.chapter,verse,words:cache.get(p.book)?.chapters[p.chapter-1]?.find(v => v[0] === verse)?.[1] || ''}; }
    return w?.citation || null;
  }
  function newNote(id) {
    const c = citation(id), text = c ? `> ${info(c.book)?.name} ${c.chapter}:${c.verse}\n> ${c.words || ''}\n\n` : '';
    change(() => M.openNew(state,'note',{citation:c,text}));
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
    const b = event.target.closest('button'); if (!b || b.disabled) return;
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
      case 'drawer': drawer(true); break;
      case 'drawer-close': drawer(false); break;
      case 'root-directory': drawer(false); change(() => { state.atDirectory = true; rootCatalog = {book:null,testament:'旧约'}; }); break;
      case 'new-reading': openDirectory(); break;
      case 'reading-directory': openDirectory(id); break;
      case 'directory-close': closeDirectory(); break;
      case 'directory-back': if (catalog) { catalog.book = null; catalog.busy = false; catalog.request = (catalog.request || 0)+1; renderDirectory(isRoot ? q('.ep-main') : q('.ep-directory'),catalog,isRoot); } break;
      case 'open-note': drawer(false); newNote(id); break;
      case 'open-reference': {
        const c = citation(id);
        if (c && (c.book !== 45 || c.chapter !== 8 || ![28,29].includes(c.verse))) { announce('此原型仅提供罗马书 8:28–29 的演示札记'); break; }
        change(() => M.openNew(state,'reference',{citation:c || {book:45,chapter:8,verse:28}})); break;
      }
      case 'reference-reading': change(() => M.openNew(state,'reading',{book:45,chapter:8,verse:29})); break;
      case 'promote': change(() => M.promote(state,id)); break;
      case 'minimize': change(() => M.minimize(state,id)); break;
      case 'move-float': change(() => M.openFloat(state,id,'主窗口变为浮窗')); break;
      case 'pin': change(() => M.pin(state,id)); break;
      case 'pair': change(() => M.pair(state)); break;
      case 'unpair': change(() => M.unpair(state,id)); break;
      case 'close-window': change(() => M.closeWindow(state,id)); break;
      case 'close-scene': change(() => M.closeScene(state,id)); break;
      case 'pane-menu': menu(id,b); break;
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
    const scroller = event.target.closest('textarea,.ep-scroll,.ep-directory-content,.ep-saved-list,.ep-history-list');
    if (!scroller || (event.deltaY < 0 && scroller.scrollTop <= 0) || (event.deltaY > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1)) event.preventDefault();
  },{passive:false});
  let touchY = null;
  phone.addEventListener('touchstart',event => touchY = event.touches[0]?.clientY,{passive:true});
  phone.addEventListener('touchmove',event => {
    if (touchY == null) return; const y = event.touches[0]?.clientY, delta = touchY - y; touchY = y;
    const scroller = event.target.closest('textarea,.ep-scroll,.ep-directory-content,.ep-saved-list,.ep-history-list');
    if (!scroller || (delta < 0 && scroller.scrollTop <= 0) || (delta > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1)) { if (event.cancelable) event.preventDefault(); }
  },{passive:false});
  phone.addEventListener('pointerdown',event => {
    if (event.button !== 0) return;
    const rect = phone.getBoundingClientRect(), handle = event.target.closest('.ep-handle,.ep-divider');
    gesture = {pointer:event.pointerId,x:event.clientX,y:event.clientY,canOpen:event.clientX-rect.left < rect.width/2,wasOpen:drawerOpen,handle,mode:null,height:state.floating ? M.get(state,state.floating).height : 0,ratio:M.top(state)?.ratio || .5};
  },true);
  phone.addEventListener('pointermove',event => {
    if (!gesture || gesture.pointer !== event.pointerId) return; const g = gesture, dx = event.clientX-g.x, dy = event.clientY-g.y;
    if (!g.mode) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)*1.25 && ((g.canOpen && dx > 0) || (g.wasOpen && dx < 0))) {
        g.mode = 'drawer'; clearTimeout(drawerTimer); closeMenu(); if (directory) closeDirectory(); q('.ep-history-panel').hidden = true; renderSaved(); icons(); q('.ep-drawer').hidden = q('.ep-drawer-scrim').hidden = false;
      } else if (g.handle && Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)*1.25) g.mode = g.handle.classList.contains('ep-divider') ? 'divider' : 'height';
      else if (Math.abs(dy) > 14 && !g.handle) { gesture = null; return; }
      if (g.mode) { phone.setPointerCapture(event.pointerId); ignoreClickUntil = performance.now()+500; }
    }
    if (!g.mode) return; event.preventDefault();
    if (g.mode === 'drawer') {
      const width = q('.ep-drawer').offsetWidth, progress = clamp((g.wasOpen ? width : 0) + dx,0,width)/width; g.progress = progress;
      drawerProgress(progress,true);
    } else if (g.mode === 'height' && state.floating) {
      const w = M.get(state,state.floating); w.height = clamp(g.height-dy/phone.clientHeight,205/phone.clientHeight,.94); q('.ep-sheet').style.height = w.height*phone.clientHeight+'px';
      q('.ep-main').style.setProperty('--floating-space',w.height*phone.clientHeight+65+'px');
    } else if (g.mode === 'divider') {
      const scene = M.top(state), body = q('.ep-scene-body'); if (!scene || !body) return;
      scene.ratio = clamp(g.ratio + dy/(body.clientHeight-27),.25,.75); body.style.gridTemplateRows = `minmax(0,${scene.ratio}fr) 27px minmax(0,${1-scene.ratio}fr)`;
    }
  },{capture:true,passive:false});
  function endGesture(event,cancelled=false) {
    const g = gesture; gesture = null; if (!g) return;
    if (phone.hasPointerCapture(event.pointerId)) phone.releasePointerCapture(event.pointerId);
    if (g.mode === 'drawer') { drawer(cancelled ? g.wasOpen : g.progress > (g.wasOpen ? .65 : .35)); }
    if (g.mode) { ignoreClickUntil = performance.now()+350; persist(); }
  }
  phone.addEventListener('pointerup',event => endGesture(event),true);
  phone.addEventListener('pointercancel',event => endGesture(event,true),true);
  phone.addEventListener('keydown',event => {
    if (event.key === 'Escape') {
      if (directory) closeDirectory(); else if (!q('.ep-history-panel').hidden) { q('.ep-history-panel').hidden = true; updateInert(); } else if (menuTarget) closeMenu(); else if (drawerOpen) drawer(false); else qa('.ep-pane.is-quiet').forEach(n => setQuiet(n,false));
      event.preventDefault(); return;
    }
    const handle = event.target.closest('.ep-handle,.ep-divider');
    if (handle && ['ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault(); const delta = event.key === 'ArrowUp' ? .04 : -.04;
      if (handle.classList.contains('ep-handle')) { const w = M.get(state,state.floating); w.height = clamp(w.height+delta,205/phone.clientHeight,.94); }
      else { const scene = M.top(state); scene.ratio = clamp(scene.ratio-delta,.25,.75); }
      capture(); render(); persist(); return;
    }
    if (event.key === 'Tab') {
      const modal = directory ? q('.ep-directory') : !q('.ep-history-panel').hidden ? q('.ep-history-panel') : drawerOpen ? q('.ep-drawer') : null;
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
    if (!raw || raw.sender === stamp || raw.version !== 6) return;
    // Initial host hydration is allowed; delayed foreign state must not overwrite active edits.
    if (dirtyNotes.size) return;
    try { const restored = M.restore(raw,books); if (restored) { state = restored; panes.clear(); render(); } } catch (_) { announce('收到的阅读状态无法恢复，保留当前内容'); }
  });
  new ResizeObserver(() => { const sheet = q('.ep-sheet'), w = M.get(state,state.floating); if (sheet && w) sheet.style.height = clamp(w.height*phone.clientHeight,205,phone.clientHeight-24)+'px'; }).observe(phone);
})();
