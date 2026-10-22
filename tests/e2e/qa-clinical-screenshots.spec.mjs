import { test, expect } from './fixtures.mjs';
import { devices } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { login, authHeaders } from './helpers.mjs';

/**
 * Screenshots from the real Cloudflare/D1 local application, not HTML mockups.
 * Everything runs on localhost: no real accounts, billing, email or patient data.
 * Ordered report entries are emitted only after genuine UI assertions.
 */
const ROOT = 'artifacts/qa-clinical';
const SHOTS = join(ROOT, 'screens');
const sections = [];
const motherName = 'Mariana Oliveira Fernandes';
const babyName = 'Helena Oliveira Fernandes';

async function capture(page, code, title, note, visible) {
  if (visible) await expect(page.locator(visible).first()).toBeVisible();
  await mkdir(SHOTS, { recursive: true });
  const filename = code + '.png';
  await page.screenshot({ path: join(SHOTS, filename), fullPage: true, animations: 'disabled', caret: 'hide' });
  sections.push({ file: filename, title, note });
}

async function fillOptional(page, selector, value) {
  const node = page.locator(selector).first();
  if (await node.count() && await node.isVisible()) await node.fill(value);
}

async function createExtraPatients(page) {
  const examples = [
    ['Juliana Ribeiro Costa', 'Theo Ribeiro Costa', '2026-09-26', 3150, 3720, 'Primeiro retorno para avaliação de transferência de leite.'],
    ['Camila Souza Martins', 'Laura Souza Martins', '2026-08-15', 3340, 5010, 'Acompanhamento preventivo e orientação para retorno ao trabalho.'],
    ['Beatriz Alves Lima', 'Alice Alves Lima', '2026-09-07', 3080, 4220, 'Revisão da pega após ajuste de posicionamento.'],
    ['Renata Gomes Silva', 'Lucas Gomes Silva', '2026-10-01', 2960, 3540, 'Consulta após alta hospitalar e revisão de rotina familiar.'],
    ['Fernanda Barros Rocha', 'Miguel Barros Rocha', '2026-09-18', 3270, 3990, 'Orientações de conforto e manejo de mamadas noturnas.'],
  ];
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const created = [];
  for (const [name, baby, born, atBirth, current, history] of examples) {
    const resp = await page.request.post('/api/clinical/patients', {
      headers: { ...headers, 'idempotency-key': 'qa-visual-' + name.toLowerCase().replace(/[^a-z]/g, '-') },
      data: {
        mother: { name, phone: '16900000000', address: 'Rua das Acácias, 120 - Ribeirão Preto/SP', breastfeeding_history: history, notes: 'Registro 100% fictício, criado exclusivamente no ambiente local de QA.' },
        babies: [{ name: baby, birth_date: born, birth_weight_g: atBirth, current_weight_g: current, gestational_age: '39s2d', feeding: 'Aleitamento materno exclusivo' }],
        consents: { data_processing: true, whatsapp: true, clinical_media: false, public_media: false },
      },
    });
    expect(resp.status(), 'Cadastro de exemplo: ' + name).toBe(201);
    created.push(await resp.json());
  }
  return created;
}

async function enterNav(page, target) {
  await page.locator('[data-nav-target="' + target + '"]:visible').first().click();
  await expect(page.locator('[data-screen="' + target + '"]')).toBeVisible();
}

async function next(page, step) {
  await page.locator('[data-wizard-next]:visible').click();
  await expect(page.locator('[data-wizard-step="' + step + '"]')).toBeVisible();
}

