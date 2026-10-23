// Tests interact through visible controls: reveal the target window with a real
// title/grip tap before clicking a shortcut. Do not bypass hit testing.
async function reveal(f,selector){
 const target=f.locator(selector).last();await target.waitFor({state:'attached'});
 const owner=await target.evaluate(e=>{const pane=e.closest('.ep-pane'),sheet=e.closest('.ep-sheet'),scene=e.closest('.ep-scene-head');if(pane||sheet){const n=pane||sheet;return{id:n.dataset.windowId,quiet:(pane||sheet).classList.contains('is-quiet'),floating:!!sheet};}if(scene){const p=scene.parentElement.querySelector('.ep-pane');return p?{id:p.dataset.windowId,quiet:p.classList.contains('is-quiet'),floating:false}:null;}return null;});
 if(owner?.quiet){await f.locator(owner.floating?`.ep-sheet[data-window-id="${owner.id}"] .ep-handle`:`.ep-main .ep-pane[data-window-id="${owner.id}"] .ep-pane-title`).click();}
}
module.exports={reveal};
