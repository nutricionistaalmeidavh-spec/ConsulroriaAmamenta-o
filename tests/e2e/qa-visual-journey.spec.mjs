import { test, expect } from './fixtures.mjs';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { login, authHeaders } from './helpers.mjs';

// Screenshots come from the real, materialized application in the isolated
// Miniflare/D1 test runtime, never from production or a mocked picture.
const ROOT = resolve('artifacts/qa-visual');
const DAY = 86_400_000;
const clinicDay = (shift = 0) => {
  const date = new Date(Date.now() + shift * DAY);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join('-');
};
const people = [
  {
    name: 'Marina Azevedo', baby: 'Elisa Azevedo', phone: '(16) 90000-0421',
    address: 'Rua das Acácias, 120 - Jardim Aurora, Ribeirão Preto/SP (fictício)',
    born: '1993-05-11', delivery: 'Parto vaginal, há aproximadamente 23 dias',
    conditions: 'Sem alergias referidas. Uso de suplementos conforme prescrição prévia. Sono fragmentado pelo puerpério.',
    history: 'Primeira experiência com amamentação. Livre demanda; relata desconforto nos primeiros minutos à direita e insegurança quanto à transferência de leite.',
    notes: 'Família com rede de apoio presente. Deseja um plano escrito e orientações semanais até o retorno.',
    infantWeight: '3980', infantBirthWeight: '3390', infantBirthDaysAgo: -23, gestation: '39s2d',
  },
  {
    name: 'Juliana Moreira', baby: 'Theo Moreira', phone: '(16) 90000-0422',
    address: 'Avenida das Palmeiras, 245 - Ribeirão Preto/SP (fictício)',
    born: '1990-09-21', delivery: 'Cesárea, há aproximadamente 43 dias',
    conditions: 'Sem condições clínicas relevantes relatadas no cadastro demonstrativo.',
    history: 'Segunda experiência de amamentação; procura retorno para revisão de posição e conforto.',
    notes: 'Consulta inicial concluída em cenário demonstrativo; próximo contato agendado.',
    infantWeight: '4780', infantBirthWeight: '3250', infantBirthDaysAgo: -43, gestation: '38s5d',
  },
  {
    name: 'Camila Oliveira', baby: 'Laura Oliveira', phone: '(16) 90000-0423',
    address: 'Rua Ipê Branco, 88 - Ribeirão Preto/SP (fictício)',
    born: '1995-01-17', delivery: 'Parto vaginal, há aproximadamente 14 dias',
    conditions: 'Sem alergias ou medicamentos relevantes informados.',
    history: 'Aleitamento materno exclusivo; consulta preventiva e esclarecimento de dúvidas.',
    notes: 'Busca revisão de sinais de saciedade e rotina de acompanhamento.',
    infantWeight: '3660', infantBirthWeight: '3170', infantBirthDaysAgo: -14, gestation: '40s0d',
  },
];

async function screenshot(page, project, entries, code, title) {
  const folder = join(ROOT, 'screenshots', project);
  await mkdir(folder, { recursive: true });
  const file = join(folder, code + '.png');
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
  entries.push({ project, code, title, image: 'screenshots/' + project + '/' + code + '.png' });
  await writeFile(join(ROOT, 'manifest-' + project + '.json'), JSON.stringify({
    title: 'QA visual - Gestão de Amamentação',
    dataPolicy: 'Todos os dados são exclusivamente fictícios; testes em D1 local isolado.',
    entries,
  }, null, 2));
}

async function openSection(page, mobile, section) {
  if (mobile && ['home', 'agenda', 'patients', 'followups', 'more'].includes(section)) {
    await page.locator('[data-mobile-target="' + section + '"]:visible').first().click();
  } else if (mobile) {
    await page.locator('[data-mobile-target="more"]:visible').first().click();
    await page.locator('[data-screen="more"] [data-nav-target="' + section + '"]:visible').first().click();
  } else {
    await page.locator('.lactation-sidebar [data-nav-target="' + section + '"]:visible').first().click();
  }
  await expect(page.locator('[data-screen="' + section + '"]')).toBeVisible();
}

