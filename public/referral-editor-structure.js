/**
 * Phase 0-2: read-only choices for explicitly inserting recorded patient facts.
 * No persistence or API calls: the referral editor already resolves tenant-scoped
 * mother, baby and encounter records via DeboraDocuments.
 */
export const REFERRAL_EDITOR_BLOCKS = Object.freeze([
  {id:'paragraph', label:'Texto normal', tag:'P'},
  {id:'section', label:'Título de seção', tag:'H2'},
  {id:'subheading', label:'Subtítulo', tag:'H3'},
  {id:'end-section', label:'Encerrar seção', tag:'HR'},
]);

const text=value=>(typeof value==='string'||typeof value==='number')?String(value).trim():'';
const maybe=value=>{const s=text(value);return s&&s!=='null'&&s!=='undefined'?s:''};
const localDate=value=>{
  const str=maybe(value);
  const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if(!match)return '';
  const [,year,month,day]=match;
  const valid=new Date(Date.UTC(+year,+month-1,+day));
  if(valid.getUTCFullYear()!==+year||valid.getUTCMonth()!==+month-1||valid.getUTCDate()!==+day)return '';
  return [day,month,year].join('/');
};
const grams=value=>{
  const n=Number(value);
  return Number.isFinite(n)&&n>0?Math.round(n).toLocaleString('pt-BR')+' g':'';
};
const recordedClinical=value=>{
  const direct=maybe(value);
  if(direct)return direct;
  if(!value||typeof value!=='object')return '';
  // Prefer free-text clinically authored fields. Do not flatten arbitrary IDs,
  // booleans, option codes or metadata into the document.
  for(const key of ['notes','note','observations','observation','description','text','instructions','summary','complaint','reason','objectives']){
    const found=maybe(value[key]);if(found)return found;
  }
  return '';
};

export function getInsertableReferralFields({context={},baby=null,encounter=null}={}){
  const mother=context?.mother||{};
  const fields=[];
  const add=(id,group,label,raw)=>{
    const value=maybe(raw);
    if(value)fields.push({id,group,label,value});
  };

  add('mother.name','Mãe','Nome completo',mother.name);
  add('mother.birth_date','Mãe','Data de nascimento',localDate(mother.birth_date));
  add('mother.phone','Mãe','Telefone',mother.phone);
  add('mother.email','Mãe','E-mail',mother.email);
  add('mother.cpf','Mãe','CPF',mother.cpf);
  add('mother.address','Mãe','Endereço',mother.address);

  const babies=Array.isArray(context?.babies)?context.babies:[];
  const linkedBaby=Boolean(baby?.id&&babies.some(row=>row.id===baby.id));
  if(linkedBaby){
    add('baby.name','Bebê','Nome do bebê',baby.name);
    add('baby.birth_date','Bebê','Data de nascimento',localDate(baby.birth_date));
    add('baby.weight','Bebê','Peso atual registrado',grams(baby.current_weight_g));
    add('baby.birth_weight','Bebê','Peso ao nascer',grams(baby.birth_weight_g));
    add('baby.gestational_age','Bebê','Idade gestacional',baby.gestational_age);
    add('baby.feeding','Bebê','Alimentação registrada',baby.feeding);
  }
  // A record may also be linked through clinical_encounter_babies; latestEncounter
  // validates that relationship. Never accept an explicit different baby/mother.
  const sameMother=Boolean(mother.id&&encounter?.mother_id===mother.id);
  const sameBaby=(!encounter?.baby_id||Boolean(linkedBaby&&encounter.baby_id===baby.id));
  if(sameMother&&sameBaby){
    add('encounter.date','Atendimento','Data do atendimento',localDate(encounter.occurred_at));
    add('encounter.complaint','Atendimento','Queixa principal',recordedClinical(encounter.chief_complaint));
    add('encounter.care','Atendimento','Orientações e condutas registradas',recordedClinical(encounter.care_plan));
    add('encounter.note','Atendimento','Evolução registrada',recordedClinical(encounter.clinical_note));
  }
  return fields;
}
