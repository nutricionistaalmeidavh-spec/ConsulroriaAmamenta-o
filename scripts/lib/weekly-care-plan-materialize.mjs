import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Extensão na saída do materializador, antes do manifesto, sem um runtime paralelo.
export function applyWeeklyCarePlan(resolved, sourceByPath, root) {
  for (const path of ['core/lib/weekly-care-plan.js', 'features/weekly-care-plan.css']) {
    resolved.set(path, new Uint8Array(readFileSync(resolve(root, 'patch-source/weekly-care-plan', path))));
    sourceByPath.set(path, 'weekly-care-plan:' + path);
  }
  function once(source, from, to, label) {
    if (source.split(from).length !== 2) throw new Error('weekly-care-plan: marcador não canônico: ' + label);
    return source.replace(from, to);
  }
  function patch(path, apply) {
    const original = resolved.get(path);
    if (!original) throw new Error('weekly-care-plan: módulo ausente: ' + path);
    const before = Buffer.from(original).toString('utf8');
    const after = apply(before);
    if (after === before) throw new Error('weekly-care-plan: sem alteração: ' + path);
    resolved.set(path, new Uint8Array(Buffer.from(after, 'utf8')));
    sourceByPath.set(path, sourceByPath.get(path) + '+weekly-care-plan');
  }
  patch('index.html', src => {
    src = once(src, '<link rel="stylesheet" href="./styles.css">',
      '<link rel="stylesheet" href="./styles.css">\n  <link rel="stylesheet" href="./features/weekly-care-plan.css">', 'css');
    const widget = '<section class="weekly-care-plan" data-weekly-care-plan aria-label="Orientações por semana">' +
      '<h3>Orientações por semana <small>(opcional)</small></h3>' +
      '<p>Planeje orientações para as próximas semanas deste mesmo atendimento. As orientações gerais acima continuam disponíveis.</p>' +
      '<div class="weekly-care-controls" data-weekly-controls hidden>' +
      '<label class="field"><span>Início do plano semanal</span><input type="date" data-weekly-start aria-label="Data inicial do plano semanal"></label>' +
      '<small>As semanas são períodos consecutivos de sete dias.</small></div>' +
      '<div class="weekly-care-entries" data-weekly-entries></div>' +
      '<button type="button" class="ui-button ui-button-ghost" data-weekly-add>+ Adicionar semana</button></section>';
    return once(src, '<label class="field"><span>Próximo acompanhamento</span>',
      widget + '<label class="field"><span>Próximo acompanhamento</span>', 'etapa-6');
  });
  patch('core/lib/encounter-form.js', src => {
    src = once(src, 'const SECTIONS =', "import { collectWeeklyPlan, applyWeeklyPlan } from './weekly-care-plan.js';\n\nconst SECTIONS =", 'form-import');
    src = once(src, '  return state;\n}\n\nfunction savedValue',
      '  const weeklyPlan = collectWeeklyPlan(root);\n  if (weeklyPlan) state.care_plan.weekly_plan = weeklyPlan;\n  return state;\n}\n\nfunction savedValue', 'form-collect');
    return once(src, '  return state;\n}\n\nexport { SECTIONS',
      '  applyWeeklyPlan(root, state.care_plan?.weekly_plan);\n  return state;\n}\n\nexport { SECTIONS', 'form-hydrate');
  });
  patch('core/app-shell.js', src => {
    src = once(src, "import { createCarePlanPdf, safePdfFilename, normalizePdfLayout } from './lib/pdf-service.js';",
      "import { createCarePlanPdf, safePdfFilename, normalizePdfLayout } from './lib/pdf-service.js';\n" +
      "import { mountWeeklyPlan, resetWeeklyPlan, weeklyPlanError, weeklyPlanText } from './lib/weekly-care-plan.js';", 'shell-import');
    src = once(src, "const appointmentScreen = document.querySelector('[data-screen=\"appointment\"]');",
      "const appointmentScreen = document.querySelector('[data-screen=\"appointment\"]');\nmountWeeklyPlan(appointmentScreen);", 'mount');
    src = once(src, 'function resetWizard(selectedMotherId = currentPatientId) {\n  clearTimeout(encounterAutosaveTimer);',
      'function resetWizard(selectedMotherId = currentPatientId) {\n  clearTimeout(encounterAutosaveTimer);\n  resetWeeklyPlan(appointmentScreen);', 'reset');
    src = once(src, "const hasPlan = Boolean(String(plan.objectives || '').trim() || String(plan.instructions || '').trim() || (Array.isArray(plan.libraryItems) && plan.libraryItems.length));",
      "const hasPlan = Boolean(String(plan.objectives || '').trim() || String(plan.instructions || '').trim() || (Array.isArray(plan.libraryItems) && plan.libraryItems.length) || plan.weekly_plan?.weeks?.some(item => item.instructions?.trim()));", 'summary');
    src = once(src, '  const clinicalState = collectEncounterDraft(appointmentScreen);\n  const ident = clinicalState.identification || {};',
      '  const clinicalState = collectEncounterDraft(appointmentScreen);\n  const weeklyError = weeklyPlanError(clinicalState.care_plan?.weekly_plan);\n  if (weeklyError) throw new Error(weeklyError);\n  const ident = clinicalState.identification || {};', 'validation');
    src = once(src, '\n\nPróximo acompanhamento: \${draft.care_plan?.followup || \'a combinar\'}',
      '\n\n\${weeklyPlanText(draft.care_plan?.weekly_plan)}\n\nPróximo acompanhamento: \${draft.care_plan?.followup || \'a combinar\'}', 'message');
    src = once(src, 'function pdfEncounterData() {\n  const draft = collectEncounterDraft(appointmentScreen);\n  const selectedBabies = selectedWizardBabies();',
      'function pdfEncounterData(draft = collectEncounterDraft(appointmentScreen), selectedBabies = selectedWizardBabies()) {', 'pdf-record');
    src = once(src, "objectives: draft.care_plan?.objectives || '', instructions: draft.care_plan?.instructions || '', followup: draft.care_plan?.followup || 'A combinar', babySummaries",
      "objectives: draft.care_plan?.objectives || '', instructions: draft.care_plan?.instructions || '', weeklyPlan: draft.care_plan?.weekly_plan || null, followup: draft.care_plan?.followup || 'A combinar', babySummaries", 'pdf-payload');
    src = once(src, 'async function printPlan() {\n  const patient = selectedWizardPatient();',
      'async function printPlan({ encounter = null, patientOverride = null, babiesOverride = null } = {}) {\n  const patient = patientOverride || selectedWizardPatient();\n  const draft = encounter || collectEncounterDraft(appointmentScreen);\n  const babies = babiesOverride || selectedWizardBabies();', 'print-options');
    src = once(src, 'patient: patient || {}, encounter: pdfEncounterData()',
      'patient: patient || {}, encounter: pdfEncounterData(draft, babies)', 'print-body');
    src = once(src, 'async function printPlan({ encounter',
      'async function printSavedCarePlan(encounterId) {\n' +
      '  const encounter = await appData.getEncounter(encounterId);\n' +
      "  if (!encounter || encounter.status !== 'finalized') throw new Error('Atendimento finalizado não encontrado.');\n" +
      '  const patient = patientByMotherId(encounter.mother_id) || await appData.getPatient(encounter.mother_id);\n' +
      "  if (!patient) throw new Error('Paciente não encontrada.');\n" +
      '  const ids = new Set([...(encounter.identification?.babyIds || []), encounter.baby_id].filter(Boolean));\n' +
      '  const babies = familyBabies(patient).filter(b => !ids.size || ids.has(b.id));\n' +
      '  return printPlan({ encounter, patientOverride: patient, babiesOverride: babies });\n' +
      '}\nasync function printPlan({ encounter', 'print-saved');
    const tick = String.fromCharCode(96);
    const replacement = '<em>\${cta}</em></button>\${e.status === "draft" ? "" : ' +
      tick + '<button type="button" class="text-button" data-action="print-care-plan-encounter" data-encounter-id="\${escapeHTML(e.id)}">Imprimir plano</button>' + tick + '}</div>';
    src = once(src, '<em>\${cta}</em></button></div>', replacement, 'history-print');
    return once(src, "else if (action === 'open-clinical-note') await window.DeboraClinicalNote?.openEncounter?.(actionEl.dataset.encounterId);",
      "else if (action === 'open-clinical-note') await window.DeboraClinicalNote?.openEncounter?.(actionEl.dataset.encounterId);\n    else if (action === 'print-care-plan-encounter') await printSavedCarePlan(actionEl.dataset.encounterId);", 'history-action');
  });
  patch('core/lib/pdf-service.js', src => {
    src = once(src, 'function latin1Bytes(value) {',
      "import { weeklyPlanPdfSections } from './weekly-care-plan.js';\n\nfunction latin1Bytes(value) {", 'pdf-import');
    src = once(src, '  return sections;\n}\n\nconst THEMES',
      '  sections.splice(sections.length - 1, 0, ...weeklyPlanPdfSections(encounter.weeklyPlan));\n  return sections;\n}\n\nconst THEMES', 'pdf-sections');
    const from = src.indexOf('function paginateSections(');
    const to = src.indexOf('\nexport function createCarePlanPdf(', from);
    if (from < 0 || to < 0) throw new Error('weekly-plan: paginador canônico ausente');
    const pager = [
      'function paginateSections(sections, maxLines = 28) {',
      '  const pages = [];',
      '  let current = [], used = 0;',
      '  function push(section) {',
      '    const cost = Math.max(2, section.lines.length + 2);',
      '    if (current.length && used + cost > maxLines) { pages.push(current); current = []; used = 0; }',
      '    current.push(section); used += cost;',
      '  }',
      '  for (const section of sections) {',
      '    const lines = section.lines.flatMap(line => wrapLine(line, 82));',
      '    const chunkSize = Math.max(1, maxLines - 2);',
      '    if (!lines.length) { push({ ...section, lines: [""] }); continue; }',
      '    for (let offset = 0; offset < lines.length; offset += chunkSize) {',
      '      const title = offset ? section.title + " (continuação)" : section.title;',
      '      push({ ...section, title, lines: lines.slice(offset, offset + chunkSize) });',
      '    }',
      '  }',
      '  if (current.length) pages.push(current);',
      '  return pages.length ? pages : [[{ title: "Plano de cuidado", lines: ["Sem conteúdo informado."] }]];',
      '}',
      ''
    ].join('\n');
    return src.slice(0, from) + pager + src.slice(to);
  });
}