async function createPatient(page, person, capture) {
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await expect(page.locator('[data-screen="patient-form"]')).toBeVisible();
  const form = page.locator('[data-patient-form]');
  await form.locator('[name="motherName"]').fill(person.name);
  await form.locator('[name="motherPhone"]').fill(person.phone);
  await form.locator('[name="motherAddress"]').fill(person.address);
  await form.locator('[name="motherBirthDate"]').fill(person.born);
  await form.locator('[name="motherDelivery"]').fill(person.delivery);
  await form.locator('[name="motherConditions"]').fill(person.conditions);
  await form.locator('[name="motherHistory"]').fill(person.history);
  await form.locator('[name="notes"]').fill(person.notes);
  const baby = form.locator('[data-baby-editor]').first();
  await baby.locator('[data-baby-field="name"]').fill(person.baby);
  await baby.locator('[data-baby-field="birth_date"]').fill(clinicDay(person.infantBirthDaysAgo));
  await baby.locator('[data-baby-field="birth_weight_g"]').fill(person.infantBirthWeight);
  await baby.locator('[data-baby-field="current_weight_g"]').fill(person.infantWeight);
  await baby.locator('[data-baby-field="gestational_age"]').fill(person.gestation);
  await baby.locator('[data-baby-field="feeding"]').selectOption({ label: 'Aleitamento materno exclusivo' });
  await form.locator('[name="consentData"]').check();
  await form.locator('[name="consentWhatsapp"]').check();
  await form.locator('[name="consentClinicalMedia"]').check();
  if (capture) await capture('04-cadastro-preenchido', 'Cadastro da mãe e do bebê - informações clínicas fictícias completas');
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await form.locator('button[type="submit"]:visible').last().click();
  const response = await responsePromise;
  expect(response.status(), 'O cadastro deve persistir no D1 local').toBe(201);
  const saved = await response.json();
  await expect(page.locator('[data-patient-title]')).toContainText(person.name);
  return saved;
}

async function addAppointment(page, patient, days, time, name) {
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const response = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: new Date(clinicDay(days) + 'T' + time + ':00-03:00').toISOString(),
      p_duration_min: 60,
      p_appointment_type: name,
      p_format: 'Domiciliar',
      p_value_cents: 18000,
      p_payment_status: 'Pendente',
    },
  });
  expect(response.ok(), 'Agendamento fictício deve persistir').toBeTruthy();
}

