// Projeção canônica: aplicada DEPOIS dos patches legados e antes do manifesto de build.
// Não alterar o bundle materializado isoladamente: a próxima compilação o substituiria.
export function applyMotherOnlyPatientMaterialization(replaceText) {
  replaceText('index.html',
    'Cadastre uma mãe e pelo menos um bebê para começar.',
    'Cadastre uma mãe e adicione o bebê quando desejar.',
    'mother-only-empty-state');

  replaceText('index.html',
    '<h2>Dados dos bebês</h2><p>Cadastre um bebê ou adicione irmãos/gêmeos quando necessário.</p>',
    '<h2>Dados dos bebês (opcional)</h2><p>É possível salvar somente a mãe e adicionar um ou mais bebês posteriormente.</p>',
    'mother-only-form-copy');

  replaceText('index.html',
    'data-action="add-weight"',
    'data-action="patient-add-baby">+ Adicionar bebê</button><button data-action="add-weight"',
    'mother-only-patient-quick-add-baby');

  replaceText('core/app-shell.js',
    "  const babies = names.length > 1 ? \x60\x24{names.slice(0, -1).join(', ')} e \x24{names.at(-1)}\x60 : names[0] || 'bebê';",
    "  if (!names.length) return patient?.mother?.name || 'Mãe';\n  const babies = names.length > 1 ? \x60\x24{names.slice(0, -1).join(', ')} e \x24{names.at(-1)}\x60 : names[0];",
    'mother-only-patient-label');

  replaceText('core/app-shell.js',
    "'Bebê não informado'",
    "'Nenhum bebê cadastrado'",
    'mother-only-patient-card-label');

  replaceText('core/app-shell.js',
    "\x60\x24{patient.mother.name} · \x24{babyNames(patient).join(' e ') || 'bebê'}\x60",
    "\x60\x24{patient.mother.name} · \x24{babyNames(patient).join(' e ') || 'Nenhum bebê cadastrado'}\x60",
    'mother-only-patient-subtitle');

  replaceText('core/app-shell.js',
    "  renderBabySelector(patient, selectedBaby?.id);\n  renderBabyDetails(selectedBaby);",
    "  renderBabySelector(patient, selectedBaby?.id);\n  renderBabyDetails(selectedBaby);\n  document.querySelector('[data-action=\"add-weight\"]')?.toggleAttribute('hidden', babies.length === 0);",
    'mother-only-hide-baby-weight-action');

  // Prontuários pré-natais seguem acessíveis no histórico da mãe depois do parto.
  replaceText('core/app-shell.js',
    "encounters.filter((encounter) => encounter.baby_id === selectedBaby.id || allowedEncounterIds.has(encounter.id))",
    "encounters.filter((encounter) => encounter.baby_id === selectedBaby.id || allowedEncounterIds.has(encounter.id) || (!encounter.baby_id && (!Array.isArray(encounter.identification?.babyIds) || encounter.identification.babyIds.length === 0)))",
    'mother-only-keep-prenatal-timeline-after-birth');

  replaceText('core/app-shell.js',
    "if (!encounters.length) { root.innerHTML = '<div class=\"empty-live\">Nenhum atendimento clínico registrado para o bebê selecionado.</div>'; return; }",
    "if (!encounters.length) { root.innerHTML = '<div class=\"empty-live\">Nenhum atendimento clínico registrado para esta paciente.</div>'; return; }",
    'mother-only-timeline-copy');

  replaceText('core/app-shell.js',
    "\x24{!id && index > 0 ? '<button type=\"button\" class=\"text-button danger\" data-action=\"remove-baby-editor\">Remover</button>' : ''}",
    "\x24{!id ? '<button type=\"button\" class=\"text-button danger\" data-action=\"remove-baby-editor\">Remover</button>' : ''}",
    'mother-only-optional-baby-removal');

  replaceText('core/app-shell.js',
    '<input data-baby-field="name" required',
    '<input data-baby-field="name"',
    'mother-only-optional-name');

  replaceText('core/app-shell.js',
    "function renderBabyEditors(babies = [{}]) {\n  const root = document.querySelector('[data-babies-editor]');\n  if (!root) return;\n  const list = babies.length ? babies : [{}];",
    "function renderBabyEditors(babies = []) {\n  const root = document.querySelector('[data-babies-editor]');\n  if (!root) return;\n  const list = babies || [];",
    'mother-only-edit-with-empty-babies');

  replaceText('core/app-shell.js',
    "async function openPatientForm(motherId = null, { navigateRoute = true } = {}) {",
    "async function openPatientForm(motherId = null, { navigateRoute = true, addBaby = false } = {}) {",
    'mother-only-open-patient-editor-parameter');

  replaceText('core/app-shell.js',
    "  renderBabyEditors(patient ? familyBabies(patient) : [{}]);\n  setText('[data-patient-form-title]'",
    "  renderBabyEditors(patient ? familyBabies(patient) : [{}]);\n  if (addBaby && patient) {\n    const editor = document.querySelector('[data-babies-editor]');\n    const count = editor?.querySelectorAll('[data-baby-editor]').length || 0;\n    editor?.insertAdjacentHTML('beforeend', babyEditorMarkup({}, count));\n  }\n  setText('[data-patient-form-title]'",
    'mother-only-append-baby-on-explicit-action');

  replaceText('core/app-shell.js',
    "  if (navigateRoute) navigate('patient-form', motherId); else showScreen('patient-form');\n}",
    "  if (navigateRoute) navigate('patient-form', motherId); else showScreen('patient-form');\n  if (addBaby) {\n    const target = patientForm.querySelector('[data-baby-editor]:last-child [data-baby-field=\"name\"]');\n    target?.focus();\n    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });\n  }\n}",
    'mother-only-focus-new-baby');

  replaceText('core/app-shell.js',
    "    else if (action === 'edit-patient') await openPatientForm(currentPatientId);",
    "    else if (action === 'edit-patient') await openPatientForm(currentPatientId);\n    else if (action === 'patient-add-baby') await openPatientForm(currentPatientId, { addBaby: true });",
    'mother-only-click-add-baby');

  replaceText('core/app-shell.js',
    "\x60\x24{p.mother.name} + \x24{targets.map((baby) => baby.name).join(' e ') || babyNames(p).join(' e ')}\x60",
    "(targets.length ? \x60\x24{p.mother.name} + \x24{targets.map((baby) => baby.name).join(' e ')}\x60 : p.mother.name)",
    'mother-only-appointment-final-review');
}
