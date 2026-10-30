// Activate through real UI: titles select chapters, not window tools. Persistent
// float controls and visible content must stay usable without an activation tap.
async function reveal(f,selector){
 const target=f.locator(selector).last();await target.waitFor({state:'attached'});
 const owner=await target.evaluate(e=>{
  const pane=e.closest('.ep-pane'),sheet=e.closest('.ep-sheet');
  if(!pane&&!sheet)return null;
  const n=pane||sheet;
  return{id:n.dataset.windowId,quiet:n.classList.contains('is-quiet'),floating:!!sheet,
   usable:e.checkVisibility({visibilityProperty:true,opacityProperty:true})&&!e.closest('[inert]')};
 });
 if(owner?.quiet&&!owner.usable){
  if(owner.floating)await f.locator(`.ep-sheet[data-window-id="${owner.id}"] .ep-handle`).click();
  else {const pane=f.locator(`.ep-main .ep-pane[data-window-id="${owner.id}"]`);await pane.focus();await pane.press('Enter');}
 }
}
module.exports={reveal};
