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
  const babyContext=[baby,babyAge?`(${clean(babyAge)})`:''].filter(Boolean).join(' ');
  const complaints=clean(chiefComplaint)||'[Descreva a queixa principal em acompanhamento.]';
  const summary=clean(careSummary)||'[Resuma avaliações, evolução e condutas já realizadas que sejam pertinentes ao encaminhamento.]';
  const weight=clean(weightText);
  const destination=clean(professionalDestination);
  const title=`Encaminhamento · ${item.label}`;
  const html=[
    `<p><strong>ENCAMINHAMENTO — ${esc(item.label.toUpperCase())}</strong></p>`,
    destination?`<p><strong>Destino:</strong> ${esc(destination)}</p>`:'',
    '<p>Prezado(a) colega,</p>',
    `<p>Encaminho para sua avaliação <strong>${esc(patient)}</strong>${babyContext?`, em acompanhamento de consultoria em amamentação com <strong>${esc(babyContext)}</strong>`:' em acompanhamento de consultoria em amamentação'}.</p>`,
    `<p><strong>Queixa(s) em acompanhamento:</strong><br>${esc(complaints)}</p>`,
    weight?`<p><strong>Informação antropométrica pertinente:</strong><br>${esc(weight)}</p>`:'',
    `<p><strong>Motivo do encaminhamento:</strong><br>[${esc(item.prompt)}]</p>`,
    `<p><strong>Resumo do caso e condutas já realizadas:</strong><br>${esc(summary)}</p>`,
    '<p>Permaneço à disposição para troca de informações sobre o caso e agradeço desde já a atenção dispensada à paciente.</p>',
    '<p>Atenciosamente,</p>'
  ].filter(Boolean).join('\n');
  return {title,specialty:item.id,specialtyLabel:item.label,professionalDestination:destination,html};
}
