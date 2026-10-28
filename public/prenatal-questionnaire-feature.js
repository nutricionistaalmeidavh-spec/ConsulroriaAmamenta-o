// Questionário pré-natal aprovado: textos e ordem são parte do contrato clínico.
export const PRENATAL_QUESTIONS = Object.freeze([
  {number:1,key:'returnToWork',title:'Retorno ao trabalho',prompt:'Você pretende retornar ao trabalho após a licença-maternidade? Se sim, quando está previsto seu retorno?',type:'textarea',step:2},
  {number:2,key:'address',title:'Endereço',prompt:'Qual é o seu endereço completo?',type:'textarea',step:2},
  {number:3,key:'babyName',title:'Nome do bebê',prompt:'Qual é o nome do seu bebê?',type:'text',step:2},
  {number:4,key:'obstetricTeam',title:'Equipe obstétrica',prompt:'Quem compõe sua equipe obstétrica? (Obstetra, obstetriz, doula e outros profissionais.)',type:'textarea',step:3},
  {number:5,key:'maternalConditions',title:'Doenças preexistentes ou durante a gestação',prompt:'Você possui alguma doença preexistente ou apresentou alguma condição de saúde durante a gestação? Se sim, qual(is)?',type:'textarea',step:3},
  {number:6,key:'depressionHistory',title:'Histórico de depressão',prompt:'Você já teve depressão ou apresenta depressão atualmente?',type:'yesno',step:3},
  {number:7,key:'medications',title:'Uso de medicamentos',prompt:'Você faz uso de algum medicamento atualmente? Se sim, informe o nome e a dosagem.',type:'textarea',step:3},
  {number:8,key:'breastSurgeries',title:'Cirurgias nas mamas',prompt:'Você já realizou alguma cirurgia nas mamas? Se sim, informe qual procedimento foi realizado e em que ano.',type:'textarea',step:3},
  {number:9,key:'breastChanges',title:'Mudanças nas mamas durante a gestação',prompt:'Você percebeu mudanças nas mamas durante a gestação, como aumento do volume, sensibilidade, escurecimento das aréolas ou outras alterações?',type:'yesno',step:3},
  {number:10,key:'expectedBirth',title:'Previsão de nascimento',prompt:'Qual é a data prevista para o nascimento do bebê?',type:'date',step:4},
  {number:11,key:'pregnancyHistory',title:'Histórico gestacional',prompt:'Esta é sua primeira gestação? Se não, conte um pouco sobre suas gestações anteriores, incluindo eventuais intercorrências.',type:'textarea',step:4},
  {number:12,key:'previousBreastfeeding',title:'Experiência prévia com amamentação',prompt:'Você já amamentou anteriormente? Se sim, conte um pouco sobre suas experiências, incluindo dificuldades, desafios e aspectos positivos.',type:'textarea',step:4},
  {number:13,key:'expectations',title:'Expectativas com o pré-natal de amamentação',prompt:'Quais são suas expectativas em relação ao acompanhamento pré-natal de amamentação? Existe alguma dúvida, preocupação ou dificuldade que você gostaria de abordar?',type:'textarea',step:4},
  {number:14,key:'howFoundNana',title:'Como conheceu a Nana Neném?',prompt:'Como você conheceu a Nana Neném?',type:'textarea',step:5},
  {number:15,key:'whyChooseConsultancy',title:'Escolha da consultora de amamentação',prompt:'O que foi decisivo para você escolher a minha consultoria de amamentação?',type:'textarea',step:5},
  {number:16,key:'declaration',title:'Declaração de veracidade das informações',prompt:'Declaro que todas as informações fornecidas nesta ficha de anamnese são verdadeiras.',type:'checkbox',step:6,affirmative:'Sim'},
  {number:17,key:'consultationAuthorization',title:'Autorização para realização da consulta e compartilhamento de informações',prompt:'Autorizo a realização da consulta de amamentação e o compartilhamento das informações pertinentes com a equipe multidisciplinar responsável pelo meu acompanhamento, quando necessário para promover a saúde e o bem-estar meus e do bebê.',type:'checkbox',step:6,affirmative:'Autorizo'}
]);

