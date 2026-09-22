import { pbkdf2Sync, randomBytes } from 'node:crypto';

export const DEMO_EMAIL = 'demonstracao@deboralactacao.com';
export const DEMO_USER_ID = '3e1a72f7-0c6e-4f47-b4d8-3b931fc8d001';
export const DEMO_PASSWORD_ITERATIONS = 100000;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_demo_fixture_date');
  return date;
}

function isoAt(base, days = 0, hours = 0) {
  return new Date(base.getTime() + days * DAY_MS + hours * HOUR_MS).toISOString();
}

function dateOnlyAt(base, days = 0) {
  return isoAt(base, days).slice(0, 10);
}

function entry(table, row, key = row.id) {
  if (!key) throw new Error(`demo_record_key_missing:${table}`);
  return { table, key: String(key), row };
}

export function deriveDemoCredential(password, { salt = randomBytes(18), iterations = DEMO_PASSWORD_ITERATIONS } = {}) {
  const value = String(password || '');
  if (value.length < 12) throw new Error('demo_password_too_short');
  const saltBytes = Buffer.from(salt);
  if (saltBytes.length < 16) throw new Error('demo_password_salt_too_short');
  if (!Number.isInteger(iterations) || iterations < 100000) throw new Error('demo_password_iterations_too_low');
  if (iterations > DEMO_PASSWORD_ITERATIONS) throw new Error('demo_password_iterations_unsupported');
  return {
    password_salt: saltBytes.toString('base64url'),
    password_hash: pbkdf2Sync(Buffer.from(value, 'utf8'), saltBytes, iterations, 32, 'sha256').toString('base64url'),
    password_iterations: iterations,
    password_algorithm: 'PBKDF2-SHA256',
  };
}

