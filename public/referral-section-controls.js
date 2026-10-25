/**
 * Section organizer for the existing contenteditable editor.
 * H2 starts a card. Another H2 or HR ends it. All content remains authored HTML.
 * Up/down controls work on touchscreens and with a keyboard; no drag library.
 */
export function referralSections(editor){
  const nodes=Array.from(editor.children),out=[];let current=null;
  for(const node of nodes){
    if(node.tagName==='H2'){
      current={heading:node,nodes:[node],title:(node.textContent||'').trim()||'Seção sem título'};
      out.push(current);
    }else if(current){
      current.nodes.push(node);
      if(node.tagName==='HR')current=null;
    }
  }
  return out;
}
export function wireReferralSectionOrganizer(panel,editor){
  const picker=panel.querySelector('[data-rf-select-section]');
  const add=panel.querySelector('[data-rf-add-section]');
  const up=panel.querySelector('[data-rf-move-up]');
  const down=panel.querySelector('[data-rf-move-down]');
  const remove=panel.querySelector('[data-rf-delete-section]');
  if(!picker||!add||!up||!down||!remove)return;
  let selected=null;
  function refresh(){
    const sections=referralSections(editor);
    if(!selected||!sections.some(group=>group.heading===selected))selected=sections[0]?.heading||null;
    const index=sections.findIndex(group=>group.heading===selected);
    picker.replaceChildren();
    for(let i=0;i<sections.length;i++){
      const option=document.createElement('option');
      option.value=String(i);option.textContent=(i+1)+'. '+sections[i].title;
      picker.appendChild(option);
    }
    if(index>=0)picker.value=String(index);
    picker.disabled=remove.disabled=index<0;
    up.disabled=index<=0;down.disabled=index<0||index===sections.length-1;
  }
  picker.addEventListener('change',()=>{selected=referralSections(editor)[Number(picker.value)]?.heading||null;refresh()});
  add.addEventListener('click',()=>{
    const heading=document.createElement('h2');
    heading.appendChild(document.createElement('br'));
    const paragraph=document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    editor.append(heading,paragraph);
    selected=heading;refresh();
    heading.focus?.();
    const selection=window.getSelection(),range=document.createRange();
    range.selectNodeContents(heading);range.collapse(true);
    selection.removeAllRanges();selection.addRange(range);editor.focus();
  });
  up.addEventListener('click',()=>{
    const sections=referralSections(editor),index=sections.findIndex(group=>group.heading===selected);
    if(index<1)return;
    const earlier=sections[index-1];
    const fragment=document.createDocumentFragment();
    for(const node of sections[index].nodes)fragment.appendChild(node);
    editor.insertBefore(fragment,earlier.nodes[0]);
    refresh();
  });
  down.addEventListener('click',()=>{
    const sections=referralSections(editor),index=sections.findIndex(group=>group.heading===selected);
    if(index<0||index>=sections.length-1)return;
    const after=sections[index+1];
    const fragment=document.createDocumentFragment();
    for(const node of after.nodes)fragment.appendChild(node);
    editor.insertBefore(fragment,sections[index].nodes[0]);
    refresh();
  });
  remove.addEventListener('click',()=>{
    const sections=referralSections(editor),group=sections.find(g=>g.heading===selected);
    if(!group)return;
    if(!window.confirm('Excluir esta seção e todo o conteúdo dela?'))return;
    group.nodes.forEach(node=>node.remove());selected=null;refresh();
  });
  editor.addEventListener('input',refresh);
  refresh();
}
