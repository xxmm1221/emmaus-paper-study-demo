/* Window placement is independent of content. This module also runs in Node QA. */
(function (global) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const top = s => s.atDirectory ? null : s.scenes.at(-1) || null;
  const get = (s, id) => s.windows.find(w => w.id === id);
  const page = w => w?.pages?.[w.pageIndex || 0];
  const tick = s => s.clock = Math.max(Date.now(), (s.clock || 0) + 1);
  const uid = (s, prefix) => `${prefix}-${tick(s).toString(36)}-${++s.serial}`;
  function fresh() {
    return {version:6, serial:0, clock:0, windows:[], scenes:[], floating:null, tabs:[], notes:{}, events:[], atDirectory:true};
  }
  function snapshot(s, ids) {
    return ids.map(id => get(s, id)).filter(Boolean).map(w => {
      const result = copy(w);
      if (w.kind === 'reading') { result.pages = [copy(page(w))]; result.pageIndex = 0; }
      return result;
    });
  }
  function record(s, action, ids, scene) {
    const event = {id:uid(s, 'event'), at:s.clock, action, windows:snapshot(s, ids)};
    if (scene) event.scene = {members:[...scene.members], ratio:scene.ratio};
    s.events.push(event);
    return event;
  }
  function create(s, kind, options = {}) {
    const w = {id:uid(s, 'window'), kind, height:.4, scroll:0, lastOpened:s.clock, citation:options.citation || null};
    if (kind === 'reading') {
      w.pages = [{book:options.book || 45, chapter:options.chapter || 8, scroll:0, selected:options.verse || null}];
      w.pageIndex = 0;
    } else if (kind === 'note') {
      w.contentId = options.contentId || uid(s, 'note');
      if (!s.notes[w.contentId]) s.notes[w.contentId] = {text:options.text || '', revisions:[]};
    }
    s.windows.push(w);
    if (kind === 'note' && s.notes[w.contentId].text) commitNote(s, w.contentId);
    return w;
  }
  function detach(s, id) {
    if (s.floating === id) s.floating = null;
    s.tabs = s.tabs.filter(t => t.id !== id);
    s.scenes = s.scenes.map(scene => ({...scene, members:scene.members.filter(x => x !== id)})).filter(scene => scene.members.length);
    if (!s.scenes.length) s.atDirectory = true;
  }
  function promote(s, id, action = '最大化') {
    if (!get(s, id)) return;
    detach(s, id);
    const scene = {id:uid(s, 'scene'), members:[id], ratio:.5};
    s.scenes.push(scene); s.atDirectory = false;
    record(s, action, [id], scene);
  }
  function minimize(s, id = s.floating) {
    const w = get(s, id);
    if (!w) return;
    detach(s, id);
    s.tabs.push({id, lastOpened:w.lastOpened || tick(s)});
    record(s, '收为标签', [id]);
    while (s.tabs.length > 3) {
      const oldest = s.tabs.reduce((a, b) => a.lastOpened <= b.lastOpened ? a : b);
      s.tabs = s.tabs.filter(t => t.id !== oldest.id);
      record(s, '标签回收', [oldest.id]);
    }
  }
  function openFloat(s, id, action = '打开浮窗', sourceWindowId = null) {
    const w = get(s, id);
    if (!w || s.floating === id) return;
    // Release a reopened tab before parking the previous float (no spurious LRU eviction).
    s.tabs = s.tabs.filter(t => t.id !== id);
    // Placement depends on this action's origin, never the background layout.
    // A child of the current float keeps its source maximized behind it.
    // An unrelated entrant (including tab restoration / moving a main pane) parks it.
    if (s.floating) {
      if (sourceWindowId === s.floating) promote(s, s.floating, '衍生来源浮窗最大化');
      else minimize(s);
    }
    detach(s, id); s.floating = id; w.lastOpened = tick(s);
    record(s, action, [id]);
  }
  function openNew(s, kind, options) { const w = create(s, kind, options); openFloat(s, w.id, '打开浮窗', options?.sourceWindowId); return w; }
  // Independent creation belongs to the main stack; derived content uses openNew.
  function openPrimary(s, kind, options) { const w = create(s, kind, options); promote(s, w.id, '目录新建阅读'); return w; }
  function pin(s, id) {
    const source = get(s, id); if (!source) return;
    const sourceScene = top(s)?.members.includes(id) ? top(s) : null;
    const w = copy(source); w.id = uid(s, 'window'); w.lastOpened = s.clock;
    s.windows.push(w); openFloat(s, w.id, '固定此处', id);
    if (sourceScene && top(s)?.id !== sourceScene.id) resume(s, sourceScene.id);
    return w;
  }
  function pair(s) {
    const scene = top(s), id = s.floating;
    if (!id || !scene || scene.members.length !== 1) return false;
    s.floating = null; scene.members.push(id); scene.ratio = .5;
    record(s, '组成对读', scene.members, scene); return true;
  }
  function unpair(s, sceneId) {
    const scene = s.scenes.find(x => x.id === sceneId);
    if (!scene || scene.members.length !== 2) return;
    const index = s.scenes.indexOf(scene);
    record(s, '拆分对读', scene.members, scene);
    s.scenes.splice(index, 1, ...scene.members.map(id => ({id:uid(s, 'scene'), members:[id], ratio:.5})));
  }
  function closeWindow(s, id) {
    if (!get(s, id)) return;
    record(s, '关闭窗口', [id]); detach(s, id);
  }
  function closeScene(s, sceneId) {
    const scene = s.scenes.find(x => x.id === sceneId); if (!scene) return;
    record(s, '关闭场景', scene.members, scene);
    s.scenes = s.scenes.filter(x => x !== scene);
    if (!s.scenes.length) s.atDirectory = true;
  }
  function resume(s, sceneId) {
    const scene = s.scenes.find(x => x.id === sceneId); if (!scene) return;
    s.scenes = s.scenes.filter(x => x !== scene); s.scenes.push(scene); s.atDirectory = false;
    scene.members.forEach(id => { get(s, id).lastOpened = tick(s); });
    record(s, '切换主场景', scene.members, scene);
  }
  function navigate(s, id, book, chapter) {
    const w = get(s, id); if (w?.kind !== 'reading') return;
    if (page(w).book === book && page(w).chapter === chapter) return;
    record(s, '离开经文', [id]);
    w.pages.splice(w.pageIndex + 1); w.pages.push({book, chapter, scroll:0, selected:null}); w.pageIndex = w.pages.length - 1;
    record(s, '阅读经文', [id]);
  }
  function travel(s, id, direction) {
    const w = get(s, id); if (w?.kind !== 'reading') return;
    const index = clamp(w.pageIndex + direction, 0, w.pages.length - 1);
    if (index === w.pageIndex) return;
    record(s, '离开经文', [id]); w.pageIndex = index; record(s, direction < 0 ? '浏览后退' : '浏览前进', [id]);
  }
  function commitNote(s, contentId) {
    const note = s.notes[contentId]; if (!note) return;
    if (note.revisions.at(-1)?.text === note.text || (!note.revisions.length && !note.text)) return;
    const revision = {id:uid(s, 'revision'), at:s.clock, text:note.text}; note.revisions.push(revision);
    const w = s.windows.find(w => w.contentId === contentId);
    const event = record(s, '笔记版本', w ? [w.id] : []); event.contentId = contentId; event.revisionId = revision.id;
  }
  function restoreEvent(s, eventId) {
    const event = s.events.find(x => x.id === eventId); if (!event?.windows.length) return;
    const members = event.windows.map(saved => {
      const w = copy(saved); w.id = uid(s, 'window'); w.lastOpened = s.clock;
      if (event.revisionId && w.kind === 'note') {
        const revision = s.notes[event.contentId]?.revisions.find(r => r.id === event.revisionId);
        const contentId = uid(s, 'note'); s.notes[contentId] = {text:revision?.text ?? '', revisions:[]}; w.contentId = contentId;
      }
      s.windows.push(w); return w.id;
    });
    const scene = {id:uid(s, 'scene'), members:members.slice(0, 2), ratio:event.scene?.ratio || .5};
    s.scenes.push(scene); s.atDirectory = false;
    record(s, '从历史恢复', scene.members, scene); return scene;
  }
  function validPage(p, books) {
    const book = books.find(b => b.number === Number(p?.book));
    return book && Number.isInteger(p.chapter) && p.chapter >= 1 && p.chapter <= book.chapterCount;
  }
  function restore(raw, books) {
    if (!raw || ![3,4,5,6].includes(raw.version) || !Array.isArray(raw.windows)) return null;
    if (raw.version === 6) {
      const s = copy(raw);
      if (!Array.isArray(s.scenes) || !Array.isArray(s.tabs) || !Array.isArray(s.events) || !s.notes || typeof s.notes !== 'object') return null;
      if (Object.values(s.notes).some(n => !n || typeof n.text !== 'string' || !Array.isArray(n.revisions) || n.revisions.some(r => !r || typeof r.id !== 'string' || typeof r.text !== 'string'))) return null;
      if (s.events.some(e => !e || typeof e.id !== 'string' || typeof e.action !== 'string' || !Array.isArray(e.windows) || e.windows.some(w => !w || !['reading','note','reference'].includes(w.kind) || (w.kind === 'reading' && (!Array.isArray(w.pages) || !w.pages.length))))) return null;
      const ids = new Set();
      s.windows = s.windows.filter(w => w && typeof w.id === 'string' && ['reading','reference','note'].includes(w.kind) && !ids.has(w.id) && ids.add(w.id));
      for (const w of s.windows) {
        if (w.kind === 'reading') { w.pages = (w.pages || []).filter(p => validPage(p, books)); if (!w.pages.length) w.pages = [{book:45,chapter:8,scroll:0}]; w.pageIndex = clamp(Number(w.pageIndex) || 0, 0, w.pages.length - 1); }
        if (w.kind === 'note' && !s.notes[w.contentId]) s.notes[w.contentId] = {text:'', revisions:[]};
      }
      s.serial = Number(s.serial) || 0; s.clock = Number(s.clock) || 0;
      const placed = new Set(); const claim = id => ids.has(id) && !placed.has(id) && placed.add(id);
      s.floating = claim(s.floating) ? s.floating : null;
      s.tabs = s.tabs.filter(t => t && claim(t.id));
      s.scenes = s.scenes.filter(x => x && typeof x.id === 'string' && Array.isArray(x.members)).map(x => ({...x,members:x.members.slice(0,2).filter(claim),ratio:clamp(Number(x.ratio)||.5,.25,.75)})).filter(x => x.members.length);
      while (s.tabs.length > 3) { const oldest = s.tabs.reduce((a,b) => a.lastOpened <= b.lastOpened ? a : b); s.tabs = s.tabs.filter(t => t !== oldest); record(s, '标签回收', [oldest.id]); }
      s.atDirectory = !!s.atDirectory || !s.scenes.length;
      return s;
    }
    // v3-v5 stored a fixed Romans reader outside the material window list.
    const s = fresh(), main = create(s, 'reading'); main.id = 'legacy-scripture';
    main.pages = (raw.history || []).map(p => ({book:45,chapter:p.chapter,scroll:p.scroll || 0,selected:p.selected})).filter(p => validPage(p, books));
    if (!main.pages.length) main.pages = [{book:45,chapter:8,scroll:0,selected:28}];
    main.pageIndex = clamp(Number(raw.index)||0, 0, main.pages.length - 1);
    promote(s, main.id, '迁移主阅读窗口');
    for (const old of raw.windows) {
      if (!old || !['reference','reading','note'].includes(old.kind)) continue;
      const w = create(s, old.kind, {text:raw.notes?.[old.id] || '', citation:old.citation});
      if (!s.windows.some(x => x !== w && x.id === old.id)) w.id = old.id;
      w.height = clamp((Number(old.floatingHeight || old.height) || 320) / 800, .25, .9); w.scroll = Number(old.scroll) || 0;
      if (old.kind === 'reading') { w.pages = copy(old.pages || []).filter(p => validPage(p, books)); if (!w.pages.length) w.pages = [{book:45,chapter:8,scroll:0}]; w.pageIndex = clamp(Number(old.pageIndex)||0,0,w.pages.length-1); }
      if (old.paired) {
        const reader = copy(main); reader.id = uid(s,'window'); s.windows.push(reader);
        s.scenes.push({id:uid(s,'scene'),members:[reader.id,w.id],ratio:old.ratio || .5});
      } else if (old.id === raw.active && raw.ui?.peek) minimize(s, w.id);
      else if (old.id === raw.active && !old.maximized) s.floating = w.id;
      else promote(s, w.id, '迁移后台窗口');
    }
    // Preserve legacy orphan drafts too; never silently apply the old four-note cap.
    for (const [id,text] of Object.entries(raw.notes || {})) if (typeof text === 'string' && !raw.windows.some(w => w.id === id)) { const w = create(s,'note',{text}); record(s,'迁移笔记草稿',[w.id]); }
    const activeScene = s.scenes.find(x => x.members.includes(raw.active)); if (activeScene) resume(s, activeScene.id);
    Object.keys(s.notes).forEach(id => commitNote(s, id));
    record(s, '升级旧版状态', s.windows.map(w => w.id).slice(0,2));
    return s;
  }
  function assert(s) {
    const ids = s.windows.map(w => w.id), placed = [...s.scenes.flatMap(x => x.members), ...s.tabs.map(x => x.id), ...(s.floating ? [s.floating] : [])];
    if (new Set(ids).size !== ids.length || new Set(placed).size !== placed.length || placed.some(id => !ids.includes(id)) || s.tabs.length > 3 || s.scenes.some(x => x.members.length < 1 || x.members.length > 2)) throw Error('窗口层级不一致');
    return true;
  }
  global.EmmausWindows = {copy,top,get,page,fresh,create,record,openNew,openPrimary,openFloat,promote,minimize,pin,pair,unpair,closeWindow,closeScene,resume,navigate,travel,commitNote,restoreEvent,restore,assert};
})(globalThis);