export function buildDemoFixture(nowInput = new Date()) {
  const now = asDate(nowInput);
  const createdAt = isoAt(now, -90);
  const owner_id = DEMO_USER_ID;

  const motherIds = [1,2,3,4,5,6].map((n) => `a1000000-0000-4000-8000-00000000000${n}`);
  const babyIds = [1,2,3,4,5,6,7].map((n) => `b2000000-0000-4000-8000-00000000000${n}`);
  const appointmentIds = [1,2,3,4,5,6].map((n) => `c3000000-0000-4000-8000-00000000000${n}`);
  const encounterIds = [1,2,3].map((n) => `d4000000-0000-4000-8000-00000000000${n}`);

  const mothers = [
    ['Ana Martins','ana.martins@example.invalid','+55 16 00000-0101','Primeiro filho. Deseja melhorar conforto durante a mamada.'],
    ['Juliana Costa','juliana.costa@example.invalid','+55 16 00000-0102','Relata rotina de livre demanda e busca orientação de posicionamento.'],
    ['Camila Ribeiro','camila.ribeiro@example.invalid','+55 16 00000-0103','Acompanhamento preventivo no puerpério.'],
    ['Fernanda Lima','fernanda.lima@example.invalid','+55 16 00000-0104','Consulta de apoio para organização da rotina familiar.'],
    ['Beatriz Souza','beatriz.souza@example.invalid','+55 16 00000-0105','Retorno programado para revisar evolução da amamentação.'],
    ['Renata Gomes','renata.gomes@example.invalid','+55 16 00000-0106','Mãe de gêmeos. Dados exclusivamente fictícios para demonstração.'],
  ].map(([name,email,phone,notes], index) => ({
    id: motherIds[index], owner_id, name, email, phone,
    birth_date: dateOnlyAt(now, -(365 * (29 + index))),
    city: 'Ribeirão Preto', state: 'SP', allergies: 'Nenhuma alergia informada',
    breastfeeding_history: index === 0 ? 'Primeira experiência de amamentação.' : 'Histórico fictício registrado para apresentação.',
    notes, demo_data: true, created_at: isoAt(now, -80 + index), updated_at: isoAt(now, -3 + index / 10),
  }));

  const babySpecs = [
    [0,'Helena','Feminino',-45,'39s2d',3260,4380],
    [1,'Theo','Masculino',-20,'38s6d',3140,3650],
    [2,'Laura','Feminino',-90,'40s0d',3410,5520],
    [3,'Miguel','Masculino',-12,'39s0d',3030,3290],
    [4,'Alice','Feminino',-60,'38s4d',3180,4720],
    [5,'Lucas','Masculino',-35,'36s5d',2480,3440],
    [5,'Sofia','Feminino',-35,'36s5d',2390,3310],
  ];
  const babies = babySpecs.map(([motherIndex,name,sex,birthOffset,gestationalAge,birthWeight,currentWeight], index) => ({
    id: babyIds[index], owner_id, mother_id: motherIds[motherIndex], name, sex,
    birth_date: dateOnlyAt(now, birthOffset), gestational_age: gestationalAge,
    birth_weight_g: birthWeight, current_weight_g: currentWeight,
    feeding_type: 'Aleitamento materno', notes: 'Registro fictício para demonstração do sistema.',
    demo_data: true, created_at: isoAt(now, birthOffset), updated_at: isoAt(now, -2),
  }));

  const appointments = [
    { id: appointmentIds[0], mother_id: motherIds[0], baby_id: babyIds[0], starts_at: isoAt(now,-14,-2), status:'Concluído', appointment_type:'Consulta inicial', format:'Domiciliar', value_cents:18000, payment_status:'Pago', address:'Endereço fictício · Ribeirão Preto/SP', notes:'Avaliação inicial de pega e posicionamento.' },
    { id: appointmentIds[1], mother_id: motherIds[1], baby_id: babyIds[1], starts_at: isoAt(now,-7,-1), status:'Concluído', appointment_type:'Retorno', format:'Online', value_cents:14000, payment_status:'Pago', address:'Online', notes:'Retorno para avaliar conforto e transferência de leite.' },
    { id: appointmentIds[2], mother_id: motherIds[2], baby_id: babyIds[2], starts_at: isoAt(now,0,2), status:'Agendado', appointment_type:'Acompanhamento', format:'Consultório', value_cents:16000, payment_status:'Pendente', address:'Espaço Materno · Demonstração', notes:'Consulta agendada para hoje.' },
    { id: appointmentIds[3], mother_id: motherIds[3], baby_id: babyIds[3], starts_at: isoAt(now,2,1), status:'Agendado', appointment_type:'Consulta inicial', format:'Domiciliar', value_cents:18000, payment_status:'Pendente', address:'Endereço fictício · Ribeirão Preto/SP', notes:'Primeira consulta pós-parto.' },
    { id: appointmentIds[4], mother_id: motherIds[4], baby_id: babyIds[4], starts_at: isoAt(now,5,3), status:'Agendado', appointment_type:'Retorno', format:'Online', value_cents:14000, payment_status:'Pendente', address:'Online', notes:'Retorno programado.' },
    { id: appointmentIds[5], mother_id: motherIds[5], baby_id: null, starts_at: isoAt(now,7,2), status:'Agendado', appointment_type:'Acompanhamento', format:'Consultório', value_cents:20000, payment_status:'Pendente', address:'Espaço Materno · Demonstração', notes:'Acompanhamento fictício dos gêmeos.' },
  ].map((row, index) => ({ ...row, owner_id, demo_data:true, created_at: isoAt(now,-30 + index), updated_at: isoAt(now,-1) }));

  const appointmentLinks = [
    [appointmentIds[0], babyIds[0]], [appointmentIds[1], babyIds[1]], [appointmentIds[2], babyIds[2]],
    [appointmentIds[3], babyIds[3]], [appointmentIds[4], babyIds[4]], [appointmentIds[5], babyIds[5]], [appointmentIds[5], babyIds[6]],
  ].map(([appointment_id,baby_id], index) => ({ appointment_id, baby_id, is_primary: index !== 6, created_at: isoAt(now,-20 + index), updated_at: isoAt(now,-1), demo_data:true }));

  const encounterText = [
    {
      chief_complaint:{tags:['Dificuldade de pega','Dor'],notes:'Desconforto no início da mamada, especialmente na mama direita.'},
      maternal_assessment:{notes:'Mamas sem sinais de complicação; sensibilidade leve no início da mamada.'},
      baby_assessment:{notes:'Bebê alerta, responsivo e com sucção coordenada durante observação.'},
      feeding_assessment:{notes:'Ajuste de posição melhorou profundidade da pega e conforto materno.'},
      care_plan:{notes:'Reforçar alinhamento corporal, aproximação do bebê e livre demanda. Reavaliar em 7 dias.'},
    },
    {
      chief_complaint:{tags:['Retorno'],notes:'Família percebe melhora do conforto após orientações anteriores.'},
      maternal_assessment:{notes:'Sem dor persistente relatada no retorno.'},
      baby_assessment:{notes:'Evolução ponderal fictícia adequada para demonstrar acompanhamento.'},
      feeding_assessment:{notes:'Pega observada com boa vedação e deglutição presente.'},
      care_plan:{notes:'Manter rotina atual e acompanhamento conforme necessidade.'},
    },
    {
      chief_complaint:{tags:['Acompanhamento'],notes:'Revisão preventiva de técnica e rotina de mamadas.'},
      maternal_assessment:{notes:'Sem queixas maternas relevantes no cenário fictício.'},
      baby_assessment:{notes:'Bebê ativo e com sinais gerais preservados no registro demonstrativo.'},
      feeding_assessment:{notes:'Posicionamento confortável e sucção ritmada durante avaliação simulada.'},
      care_plan:{notes:'Orientações gerais de manejo e sinais para procurar avaliação profissional.'},
    },
  ];
  const encounterPairs = [[0,0,-14],[1,1,-7],[4,4,-21]];
  const encounters = encounterPairs.map(([motherIndex,babyIndex,days], index) => ({
    id: encounterIds[index], owner_id, mother_id: motherIds[motherIndex], baby_id: babyIds[babyIndex],
    appointment_id: index < 2 ? appointmentIds[index] : null, status:'finalized', occurred_at:isoAt(now,days,-1),
    identification:{appointmentType:index===1?'Retorno':'Consulta inicial',format:index===1?'Online':'Domiciliar',babyIds:[babyIds[babyIndex]],babyTarget:babyIds[babyIndex],value:index===1?140:180},
    ...encounterText[index],
    finalization:{notes:'Atendimento fictício finalizado para demonstração.',followup:index===0?'Retorno em 7 dias':'Conforme necessidade'},
    finalized_at:isoAt(now,days,0), demo_data:true, created_at:isoAt(now,days,-2), updated_at:isoAt(now,days,0),
  }));

  const encounterLinks = encounters.map((row) => ({ encounter_id:row.id, baby_id:row.baby_id, is_primary:true, created_at:row.created_at, updated_at:row.updated_at, demo_data:true }));

  const weightSeries = [
    [0, [[-40,3380],[-25,3820],[-5,4380]]],
    [1, [[-17,3200],[-10,3400],[-2,3650]]],
    [4, [[-55,3290],[-30,4010],[-3,4720]]],
  ];
  let weightCounter = 1;
  const weights = [];
  for (const [babyIndex, series] of weightSeries) {
    for (const [days, weight_g] of series) {
      const id = `e5000000-0000-4000-8000-${String(weightCounter).padStart(12,'0')}`;
      weightCounter++;
      weights.push({ id, owner_id, baby_id:babyIds[babyIndex], measured_at:isoAt(now,days), weight_g, notes:'Peso fictício para demonstração da curva de evolução.', demo_data:true, created_at:isoAt(now,days), updated_at:isoAt(now,days) });
    }
  }

  const growthMeasurements = weights.map((weight,index) => ({
    id:`e6000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`, owner_id,
    baby_id:weight.baby_id, measured_at:weight.measured_at, weight_g:weight.weight_g,
    length_cm: Number((50 + index * 0.7).toFixed(1)), head_circumference_cm:Number((35 + index * 0.25).toFixed(1)),
    notes:'Medidas fictícias para apresentação.', demo_data:true, created_at:weight.created_at, updated_at:weight.updated_at,
  }));

  const followups = [
    {id:'f6000000-0000-4000-8000-000000000001',mother_id:motherIds[0],baby_id:babyIds[0],encounter_id:encounterIds[0],due_at:isoAt(now,-7),status:'Concluído',completed_at:isoAt(now,-7,2),notes:'Retorno concluído: família relata melhora do conforto.'},
    {id:'f6000000-0000-4000-8000-000000000002',mother_id:motherIds[1],baby_id:babyIds[1],encounter_id:encounterIds[1],due_at:isoAt(now,1),status:'Pendente',completed_at:null,notes:'Enviar mensagem de acompanhamento após o retorno.'},
    {id:'f6000000-0000-4000-8000-000000000003',mother_id:motherIds[4],baby_id:babyIds[4],encounter_id:encounterIds[2],due_at:isoAt(now,3),status:'Pendente',completed_at:null,notes:'Revisar rotina e evolução de peso.'},
    {id:'f6000000-0000-4000-8000-000000000004',mother_id:motherIds[5],baby_id:babyIds[5],encounter_id:null,due_at:isoAt(now,6),status:'Pendente',completed_at:null,notes:'Follow-up fictício do acompanhamento dos gêmeos.'},
  ].map((row,index) => ({...row,owner_id,demo_data:true,created_at:isoAt(now,-15+index),updated_at:isoAt(now,-1)}));

  const financial = [
    [1,motherIds[0],appointmentIds[0],encounterIds[0],'Consulta domiciliar - demonstração',18000,'Pago','Pix',-14],
    [2,motherIds[1],appointmentIds[1],encounterIds[1],'Retorno online - demonstração',14000,'Pago','Cartão',-7],
    [3,motherIds[2],appointmentIds[2],null,'Acompanhamento - demonstração',16000,'Pendente','',0],
    [4,motherIds[3],appointmentIds[3],null,'Consulta domiciliar - demonstração',18000,'Pendente','',2],
    [5,motherIds[5],appointmentIds[5],null,'Acompanhamento de gêmeos - demonstração',20000,'Pendente','',7],
  ].map(([n,mother_id,appointment_id,encounter_id,description,amount_cents,status,payment_method,days]) => ({
    id:`f7000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner_id,mother_id,appointment_id,encounter_id,
    description,amount_cents,due_at:isoAt(now,days),status,paid:status==='Pago',payment_method,
    paid_at:status==='Pago'?isoAt(now,days,1):null,demo_data:true,created_at:isoAt(now,days,-2),updated_at:isoAt(now,days,-1),
  }));

  const saasAccountId = 'a9000000-0000-4000-8000-000000000001';
  const commercialRecords = [
    entry('saas_accounts', {id:saasAccountId,owner_id,account_type:'individual',status:'active',demo_data:true,created_at:createdAt,updated_at:isoAt(now,-1)}),
    entry('professional_profiles', {id:'a9000000-0000-4000-8000-000000000002',account_id:saasAccountId,owner_id,professional_name:'Mariana Alves',business_name:'Espaço Materno - Demonstração',phone:'+55 16 00000-0200',logo_url:null,settings:{demo:true,city:'Ribeirão Preto',state:'SP'},demo_data:true,created_at:createdAt,updated_at:isoAt(now,-1)}),
    entry('subscriptions', {id:'a9000000-0000-4000-8000-000000000003',account_id:saasAccountId,owner_id,provider:'demo_seed',external_customer_id:null,external_subscription_id:'demo-account',plan_code:'pro_6m',status:'active',current_period_end:isoAt(now,183),metadata:{demo:true,no_charge:true},demo_data:true,created_at:createdAt,updated_at:isoAt(now,-1)}),
  ];

  const records = [
    ...commercialRecords,
    ...mothers.map((row) => entry('mothers', row)),
    ...babies.map((row) => entry('babies', row)),
    ...appointments.map((row) => entry('appointments', row)),
    ...appointmentLinks.map((row) => entry('appointment_babies', row, `${row.appointment_id}|${row.baby_id}`)),
    ...encounters.map((row) => entry('clinical_encounters', row)),
    ...encounterLinks.map((row) => entry('clinical_encounter_babies', row, `${row.encounter_id}|${row.baby_id}`)),
    ...weights.map((row) => entry('weights', row)),
    ...growthMeasurements.map((row) => entry('growth_measurements', row)),
    ...followups.map((row) => entry('followups', row)),
    ...financial.map((row) => entry('financial_entries', row)),
  ];

  return {
    generatedAt: now.toISOString(),
    user: {
      id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      user_metadata: { display_name:'Mariana Alves', demo:true, purpose:'commercial-presentation' },
      app_metadata: { demo:true, role:'professional' },
    },
    records,
  };
}