export function isPrenatal(type='') {
  return String(type).trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase() === 'pre-natal';
}
export function parsePrenatalAnswers(input='') {
  if (typeof input==='object' && input!==null && !Array.isArray(input)) return {...input};
  try {
    const parsed = JSON.parse(String(input||''));
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function serializePrenatalAnswers(answers={}) {
  const safe = {};
  for (const question of PRENATAL_QUESTIONS) {
    const value = answers?.[question.key];
    safe[question.key] = question.type==='checkbox' ? value===true
      : typeof value==='string' ? value : '';
  }
  return JSON.stringify(safe);
}

if (typeof window!=='undefined' && typeof document!=='undefined') {
  const steps = [
    [2,'Informações iniciais'],[3,'Histórico e saúde'],[4,'Gestação e expectativas'],
    [5,'Origem do atendimento'],[6,'Declarações e autorização']
  ];
  const escapeHTML = value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let previousSnapshot=null;
  let mountedOn=null;
  let timer=null;

  function questionMarkup(item) {
    const id='pn-answer-'+item.number;
    let control='';
    if (item.type==='checkbox') {
      control=`<label class="pn-affirmative"><input type="checkbox" data-prenatal-answer="${item.key}" aria-label="${escapeHTML(item.affirmative)}"><span>${escapeHTML(item.affirmative)}</span></label>`;
    } else if (item.type==='yesno') {
      control=`<select id="${id}" data-prenatal-answer="${item.key}"><option value="">Selecione</option><option>Sim</option><option>Não</option></select>`;
    } else if (item.type==='date' || item.type==='text') {
      control=`<input id="${id}" type="${item.type}" data-prenatal-answer="${item.key}" autocomplete="off">`;
    } else {
      control=`<textarea id="${id}" rows="3" data-prenatal-answer="${item.key}"></textarea>`;
    }
    return `<section class="pn-question" data-prenatal-number="${item.number}"><strong>${item.number}. ${escapeHTML(item.title)}</strong><label${item.type==='checkbox'?'':` for="${id}"` } class="pn-question-label">${escapeHTML(item.prompt)}</label>${control}</section>`;
  }

  function ensureStyle() {
    if (document.querySelector('style[data-prenatal-style]')) return;
    const style=document.createElement('style');
    style.dataset.prenatalStyle='';
    style.textContent=`
      .appointment-screen[data-prenatal-mode="true"] [data-baby-target-field] {display:none!important}
      .appointment-screen .wizard-card [data-prenatal-form] {display:none}
      .appointment-screen[data-prenatal-mode="true"] .wizard-card[data-prenatal-active="true"] > :not([data-prenatal-form]) {display:none!important}
      .appointment-screen[data-prenatal-mode="true"] .wizard-card[data-prenatal-active="true"] > [data-prenatal-form] {display:block!important}
      [data-prenatal-form] {width:100%}
      .pn-question {padding:14px 0;border-bottom:1px solid var(--border,#e8e5e9);display:grid;gap:9px}
      .pn-question strong {font-size:0.95rem}
      .pn-question-label {font-size:0.92rem;line-height:1.5}
      .pn-question input:not([type="checkbox"]),.pn-question textarea,.pn-question select {box-sizing:border-box;display:block;width:100%;min-height:42px;border:1px solid var(--border,#d8d2dc);border-radius:10px;padding:10px;background:var(--surface,#fff);color:inherit;font:inherit}
      .pn-question textarea {resize:vertical;min-height:80px}
      .pn-affirmative {display:flex;align-items:center;gap:10px;cursor:pointer}
      .pn-affirmative input {width:19px;height:19px}
      .pn-notice {font-size:0.84rem;line-height:1.5;color:var(--text-muted,#59535d)}
    `;
    document.head.appendChild(style);
  }
  function getScreen() {return document.querySelector('[data-screen="appointment"]')}
  function activeType() {return document.querySelector('[data-encounter-choice][data-section="identification"][data-field="appointmentType"][aria-pressed="true"]')?.dataset.value||''}
  function getHidden() {return getScreen()?.querySelector('[data-encounter-field="prenatalAnswers"]')}
  function answersFromControls() {
    const root=getScreen();
    const answers={};
    for (const q of PRENATAL_QUESTIONS) {
      const control=root?.querySelector(`[data-prenatal-answer="${q.key}"]`);
      answers[q.key]=q.type==='checkbox' ? Boolean(control?.checked) : String(control?.value||'');
    }
    return answers;
  }
  function hydrate(raw) {
    const root=getScreen();
    const answers=parsePrenatalAnswers(raw);
    for (const q of PRENATAL_QUESTIONS) {
      const control=root?.querySelector(`[data-prenatal-answer="${q.key}"]`);
      if (!control) continue;
      if (q.type==='checkbox') control.checked=answers[q.key]===true;
      else control.value=String(answers[q.key]||'');
    }
    // Address is a patient attribute, but the prenatal response is a point-in-time answer.
    if (!raw) {
      const address=root?.querySelector('[data-prenatal-answer="address"]');
      const patientId=root?.querySelector('[data-appointment-patient]')?.value;
      const patientAddress=root?.querySelector('[data-appointment-patient] option:checked')?.dataset.address;
      if (address && patientAddress && patientId) address.value=patientAddress;
    }
    previousSnapshot=String(raw||'');
  }
  function mount() {
    const screen=getScreen();
    if (!screen) return;
    if (mountedOn===screen && getHidden()) return;
    ensureStyle();
    for (const [step,title] of steps) {
      const card=screen.querySelector(`[data-wizard-step="${step}"]`);
      if (!card || card.querySelector('[data-prenatal-form]')) continue;
      const panel=document.createElement('div');
      panel.dataset.prenatalForm=String(step);
      panel.innerHTML=`<span class="section-kicker">PRÉ-NATAL · ETAPA ${step}</span><h2>${escapeHTML(title)}</h2>${PRENATAL_QUESTIONS.filter(q=>q.step===step).map(questionMarkup).join('')}${step===6?'<p class="pn-notice">Esta autorização é independente e não realiza compartilhamento automático de dados ou documentos. A ausência de autorização não impede o registro de um rascunho.</p>':''}`;
      if (step===2) panel.insertAdjacentHTML('beforeend','<input type="hidden" data-encounter-field="prenatalAnswers" data-section="maternal_assessment">');
      card.appendChild(panel);
    }
    mountedOn=screen;
    previousSnapshot=null;
  }
  function refresh() {
    const screen=getScreen();
    if (!screen) return;
    mount();
    const prenatal=isPrenatal(activeType());
    if (screen.dataset.prenatalMode!==String(prenatal)) screen.dataset.prenatalMode=String(prenatal);
    for (const [step] of steps) {
      const card=screen.querySelector(`[data-wizard-step="${step}"]`);
      if (card && card.dataset.prenatalActive!==String(prenatal)) card.dataset.prenatalActive=String(prenatal);
    }
    const hidden=getHidden();
    if (hidden && String(hidden.value||'')!==previousSnapshot) hydrate(hidden.value);
  }
  function sync() {
    const hidden=getHidden();
    if (!hidden || !isPrenatal(activeType())) return;
    const json=serializePrenatalAnswers(answersFromControls());
    hidden.value=json;
    previousSnapshot=json;
    hidden.dispatchEvent(new Event('input',{bubbles:true}));
  }

  document.addEventListener('input',event=>{
    if(event.target?.matches?.('[data-prenatal-answer]')) sync();
  },true);
  document.addEventListener('change',event=>{
    if(event.target?.matches?.('[data-prenatal-answer]')) sync();
    if(event.target?.matches?.('[data-appointment-patient]')) previousSnapshot=null;
  },true);
  document.addEventListener('click',event=>{
    if(event.target.closest?.('[data-encounter-choice][data-field="appointmentType"]')) setTimeout(refresh,0);
  },true);
  new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(refresh,45)}).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>setTimeout(refresh,0));
  refresh();
}
