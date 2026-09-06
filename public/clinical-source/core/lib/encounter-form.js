const SECTIONS = ['identification','chief_complaint','maternal_assessment','baby_assessment','feeding_assessment','care_plan','finalization'];

export function normalizeEncounterState(input = {}) {
  return Object.fromEntries(SECTIONS.map((section) => [section, { ...(input?.[section] || {}) }]));
}

export function buildEncounterPayload({
  motherId,
  babyId = null,
  appointmentId = null,
  state = {},
  status = 'draft',
  now = () => new Date().toISOString()
} = {}) {
  if (!motherId) throw new Error('Selecione a mãe antes de salvar o atendimento.');
  const normalized = normalizeEncounterState(state);
  return {
    mother_id: motherId,
    baby_id: babyId || null,
    appointment_id: appointmentId || null,
    status,
    ...normalized,
    finalized_at: status === 'finalized' ? now() : null
  };
}

function valueFromControl(control) {
  if (!control) return '';
  if (control.type === 'number') return control.value === '' ? null : Number(control.value);
  if (control.type === 'checkbox') return Boolean(control.checked);
  return control.value ?? '';
}

function sectionBucket(state, section, babyId) {
  if (!babyId) return state[section];
  state[section].byBaby ||= {};
  state[section].byBaby[babyId] ||= {};
  return state[section].byBaby[babyId];
}

export function collectEncounterDraft(root) {
  const state = normalizeEncounterState();
  for (const control of root?.querySelectorAll?.('[data-encounter-field]') || []) {
    const section = control.dataset.section;
    const field = control.dataset.encounterField;
    if (!SECTIONS.includes(section) || !field) continue;
    sectionBucket(state, section, control.dataset.babyId)[field] = valueFromControl(control);
  }
  for (const control of root?.querySelectorAll?.('[data-encounter-choice][aria-pressed="true"]') || []) {
    const section = control.dataset.section;
    const field = control.dataset.field;
    const value = control.dataset.value || String(control.textContent || '').trim();
    if (!SECTIONS.includes(section) || !field || !value) continue;
    const bucket = sectionBucket(state, section, control.dataset.babyId);
    if (control.dataset.multiple === 'true') {
      const values = Array.isArray(bucket[field]) ? bucket[field] : [];
      if (!values.includes(value)) values.push(value);
      bucket[field] = values;
    } else {
      bucket[field] = value;
    }
  }
  return state;
}

function savedValue(state, section, field, babyId) {
  if (babyId) {
    const byBaby = state[section]?.byBaby?.[babyId];
    if (byBaby && Object.prototype.hasOwnProperty.call(byBaby, field)) return byBaby[field];
    // Compatibilidade com rascunhos antigos de bebê único.
    return state[section]?.[field];
  }
  return state[section]?.[field];
}

export function applyEncounterDraft(root, input = {}) {
  const state = normalizeEncounterState(input);
  for (const control of root?.querySelectorAll?.('[data-encounter-field]') || []) {
    const section = control.dataset.section;
    const field = control.dataset.encounterField;
    if (!SECTIONS.includes(section) || !field) continue;
    const value = savedValue(state, section, field, control.dataset.babyId);
    if (control.type === 'checkbox' || control.type === 'radio') control.checked = Boolean(value);
    else if (value !== undefined && value !== null) control.value = String(value);
    else control.value = '';
  }
  for (const control of root?.querySelectorAll?.('[data-encounter-choice]') || []) {
    const section = control.dataset.section;
    const field = control.dataset.field;
    const value = control.dataset.value || String(control.textContent || '').trim();
    const saved = savedValue(state, section, field, control.dataset.babyId);
    const selected = Array.isArray(saved) ? saved.includes(value) : saved === value;
    control.classList?.toggle ? control.classList.toggle('selected', selected) : (selected ? control.classList?.add?.('selected') : control.classList?.remove?.('selected'));
    control.setAttribute?.('aria-pressed', String(selected));
  }
  return state;
}

export { SECTIONS as encounterSections };