test('QA visual integral: paciente, consulta, prontuário, plano semanal e PDF real exportado', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto('/app/');
    await capture(page, '01-login', 'Tela de acesso', 'Login real da aplicação em localhost, sem acesso à produção.', '[data-login-form]');
    await login(page);

    // Main case is created through the visible patient UI, using rich fictional data.
    await page.locator('[data-action="new-patient"]:visible').first().click();
    await expect(page.locator('[data-screen="patient-form"]')).toBeVisible();
    await page.locator('[name="motherName"]').fill(motherName);
    await page.locator('[name="motherPhone"]').fill('(16) 90000-0000');
    await page.locator('[name="motherAddress"]').fill('Rua das Jabuticabeiras, 248 - Jardim Botânico, Ribeirão Preto/SP');
    await page.locator('[name="motherBirthDate"]').fill('1995-04-18');
    await page.locator('[name="motherDelivery"]').fill('Parto vaginal, 39 semanas e 3 dias; maternidade fictícia, alta sem intercorrências.');
    await page.locator('[name="motherConditions"]').fill('Refere rinite alérgica. Sem alergias medicamentosas informadas. Nega febre, trauma ou sinais sistêmicos no dia da consulta.');
    await page.locator('[name="motherHistory"]').fill('Primípara; amamentação em livre demanda. Desconforto principalmente à direita, bebê com pega superficial no início e mamadas longas. Busca avaliação do posicionamento, transferência e conforto.');
    await page.locator('[name="notes"]').fill('Família engajada, rede de apoio presente, deseja manter aleitamento exclusivo. Consentimento para dados clínicos e comunicação individual informado durante acolhimento.');
    await page.locator('[data-baby-field="name"]').first().fill(babyName);
    await page.locator('[data-baby-field="birth_date"]').first().fill('2026-09-14');
    await page.locator('[data-baby-field="birth_weight_g"]').first().fill('3260');
    await page.locator('[data-baby-field="current_weight_g"]').first().fill('4380');
    await page.locator('[data-baby-field="gestational_age"]').first().fill('39s3d');
    await page.locator('[data-baby-field="feeding"]').first().selectOption({ label: 'Aleitamento materno exclusivo' });
    await page.locator('[name="consentData"]').check();
    await page.locator('[name="consentWhatsapp"]').check();
    await page.locator('[name="consentClinicalMedia"]').check();
    await capture(page, '02-cadastro-preenchido', 'Cadastro completo de mãe e bebê', 'Dados robustos e inteiramente sintéticos preenchidos na interface real.', '[data-patient-form]');
    const saved = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
    await page.locator('[data-patient-form] button[type="submit"]:visible').first().click();
    const response = await saved;
    expect(response.status()).toBe(201);
    const patient = await response.json();
    await expect(page.locator('[data-patient-title]')).toContainText(motherName);
    await capture(page, '03-prontuario-inicial', 'Prontuário da paciente cadastrada', 'Identificação, contato, bebê e histórico inicial após persistência.', '[data-patient-title]');

    const others = await createExtraPatients(page);
    expect(others).toHaveLength(5);

    // Actual persisted weight records enrich growth charts without bypassing clinical APIs.
    const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
    for (const [date, grams] of [['2026-09-20', 3320], ['2026-09-27', 3650], ['2026-10-06', 3980], ['2026-10-17', 4380]]) {
      const created = await page.request.post('/api/clinical/records/weights', {
        headers, data: { baby_id: patient.babies[0].id, weight_g: grams, measured_at: date + 'T12:00:00.000Z', notes: 'Pesagem fictícia documentada em cenário de acompanhamento.' },
      });
      expect(created.ok(), 'Peso: ' + date).toBeTruthy();
    }

    await page.reload();
    await expect(page.locator('[data-app-root]')).toBeVisible();
    await enterNav(page, 'home');
    await capture(page, '04-inicio-com-dados', 'Visão geral com pacientes fictícias', 'Ambiente clínico com seis famílias demonstrativas.', '[data-screen="home"]');
    await enterNav(page, 'patients');
    await expect(page.locator('[data-patient-list]')).toContainText('Juliana Ribeiro Costa');
    await capture(page, '05-lista-pacientes', 'Lista de pacientes', 'Pesquisa e cards reais com famílias fictícias.', '[data-patient-list]');
    await page.goto('/app/#/patient/' + patient.mother.id);
    await expect(page.locator('[data-patient-title]')).toContainText(motherName);
    await capture(page, '06-historico-peso', 'Prontuário e evolução ponderal', 'Histórico com quatro pesagens reais no banco local de teste.', '[data-patient-title]');

    await page.locator('[data-action="new-appointment"]:visible').first().click();
    await expect(page.locator('[data-wizard-step="1"]')).toBeVisible();
    await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Consulta inicial"]').click();
    await page.locator('[data-encounter-choice][data-field="format"][data-value="Domiciliar"]').click();
    await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
    await page.locator('[data-encounter-field="durationMin"]').selectOption('90');
    await page.locator('[data-encounter-field="value"]').fill('180');
    await fillOptional(page, '[data-encounter-field="address"]', 'Rua das Jabuticabeiras, 248 - Jardim Botânico, Ribeirão Preto/SP');
    await capture(page, '07-atendimento-identificacao', 'Atendimento — identificação', 'Consulta domiciliar de 90 minutos, R$ 180, mãe e bebê selecionados.', '[data-wizard-step="1"]');
    const started = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
    await next(page, 2);
    expect((await started).ok()).toBeTruthy();

    await page.locator('[data-encounter-choice][data-section="chief_complaint"][data-value="Dor"]').click();
    await page.locator('[data-encounter-choice][data-section="chief_complaint"][data-value="Dificuldade de pega"]').click();
    await page.locator('[data-wizard-step="2"] [data-encounter-field="notes"]').fill('Há cerca de dez dias a mãe relata dor 6/10 no início das mamadas, maior à direita. Helena mama em média a cada 2–3 horas, com pausas curtas. Família observa sucção ritmada após ajuste, porém há dificuldade para manter a pega profunda.');
    await capture(page, '08-queixa-principal', 'Etapa 2 — queixa principal', 'Relato clínico, sintomas e contexto da demanda.', '[data-wizard-step="2"]');
    await page.locator('[data-wizard-next]:visible').click();
    await expect(page.locator('#cn-overlay')).toBeVisible();
    await page.locator('#cn-note').fill('Evolução SOAP fictícia — S: dor no início das mamadas, dificuldade para posicionamento. O: mãe e bebê presentes, bebê alerta, sucção coordenada após ajuste. A: pega superficial inicial, com melhora do conforto após intervenção. P: orientar alinhamento, observar sinais de transferência e reavaliar em sete dias.');
    await capture(page, '09-evolucao-clinica', 'Prontuário — evolução clínica', 'Anotação estruturada, redigida como em um atendimento real.', '#cn-overlay');
    await page.locator('#cn-overlay [data-cn-continue]').click();
    await expect(page.locator('[data-wizard-step="3"]')).toBeVisible();

    await page.locator('[data-wizard-step="3"] [data-encounter-field="painScore"]').fill('6');
    await page.locator('[data-wizard-step="3"] [data-encounter-field="affectedSide"]').selectOption('Direita');
    await page.locator('[data-wizard-step="3"] [data-encounter-field="notes"]').fill('Sensibilidade mamilar à direita sem febre, hiperemia extensa ou secreção. Durante observação, houve melhora da sensação dolorosa com alinhamento orelha-ombro-quadril e aproximação do bebê ao corpo materno.');
    await capture(page, '10-avaliacao-materna', 'Etapa 3 — avaliação materna', 'Escala de dor, lateralidade, exame e evolução.', '[data-wizard-step="3"]');
    await next(page, 4);

    const baby = page.locator('[data-wizard-step="4"]');
    await baby.locator('[data-encounter-field="weightG"]').fill('4380');
    await baby.locator('[data-encounter-field="weightGainG"]').fill('400');
    await baby.locator('[data-encounter-field="wetDiapers"]').fill('7');
    await baby.locator('[data-encounter-field="stools"]').fill('3');
    await baby.locator('[data-encounter-choice][data-value="Alerta e responsivo"]').click();
    await baby.locator('[data-encounter-field="notes"]').fill('Helena alerta e responsiva, boa movimentação espontânea, fraldas adequadas conforme relato. Peso registrado de 4.380 g no cenário fictício; orientar avaliação seriada conforme evolução.');
    await capture(page, '11-avaliacao-bebe', 'Etapa 4 — avaliação do bebê', 'Peso, evolução, fraldas e exame comportamental.', '[data-wizard-step="4"]');
    await next(page, 5);

    const feeding = page.locator('[data-wizard-step="5"]');
    await feeding.locator('[data-encounter-choice][data-field="position"][data-value="Tradicional"]').click();
    await feeding.locator('[data-encounter-choice][data-field="latch"][data-value="Adequada após ajuste"]').click();
    await feeding.locator('[data-encounter-choice][data-field="suckSwallow"][data-value="Sucção rítmica"]').click();
    await feeding.locator('[data-encounter-choice][data-field="suckSwallow"][data-value="Deglutição audível"]').click();
    await feeding.locator('[data-encounter-field="notes"]').fill('Na posição tradicional com ajuste do apoio e maior aproximação, observou-se abertura ampla da boca, pega mais profunda e movimentos de sucção-deglutição coordenados. Mãe referiu diminuição da dor de 6/10 para 2/10 durante a mamada observada.');
    await capture(page, '12-avaliacao-mamada', 'Etapa 5 — observação da mamada', 'Posição, pega, sucção, deglutição e resposta à intervenção.', '[data-wizard-step="5"]');
    await next(page, 6);

    await page.locator('[data-wizard-step="6"] [data-encounter-field="objectives"]').fill('Promover mamadas confortáveis, otimizar pega e posicionamento, manter acompanhamento da evolução do bebê e dar autonomia à família para identificar sinais de alimentação eficaz.');
    await page.locator('[data-wizard-step="6"] [data-encounter-field="instructions"]').fill('Aproximar Helena do corpo, sustentar nuca/ombros sem pressionar a cabeça, aguardar abertura ampla da boca e aproximar a bebê da mama. Observar deglutições e conforto; caso haja dor persistente, interromper o vácuo suavemente e reposicionar. Procurar avaliação profissional se sinais de alerta surgirem.');
    await page.locator('[data-wizard-step="6"] [data-encounter-field="followup"]').selectOption({ label: '7 dias' });
    await capture(page, '13-orientacao-unica', 'Etapa 6 — orientação única', 'Opção de plano único mantida, com condutas clínicas completas.', '[data-single-care-panel]');
    await page.locator('[name="care-orientation-mode"][value="weekly"]').check();
    await expect(page.locator('[data-weekly-care-plan]')).toBeVisible();

    const plans = [
      'Semana 1: praticar posicionamento confortável em cada mamada, observar abertura ampla da boca, queixo próximo à mama e ausência de dor persistente. Registrar dúvidas, diurese e conforto materno; retornar antes se necessário.',
      'Semana 2: reavaliar a técnica aprendida e a evolução das mamadas. Observar se a família identifica sinais de transferência e saciedade. Ajustar postura, alternar posições conforme conforto e manter seguimento individualizado.',
      'Semana 3: revisar rotina de livre demanda e estratégias de descanso da família. Acompanhar evolução ponderal em avaliação profissional e observar sinais que indiquem necessidade de reavaliação.',
      'Semana 4: consolidar a autonomia na amamentação e revisar objetivos atingidos. Preparar plano de continuidade com contatos de suporte e recomendações para novas dúvidas ou sinais de alerta.',
    ];
    await page.locator('[data-weekly-start]').fill('2026-10-22');
    for (let i = 0; i < plans.length; i++) {
      await page.locator('[data-weekly-add]').click();
      await page.locator('[data-weekly-entry]').nth(i).locator('[data-weekly-instructions]').fill(plans[i]);
    }
    await expect(page.locator('[data-weekly-entry]')).toHaveCount(4);
    await capture(page, '14-orientacoes-semanais', 'Etapa 6 — quatro semanas de orientações', 'Plano semanal com conteúdo individualizado e quatro semanas completas.', '[data-weekly-care-plan]');
    await next(page, 7);
    await capture(page, '15-finalizacao', 'Etapa 7 — finalização', 'Resumo real do atendimento e escolha do PDF para a família.', '[data-wizard-step="7"]');

    await mkdir(ROOT, { recursive: true });
    const waitingDownload = page.waitForEvent('download');
    await page.locator('[data-action="print-plan"]').click();
    const downloaded = await waitingDownload;
    const pdfPath = join(ROOT, 'orientacoes-familia-exportado-pelo-sistema.pdf');
    await downloaded.saveAs(pdfPath);
    const chunks = [];
    const stream = await downloaded.createReadStream();
    for await (const c of stream) chunks.push(c);
    const pdfText = Buffer.concat(chunks).toString('latin1');
    expect(pdfText).toContain('%PDF-');
    for (const number of [1, 2, 3, 4]) expect(pdfText).toContain('Orientações - Semana ' + number);
    await capture(page, '16-pdf-gerado', 'PDF da família gerado pelo sistema', 'Exportação real concluída; o PDF original consta neste mesmo artefato.', '[data-action="print-plan"]');

    await page.locator('[data-wizard-next]:visible').click();
    await expect(page.locator('[data-patient-title]')).toContainText(motherName);
    await expect(page.locator('[data-app-toast]')).toContainText('Atendimento salvo com segurança.');
    await capture(page, '17-atendimento-salvo', 'Atendimento finalizado e salvo', 'Retorno ao prontuário após gravação clínica, sem duplicações.', '[data-patient-title]');
    await page.reload();
    await expect(page.locator('[data-patient-title]')).toContainText(motherName);
    await expect(page.locator('[data-action="print-care-plan-encounter"]:visible').first()).toBeVisible();
    await capture(page, '18-persistencia-prontuario', 'Prontuário após recarregar', 'Evidência de persistência e botão para reimprimir orientações.', '[data-patient-title]');

    await enterNav(page, 'agenda');
    await capture(page, '19-agenda', 'Agenda de atendimentos', 'Consultas registradas na base local de testes.', '[data-screen="agenda"]');
    await enterNav(page, 'followups');
    await capture(page, '20-followups', 'Acompanhamentos', 'Tela real dos follow-ups após atendimento.', '[data-screen="followups"]');
    await enterNav(page, 'finance');
    await capture(page, '21-financeiro', 'Financeiro', 'Lançamentos vinculados à jornada real.', '[data-screen="finance"]');
    await enterNav(page, 'settings');
    await capture(page, '22-configuracoes', 'Configurações', 'Preferências e modelos padrão de documentos.', '[data-screen="settings"]');

    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR',
    });
    try {
      const mp = await mobile.newPage();
      await login(mp);
      await capture(mp, '23-mobile-inicio', 'Mobile — início', 'Tela real em viewport equivalente a smartphone.', '[data-screen="home"]');
      await mp.locator('[data-mobile-target="patients"]:visible').click();
      await capture(mp, '24-mobile-pacientes', 'Mobile — pacientes', 'Lista mobile preenchida com seis famílias fictícias.', '[data-screen="patients"]');
      await mp.goto('/app/#/patient/' + patient.mother.id);
      await expect(mp.locator('[data-patient-title]')).toContainText(motherName);
      await capture(mp, '25-mobile-prontuario', 'Mobile — prontuário', 'Dados clínicos e histórico pós-atendimento.', '[data-patient-title]');
      await mp.locator('[data-mobile-target="agenda"]:visible').click();
      await capture(mp, '26-mobile-agenda', 'Mobile — agenda', 'Visualização de atendimento no celular.', '[data-screen="agenda"]');
      await mp.locator('[data-mobile-target="more"]:visible').click();
      await capture(mp, '27-mobile-menu', 'Mobile — menu', 'Menu e acesso aos recursos complementares.', '[data-screen="more"]');
    } finally {
      await mobile.close();
    }

    expect(errors).toEqual([]);
    await writeFile(join(ROOT, 'qa-status.json'), JSON.stringify({ success: true, mother: motherName, baby: babyName, total: sections.length, source: 'Playwright + Cloudflare local D1, without production data' }, null, 2));
  } finally {
    await mkdir(ROOT, { recursive: true });
    await writeFile(join(ROOT, 'screenshots.json'), JSON.stringify(sections, null, 2));
  }
});
