/**
 * Private mother-only experience; UI is not the authorization boundary.
 * No AI calls are made until user submits. Messages remain in memory unless
 * "Salvar histórico" is selected. Never persist sensitive chat to localStorage.
 */
const esc = x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const approvedUrl = url=>{try{const u=new URL(url);return u.protocol==='https:'?u.href:null}catch{return null}};
const date = x=>{try{return new Date(x).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}catch{return ''}};
const text = (s)=>String(s??'').trim();
function messageMarkup(item){
  const sources=(item.sources||[]).slice(0,3).map(x=>({title:x.title,url:approvedUrl(x.url)}))
    .filter(x=>x.url).map(x=>'<a target="_blank" rel="noopener noreferrer" href="'+esc(x.url)+'">'+esc(x.title)+'</a>').join('');
  const references=(item.orientations||[]).slice(0,3).map(x=>
    '<details class="mai-orientation"><summary>'+esc(x.title)+' · orientação da consultora</summary><p>'+esc(x.body).replace(/\n/g,'<br>')+'</p></details>').join('');
  const saved=Boolean(item.id);
  return '<article class="mai-turn" data-turn="'+esc(item.id||'temporary')+'">'+
    '<div class="mai-question"><span>Sua pergunta</span><p>'+esc(item.question)+'</p></div>'+
    '<div class="mai-answer"><span>Assistente de Amamentação · '+(item.model_used?'resposta educativa por IA':'referências revisadas')+'</span>'+
    '<p>'+esc(item.answer).replace(/\n/g,'<br>')+'</p>'+
    (sources?'<div class="mai-sources"><strong>Fontes:</strong> '+sources+'</div>':'')+
    references+'</div>'+
    '<div class="mai-turn-actions">'+
    (saved?
      '<button type="button" data-mai-feedback="helpful" data-id="'+esc(item.id)+'" aria-label="Resposta útil">Útil'+(item.feedback==='helpful'?' ✓':'')+'</button>'+
      '<button type="button" data-mai-feedback="not_helpful" data-id="'+esc(item.id)+'" aria-label="Resposta não útil">Não ajudou'+(item.feedback==='not_helpful'?' ✓':'')+'</button>'+
      '<button type="button" data-mai-share="'+esc(item.id)+'">'+(item.shared?'Retirar da consultora':'Enviar à consultora')+'</button>'
      :'<span class="mai-ephemeral">Conversa temporária · não salva</span>')+
    '</div></article>';
}
export async function mountMotherAiChat(host,{getSession}={}){
  if(!host||typeof getSession!=='function')return;
  const state={config:null,turns:[],pending:false,orient:false,save:false,consent:false,contextConsent:false};
  async function api(path,options={}){
    const session=await getSession();
    if(!session?.access_token)throw new Error('Sessão expirada. Entre novamente.');
    const resp=await fetch(path,{cache:'no-store',...options,headers:{
      'Authorization':'Bearer '+session.access_token,
      ...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})
    }});
    const json=await resp.json().catch(()=>({}));
    if(!resp.ok)throw new Error(json.message||'Não foi possível concluir. Código '+resp.status);
    return json;
  }
  function status(message,kind='info'){
    const el=host.querySelector('#mai-status');if(el){el.textContent=message;el.dataset.kind=kind}
  }
  function updateConversation(){
    const el=host.querySelector('#mai-history');if(!el)return;
    el.innerHTML=state.turns.length?state.turns.map(messageMarkup).join('')
      :'<div class="mai-empty">Sua conversa aparecerá aqui. Nenhuma pergunta foi enviada.</div>';
    el.querySelectorAll('[data-mai-feedback]').forEach(button=>button.onclick=async()=>{
      button.disabled=true;
      try{
        const result=await api('/api/member/ai/history/'+encodeURIComponent(button.dataset.id)+'/feedback',{
          method:'PATCH',body:JSON.stringify({feedback:button.dataset.maiFeedback})
        });
        state.turns=state.turns.map(x=>x.id===result.id?{...x,feedback:result.feedback}:x);
        updateConversation();status('Avaliação registrada.','success');
      }catch(e){status(e.message,'error');button.disabled=false}
    });
    el.querySelectorAll('[data-mai-share]').forEach(button=>button.onclick=async()=>{
      const id=button.dataset.maiShare,original=state.turns.find(x=>x.id===id);
      if(!original)return;
      const sharing=!original.shared;
      const question=sharing
        ?'Enviar esta pergunta e resposta à sua consultora? Ela poderá ler esse conteúdo na Área das Mães.'
        :'Retirar o acesso da consultora? Ela não poderá mais abrir esse conteúdo no painel.';
      if(!window.confirm(question))return;
      button.disabled=true;
      try{
        const result=sharing
          ?await api('/api/member/ai/shares',{method:'POST',body:JSON.stringify({message_id:id,confirm_share:true})})
          :await api('/api/member/ai/shares/'+encodeURIComponent(id),{method:'DELETE'});
        state.turns=state.turns.map(x=>x.id===id?{...x,shared:result.shared}:x);
        updateConversation();status(sharing?'Enviado para a área da consultora.':'Acesso da consultora retirado.','success');
      }catch(e){status(e.message,'error');button.disabled=false}
    });
  }
  function render(){
    host.hidden=false;
    const c=state.config;
    host.innerHTML='<div class="mai-shell"><details id="mai-expander" class="mai-expander">'+
      '<summary class="mai-entry"><span class="mai-entry-icon" aria-hidden="true">♡</span><span><strong>Assistente de Amamentação</strong><small>Tire dúvidas com orientações revisadas</small></span><span class="mai-chevron" aria-hidden="true">⌄</span></summary>'+
      '<div class="mai-content"><p class="mai-disclaimer">Assistente virtual educativo. Não substitui sua consultora, diagnóstico ou atendimento de urgência.</p>'+
      '<div id="mai-history" class="mai-history" aria-label="Histórico de perguntas"></div>'+
      '<form id="mai-form"><label for="mai-question">Qual é sua dúvida?</label>'+
      '<textarea id="mai-question" maxlength="500" rows="3" placeholder="Ex.: como melhorar a pega?" required></textarea>'+
      '<div class="mai-suggestions"><button type="button" data-suggest="Como saber se a pega está adequada?">Pega adequada</button>'+
      '<button type="button" data-suggest="O que é livre demanda?">Livre demanda</button>'+
      '<button type="button" data-suggest="Pode me explicar minhas orientações da semana?">Minhas orientações</button></div>'+
      '<label class="mai-check"><input type="checkbox" id="mai-orient"> Considerar orientações já liberadas pela minha consultora</label>'+
      '<label class="mai-check"><input type="checkbox" id="mai-save"> Salvar pergunta e resposta por até 30 dias</label>'+
      (c.inference_enabled?
        '<label class="mai-check"><input type="checkbox" id="mai-consent"> Autorizo o processamento desta pergunta pela IA</label>'+
        '<label class="mai-check"><input type="checkbox" id="mai-context-consent" disabled> Também autorizo usar minhas orientações publicadas na resposta da IA</label>'
        :'<p class="mai-reference-mode">Modo sem inferência: apenas referências oficiais e orientações já publicadas; nenhuma chamada ao modelo.</p>')+
      '<div class="mai-form-footer"><p id="mai-status" role="status" aria-live="polite"></p>'+
      '<button type="submit" id="mai-send" class="mai-primary">Enviar pergunta</button></div></form>'+
      '<div class="mai-privacy"><span>Suas conversas não são enviadas à consultora automaticamente.</span>'+
      '<button type="button" id="mai-clear">Apagar meu histórico</button></div></div></details></div>';
    const checkbox=(selector,key)=>{const element=host.querySelector(selector);if(element){element.checked=state[key];element.onchange=()=>{state[key]=element.checked;
      if(key==='orient'){const el=host.querySelector('#mai-context-consent');if(el){el.disabled=!element.checked;if(!element.checked){el.checked=false;state.contextConsent=false}}}
    }}};
    checkbox('#mai-orient','orient');checkbox('#mai-save','save');checkbox('#mai-consent','consent');checkbox('#mai-context-consent','contextConsent');
    host.querySelectorAll('[data-suggest]').forEach(b=>b.onclick=()=>{
      host.querySelector('#mai-question').value=b.dataset.suggest;host.querySelector('#mai-question').focus();
    });
    host.querySelector('#mai-clear').onclick=async()=>{
      if(!window.confirm('Apagar todo o histórico? Isso também retira as mensagens que você enviou à consultora.'))return;
      const button=host.querySelector('#mai-clear');button.disabled=true;
      try{
        await api('/api/member/ai/history',{method:'DELETE'});
        state.turns=[];updateConversation();status('Histórico apagado; acesso da consultora retirado.','success');
      }catch(error){status(error.message,'error')}finally{button.disabled=false}
    };
    host.querySelector('#mai-form').onsubmit=async event=>{
      event.preventDefault();if(state.pending)return;
      const area=host.querySelector('#mai-question'),question=text(area.value);
      if(question.length<4){status('Escreva uma pergunta com pelo menos quatro caracteres.','error');return}
      state.pending=true;
      const button=host.querySelector('#mai-send');button.disabled=true;button.textContent='Consultando…';status('Buscando orientações…');
      try{
        const data=await api('/api/member/ai/chat',{method:'POST',body:JSON.stringify({
          message:question,include_my_orientations:state.orient,save_to_history:state.save,
          consent_to_ai_processing:state.consent,consent_to_clinical_context:state.contextConsent
        })});
        state.turns.unshift({
          id:data.message_id||null,question,answer:data.answer,classification:data.classification,
          sources:data.sources,orientations:data.orientations,model_used:data.model_used,
          shared:false,created_at:new Date().toISOString(),feedback:null
        });
        state.turns=state.turns.slice(0,30);updateConversation();area.value='';
        status(data.history_saved===false
          ?(data.history_error||'Resposta recebida, mas não foi possível salvar no histórico.')
          :'Resposta recebida.' ,data.history_saved===false?'error':'success');
      }catch(error){status(error.message+' A pergunta foi mantida para nova tentativa.','error')}
      finally{state.pending=false;button.disabled=false;button.textContent='Enviar pergunta'}
    };
    updateConversation();
  }
  try{
    const config=await api('/api/member/ai/config');
    if(config.enabled!==true){host.hidden=true;return}
    state.config=config;render();
    try{
      const history=await api('/api/member/ai/history');
      state.turns=history.items||[];updateConversation();
    }catch(error){status('Histórico indisponível. Você ainda pode perguntar sem salvá-lo.','error')}
  }catch{host.hidden=true}
}
/** Consultant sees only mother-initiated shared records, never private messages. */
export async function mountMotherAiConsultantInbox(host,{motherId,getToken}={}){
  if(!host||!motherId||!getToken)return;
  host.textContent='Carregando perguntas recebidas…';
  try{
    const token=getToken();if(!token){host.textContent='Sessão profissional indisponível.';return}
    const response=await fetch('/api/member/ai/consultant/shares?mother_id='+encodeURIComponent(motherId),{
      cache:'no-store',headers:{Authorization:'Bearer '+token}});
    if(response.status===403){host.textContent='Nenhuma pergunta compartilhada com este acesso.';return}
    if(!response.ok){host.textContent='Não foi possível consultar as mensagens agora.';return}
    const result=await response.json(),items=result.items||[];
    host.innerHTML=items.length?items.map(item=>
      '<article class="mai-consultant-message"><small>'+esc(date(item.shared_at))+'</small>'+
      '<strong>'+esc(item.question)+'</strong><p>'+esc(item.answer)+'</p>'+
      '<small>Enviado voluntariamente pela mãe · conteúdo educativo, não substitui prontuário</small></article>'
    ).join(''):'<div class="mf-empty">Nenhuma pergunta foi compartilhada pela mãe.</div>';
  }catch{host.textContent='Não foi possível carregar as mensagens.'}
}