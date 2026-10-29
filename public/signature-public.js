import {createSignatureControl} from './signature-canvas.js';
const status=document.getElementById('status'),panel=document.getElementById('signature-main'),form=document.getElementById('signature-form');
const params=new URL(location.href).searchParams;
const token=params.get('token')||'';
history.replaceState(null,'',location.pathname);
let objectUrl='';
function announce(message,error=false){status.hidden=false;status.textContent=message;status.style.borderColor=error?'#b44055':'#e7d9e1'}
async function api(path,{method='GET',body=null,format='json'}={}){
  const response=await fetch('/api/signatures/recipient'+path,{method,headers:{'x-signature-token':token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}) ,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error==='signature_link_invalid_or_expired'?'Este link expirou ou já foi utilizado. Solicite um novo à consultora.':error.error||'Não foi possível continuar.')}
  return format==='blob'?response.blob():response.json();
}
async function start(){
  if(!/^[a-f0-9]{64}$/.test(token)){announce('Link inválido. Solicite um novo à consultora.',true);return}
  try{
    const info=await api('');
    document.getElementById('doc-title').textContent=info.title;
    document.getElementById('expiry').textContent='Disponível até '+new Date(info.expires_at).toLocaleString('pt-BR');
    const blob=await api('/document',{format:'blob'});
    objectUrl=URL.createObjectURL(blob);document.getElementById('pdf-frame').src=objectUrl;
    const control=createSignatureControl({placeholder:'Digite o mesmo nome do cadastro'});
    document.getElementById('signature-control').append(control.element);
    status.hidden=true;panel.hidden=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=document.getElementById('submit-signature');
      let payload;try{payload=control.payload()}catch(e){announce(e.message,true);return}
      button.disabled=true;announce('Registrando sua assinatura…');
      try{
        const result=await api('/sign',{method:'POST',body:payload});
        panel.hidden=true;announce(result.status==='mother_signed'?'Assinatura registrada. O documento foi encaminhado para assinatura da consultora.':'Documento assinado com sucesso.');
      }catch(e){announce(e.message,true)}finally{button.disabled=false}
    });
  }catch(e){panel.hidden=true;announce(e.message,true)}
}
window.addEventListener('pagehide',()=>{if(objectUrl)URL.revokeObjectURL(objectUrl)});
start();
