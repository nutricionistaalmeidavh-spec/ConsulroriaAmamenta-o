// Local canvas, no external assets or paid dependency. Name entry is also available for accessibility.
export function createSignatureControl({placeholder='Nome completo'}={}){
  const root=document.createElement('section');
  root.className='ds-signature-control';
  root.innerHTML=`<label class="ds-field">Nome completo de quem assina
    <input data-full-name autocomplete="name" maxlength="130" placeholder="${placeholder}" required>
  </label>
  <fieldset class="ds-methods"><legend>Como deseja assinar?</legend>
    <label><input type="radio" name="signature-mode-${crypto.randomUUID()}" value="drawn" checked> Desenhar com o dedo</label>
    <label><input type="radio" data-typed-radio value="typed"> Digitar meu nome</label>
  </fieldset>
  <div data-drawing><canvas width="560" height="180" aria-label="Área para desenhar assinatura com o dedo ou mouse"></canvas>
    <button type="button" data-clear>Limpar assinatura</button></div>
  <p data-typed hidden>Seu nome digitado acima será registrado como manifestação de assinatura eletrônica.</p>
  <label class="ds-checkbox"><input type="checkbox" data-read> Li o documento integral disponibilizado acima.</label>
  <label class="ds-checkbox"><input type="checkbox" data-accept> Concordo com o documento e confirmo minha assinatura eletrônica.</label>`;
  const radios=[...root.querySelectorAll('input[type="radio"]')],drawing=root.querySelector('[data-drawing]');
  const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d');
  ctx.strokeStyle='#382d3b';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';
  let drawingActive=false,drawn=false;
  const mode=()=>radios.find(x=>x.checked)?.value||'drawn';
  // Radios share a generated group name so other signature dialogs remain independent.
  radios[1].name=radios[0].name;
  radios.forEach(r=>r.addEventListener('change',()=>{
    drawing.hidden=mode()!=='drawn';root.querySelector('[data-typed]').hidden=mode()!=='typed';
  }));
  const position=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height}};
  canvas.style.touchAction='none';
  canvas.addEventListener('pointerdown',e=>{drawingActive=true;canvas.setPointerCapture?.(e.pointerId);const p=position(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.2,p.y+.2);ctx.stroke();drawn=true});
  canvas.addEventListener('pointermove',e=>{if(!drawingActive)return;const p=position(e);ctx.lineTo(p.x,p.y);ctx.stroke()});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{drawingActive=false});
  root.querySelector('[data-clear]').addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);drawn=false});
  return {element:root,payload(){
    const full_name=root.querySelector('[data-full-name]').value.trim().replace(/\s+/g,' ');
    if(!full_name)throw Error('Informe seu nome completo.');
    if(!root.querySelector('[data-read]').checked||!root.querySelector('[data-accept]').checked)throw Error('Leia e aceite o documento antes de assinar.');
    if(mode()==='drawn'&&!drawn)throw Error('Desenhe sua assinatura ou escolha digitar o nome.');
    return {full_name,accepted:true,read_document:true,
      signature_mode:mode(),signature_value:mode()==='typed'?full_name:canvas.toDataURL('image/png')};
  }};
}