test('QA visual: cadastro real, prontuário detalhado, 7 etapas e orientação exportada', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.name === 'mobile';
  const entries = [];
  const shot = (code, title) => screenshot(page, testInfo.project.name, entries, code, title);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  // Do not screenshot the credentials or a real patient.
  await page.goto('/app/');
  await expect(page.locator('[data-login-form]')).toBeVisible();
  await shot('01-login', 'Acesso profissional - tela real antes de informar credenciais');
  await login(page);
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await shot('02-inicio-vazio', 'Início antes da criação da primeira paciente');

  await openSection(page, mobile, 'patients');
  await shot('03-lista-inicial', 'Lista de pacientes no início do cenário');
  const principal = await createPatient(page, people[0], shot);
  await shot('05-ficha-paciente', 'Ficha persistida: mãe, bebê, contexto e pesos');

  // Populate the real local API/UI with additional families and appointments,
  // so the navigation screenshots represent a professional using the system.
  await openSection(page, mobile, 'patients');
  const juliana = await createPatient(page, people[1]);
  await openSection(page, mobile, 'patients');
  const camila = await createPatient(page, people[2]);
  await addAppointment(page, juliana, 1, '10:30', 'Retorno de amamentação');
  await addAppointment(page, camila, 2, '15:00', 'Consulta inicial');

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await openSection(page, mobile, 'home');
  await shot('06-inicio-ativo', 'Painel inicial com famílias fictícias e próximas consultas');
  await openSection(page, mobile, 'agenda');
  await shot('07-agenda', 'Agenda de consultas com dois agendamentos reais no D1 local');
  await openSection(page, mobile, 'patients');
  await shot('08-pacientes', 'Lista de três famílias fictícias cadastradas pela interface');

  await page.locator('[data-action="open-patient"][data-patient-id="' + principal.mother.id + '"]:visible').first().click();
  await expect(page.locator('[data-patient-title]')).toContainText(people[0].name);
  await shot('09-ficha-atendimento', 'Prontuário da família Marina e Elisa antes da consulta');
  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await expect(page.locator('[data-wizard-step="1"]')).toBeVisible();
  await expect(page.locator('[data-appointment-patient]')).toHaveValue(principal.mother.id);
  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Consulta inicial"]').click();
  await page.locator('[data-encounter-choice][data-field="format"][data-value="Domiciliar"]').click();
  await page.locator('[data-encounter-field="startsAt"]').fill(clinicDay() + 'T14:30');
  await page.locator('[data-encounter-field="durationMin"]').selectOption('90');
  await page.locator('[data-encounter-field="value"]:visible').fill('180');
  await page.locator('[data-encounter-field="address"]').fill(people[0].address);
  await shot('10-etapa-1-identificacao', 'Etapa 1: identificação, formato, data, local e duração');
  const started = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]:visible').click();
  expect((await started).ok()).toBeTruthy();
  await expect(page.locator('[data-wizard-step="2"]')).toBeVisible();
  const encounterId = await page.locator('[data-screen="appointment"]').getAttribute('data-encounter-id');
  expect(encounterId).toBeTruthy();

  await page.locator('[data-wizard-step="2"] [data-encounter-choice][data-value="Dor"]').click();
  await page.locator('[data-wizard-step="2"] [data-encounter-choice][data-value="Dificuldade de pega"]').click();
  await page.locator('[data-wizard-step="2"] [data-encounter-field="notes"]').fill(
    'Mãe relata ardor nos primeiros 40-60 segundos, principalmente à direita. Elisa mama em livre demanda, 8-10 vezes ao dia. Família observa 7 fraldas molhadas/24h; preocupação com ganho ponderal. Busca avaliação de pega, alinhamento e condutas para casa.',
  );
  await shot('11-etapa-2-queixa', 'Etapa 2: queixa principal e relato clínico detalhado');
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await page.locator('#cn-note').fill(
    'Consulta domiciliar inicial. Responsável consciente e colaborativa. Relata dor transitória na pega inicial, sem sinais sistêmicos. Histórico, rotina e dúvidas registrados. Orientada observação da mamada e revisão do conforto após ajuste de posicionamento; retorno programado.',
  );
  await shot('12-prontuario', 'Prontuário clínico: evolução registrada durante o atendimento');
  await page.locator('#cn-overlay [data-cn-continue]').click();
  await expect(page.locator('[data-wizard-step="3"]')).toBeVisible();

  await page.locator('[data-wizard-step="3"] [data-encounter-field="painScore"]').fill('4');
  await page.locator('[data-wizard-step="3"] [data-encounter-field="affectedSide"]').selectOption('Direita');
  await page.locator('[data-wizard-step="3"] [data-encounter-field="notes"]').fill(
    'Mamas sem áreas extensas de hiperemia. Desconforto referido no início da mamada à direita; melhora após ajuste de pega. Avaliação demonstrativa com consentimento de uso de imagens clínicas, sem envio de arquivos reais.',
  );
  await shot('13-etapa-3-mae', 'Etapa 3: avaliação materna, lateralidade e observações');
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('[data-wizard-step="4"]')).toBeVisible();

  const baby = page.locator('[data-baby-assessment-editor]');
  for (const [field, value] of Object.entries({
    weightG: '3980', weightGainG: '260', wetDiapers: '7', stools: '3',
    notes: 'Elisa alerta, com boa responsividade. Ganho ponderal e eliminações registrados como cenário de demonstração. Seguimento clínico recomendado conforme avaliação profissional.',
  })) await baby.locator('[data-encounter-field="' + field + '"]').fill(value);
  await baby.locator('[data-encounter-choice][data-value="Alerta e responsivo"]').click();
  await shot('14-etapa-4-bebe', 'Etapa 4: avaliação do bebê com peso e eliminações');
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('[data-wizard-step="5"]')).toBeVisible();

  const feed = page.locator('[data-feeding-assessment-editor]');
  await feed.locator('[data-encounter-choice][data-field="position"][data-value="Tradicional"]').click();
  await feed.locator('[data-encounter-choice][data-field="latch"][data-value="Adequada após ajuste"]').click();
  await feed.locator('[data-encounter-choice][data-field="suckSwallow"][data-value="Sucção rítmica"]').click();
  await feed.locator('[data-encounter-choice][data-field="suckSwallow"][data-value="Deglutição audível"]').click();
  await feed.locator('[data-encounter-field="notes"]').fill(
    'Mamada acompanhada em ambos os lados. Alinhamento orelha-ombro-quadril revisto com a família; melhora de conforto relatada. Observadas pausas habituais e deglutições durante a avaliação.',
  );
  const before = feed.locator('[data-encounter-field="beforeFeed"]');
  if (await before.count()) await before.fill('Bebê desperta, procura a mama e apresenta sinais precoces de fome. Responsável posiciona apoio de braço.');
  const after = feed.locator('[data-encounter-field="afterFeed"]');
  if (await after.count()) await after.fill('Mãe refere mais conforto; bebê relaxado ao término da mamada observada.');
  await shot('15-etapa-5-mamada', 'Etapa 5: pega, posição, sucção e deglutição observadas');
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('[data-wizard-step="6"]')).toBeVisible();

  const care = page.locator('[data-wizard-step="6"]');
  await care.locator('[data-encounter-field="objectives"]').fill(
    'Melhorar conforto da mãe, apoiar pega profunda, observar sinais de transferência de leite e oferecer um roteiro de autocuidado para as próximas quatro semanas.',
  );
  for (const [field, value] of Object.entries({
    priorityGuidance: 'Priorizar conforto, livre demanda e observação dos sinais do bebê em cada mamada.',
    feedingPositioning: 'Revisar alinhamento corporal, proximidade do bebê e início da pega sem pressão sobre a cabeça.',
    expressionSupplement: 'Não foi indicado complemento na avaliação demonstrativa; reavaliar conforme evolução e orientação clínica.',
    routine: 'Registrar dúvidas, mamadas e fraldas de forma simples para conversar no retorno.',
    warningSigns: 'Orientada a procurar avaliação profissional se houver febre, piora da dor, mudança de comportamento do bebê ou redução importante de eliminações.',
  })) {
    const input = care.locator('[data-encounter-field="' + field + '"]');
    if (await input.count()) await input.fill(value);
  }
  await care.locator('[data-encounter-field="instructions"]').fill(
    'Plano personalizado após consulta: manter mamadas em livre demanda, ajustar a posição em busca de conforto e acompanhar sinais de bem-estar e transferência. O roteiro semanal complementa, sem substituir, avaliação individual.',
  );
  await care.locator('[data-encounter-field="followup"]').selectOption({ label: '7 dias' });
  await expect(care.locator('[name="care-orientation-mode"][value="weekly"]')).toBeVisible();
  await care.locator('[name="care-orientation-mode"][value="weekly"]').check();
  await care.locator('[data-weekly-start]').fill(clinicDay());
  const weekly = [
    'Semana 1: praticar os ajustes combinados de posicionamento e anotar dúvidas. Observar conforto, deglutição e sinais de saciedade; contato de revisão em sete dias.',
    'Semana 2: revisar conforto materno e frequência das mamadas. Comparar observações da família com a avaliação do retorno e ajustar estratégias apenas quando necessário.',
    'Semana 3: consolidar rotina flexível em livre demanda, reconhecer sinais precoces de fome e planejar períodos de descanso com apoio familiar.',
    'Semana 4: reavaliar evolução, esclarecer dúvidas sobre mudanças na rotina e definir a necessidade de novo acompanhamento individualizado.',
  ];
  for (const [index, guidance] of weekly.entries()) {
    await care.locator('[data-weekly-add]').click();
    await care.locator('[data-weekly-entry]').nth(index).locator('[data-weekly-instructions]').fill(guidance);
  }
  await expect(care.locator('[data-weekly-entry]')).toHaveCount(4);
  await shot('16-etapa-6-orientacoes', 'Etapa 6: plano de cuidado individualizado e orientações por quatro semanas');
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('[data-wizard-step="7"]')).toBeVisible();
  await shot('17-etapa-7-exportacao', 'Etapa 7: revisão, escolha de layout e ação de exportar PDF');

  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-action="print-plan"]').click();
  const download = await downloadEvent;
  const downloads = join(ROOT, 'downloads', testInfo.project.name);
  await mkdir(downloads, { recursive: true });
  const pdf = join(downloads, 'orientacoes-marina-elisa.pdf');
  await download.saveAs(pdf);
  const buffer = await stat(pdf);
  expect(buffer.size).toBeGreaterThan(2500);
  const responseData = await page.request.get('/api/clinical/records/clinical_encounters?id=eq.' + encodeURIComponent(encounterId) + '&limit=1', { headers: await authHeaders(page) });
  expect(responseData.ok()).toBeTruthy();

  // The user actually completes and saves the encounter; reopening verifies
  // the database rather than merely trusting a toast or a screenshot.
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('[data-patient-title]')).toContainText(people[0].name, { timeout: 20_000 });
  await shot('18-ficha-apos-consulta', 'Atendimento finalizado e ficha da paciente atualizada');
  const persisted = await page.request.get('/api/clinical/records/clinical_encounters?id=eq.' + encodeURIComponent(encounterId) + '&limit=1', { headers: await authHeaders(page) });
  expect(persisted.ok()).toBeTruthy();
  const rows = await persisted.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe('finalized');
  expect(rows[0].mother_id).toBe(principal.mother.id);
  expect(rows[0].baby_id).toBe(principal.babies[0].id);
  expect(rows[0].care_plan.orientation_mode).toBe('weekly');
  expect(rows[0].care_plan.weekly_plan.weeks).toHaveLength(4);

  await page.reload();
  await expect(page.locator('[data-patient-title]')).toContainText(people[0].name);
  await shot('19-ficha-apos-reload', 'Persistência comprovada após recarregar o sistema');

  for (const [section, code, title] of [
    ['followups', '20-acompanhamentos', 'Acompanhamentos e retornos após o atendimento'],
    ['finance', '21-financeiro', 'Financeiro com movimentação originada dos atendimentos'],
    ['library', '22-biblioteca', 'Biblioteca de orientações'],
    ['settings', '23-configuracoes', 'Configurações e modelos de documentos'],
  ]) {
    await openSection(page, mobile, section);
    await shot(code, title);
  }
  if (mobile) {
    await openSection(page, true, 'more');
    await shot('24-mais', 'Menu de navegação complementar no celular');
  }
  expect(errors, 'Nenhum erro JavaScript não tratado durante a jornada').toEqual([]);
});
