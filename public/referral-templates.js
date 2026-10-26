export const REFERRAL_SPECIALTIES=[
  {id:'pediatria',label:'Pediatria',prompt:'Descreva o motivo clínico, sinais observados e o objetivo da avaliação pediátrica.'},
  {id:'fonoaudiologia',label:'Fonoaudiologia',prompt:'Descreva achados de sucção, deglutição, coordenação, mobilidade oral ou outros pontos que motivam a avaliação.'},
  {id:'ginecologia-obstetricia',label:'Ginecologia e Obstetrícia',prompt:'Descreva o motivo materno/obstétrico, achados relevantes e o objetivo do encaminhamento.'},
  {id:'mastologia',label:'Mastologia',prompt:'Descreva os achados mamários relevantes, evolução e o objetivo da avaliação.'},
  {id:'fisioterapia',label:'Fisioterapia',prompt:'Descreva os achados funcionais/posturais relevantes e o objetivo da avaliação.'},
  {id:'osteopatia',label:'Osteopatia',prompt:'Descreva os achados funcionais relevantes e o objetivo da avaliação.'},
  {id:'psicologia',label:'Psicologia',prompt:'Descreva o contexto emocional/psicossocial pertinente e o objetivo do acompanhamento.'},
  {id:'psiquiatria',label:'Psiquiatria',prompt:'Descreva os sinais e contexto clínico pertinentes e o objetivo da avaliação especializada.'},
  {id:'clinica-geral',label:'Clínica Geral',prompt:'Descreva o motivo clínico, achados relevantes e o objetivo da avaliação.'},
  {id:'odontologia',label:'Odontologia/Odontopediatria',prompt:'Descreva os achados orais/dentários relevantes e o objetivo da avaliação.'},
  {id:'nutricao',label:'Nutrição',prompt:'Descreva o contexto alimentar/nutricional pertinente e o objetivo da avaliação.'},
  {id:'outro',label:'Outro',prompt:'Descreva o motivo, os achados clínicos relevantes e o que se espera da avaliação.'}
];

const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();

export function getReferralSpecialty(value){
  const needle=String(value||'').trim();
  return REFERRAL_SPECIALTIES.find(item=>item.id===needle||item.label===needle)||REFERRAL_SPECIALTIES.at(-1);
}


/** Titles already used by the canonical referral templates, not user-created cards. */
export const REFERRAL_FIXED_TITLES=Object.freeze([
  'Queixa(s) em acompanhamento',
  'Motivo do encaminhamento',
  'Resumo do caso e condutas já realizadas',
  'Informação antropométrica pertinente'
]);

/** Fixed heading skeleton: no mother/baby data is included without explicit consent. */
export function buildReferralSkeleton({specialty='outro',professionalDestination=''}={}){
  const item=getReferralSpecialty(specialty);
  return {
    title:'Encaminhamento · '+item.label,
    specialty:item.id,
    specialtyLabel:item.label,
    professionalDestination:clean(professionalDestination),
    html:[
      '<p>Prezado(a) colega,</p>',
      '<p>Encaminho para sua avaliação.</p>',
      '<h2>Queixa(s) em acompanhamento</h2><p><br></p>',
      '<h2>Motivo do encaminhamento</h2><p><br></p>',
      '<h2>Resumo do caso e condutas já realizadas</h2><p><br></p>',
      '<p>Permaneço à disposição para esclarecimentos sobre o acompanhamento.</p>',
      '<p>Atenciosamente,</p>'
    ].join('\n')
  };
}

/** Existing clinical template, with the same stable titles and optional recorded facts. */
export function buildReferralDraft({
  specialty='outro',
  motherName='',
  babyName='',
  babyAge='',
  chiefComplaint='',
  careSummary='',
  weightText='',
  professionalDestination=''
}={}){
  const item=getReferralSpecialty(specialty);
  const patient=clean(motherName)||'paciente';
  const baby=clean(babyName);
  const babyContext=[baby,babyAge?('('+clean(babyAge)+')'):''].filter(Boolean).join(' ');
  const complaints=clean(chiefComplaint)||'[Descreva a queixa principal em acompanhamento.]';
  const summary=clean(careSummary)||'[Resuma avaliações, evolução e condutas já realizadas que sejam pertinentes ao encaminhamento.]';
  const weight=clean(weightText);
  const destination=clean(professionalDestination);
  const html=[
    '<p>Prezado(a) colega,</p>',
    '<p>Encaminho para sua avaliação <strong>'+esc(patient)+'</strong>'+
      (babyContext?', em acompanhamento de consultoria em amamentação com <strong>'+esc(babyContext)+'</strong>':' em acompanhamento de consultoria em amamentação')+'.</p>',
    '<h2>Queixa(s) em acompanhamento</h2><p>'+esc(complaints)+'</p>',
    weight?'<h2>Informação antropométrica pertinente</h2><p>'+esc(weight)+'</p>':'',
    '<h2>Motivo do encaminhamento</h2><p>['+esc(item.prompt)+']</p>',
    '<h2>Resumo do caso e condutas já realizadas</h2><p>'+esc(summary)+'</p>',
    '<p>Permaneço à disposição para troca de informações sobre o caso e agradeço desde já a atenção dispensada à paciente.</p>',
    '<p>Atenciosamente,</p>'
  ].filter(Boolean).join('\n');
  return {title:'Encaminhamento · '+item.label,specialty:item.id,specialtyLabel:item.label,professionalDestination:destination,html};
}
