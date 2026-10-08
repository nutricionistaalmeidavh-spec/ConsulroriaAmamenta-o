// Plano semanal é uma projeção da seção care_plan do mesmo atendimento.
// Não cria registros clínicos, follow-ups ou fontes de verdade adicionais.
const DAY = 86400000;

export function validStartDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(date + 'T12:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

export function normalizeWeeklyPlan(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.weeks) || !value.weeks.length) return null;
  return {
    start_date: validStartDate(value.start_date),
    weeks: value.weeks.map((entry, index) => ({
      week: index + 1,
      instructions: String(entry?.instructions ?? '')
    }))
  };
}

export function weekPeriodLabel(startDate, week) {
  const start = validStartDate(startDate);
  if (!start) return '';
  const from = new Date(start + 'T12:00:00Z');
  const begin = new Date(from.getTime() + (week - 1) * 7 * DAY);
  const end = new Date(begin.getTime() + 6 * DAY);
  const fmt = date => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  return fmt(begin) + ' a ' + fmt(end);
}

export function weeklyPlanError(value) {
  const plan = normalizeWeeklyPlan(value);
  if (!plan) return null;
  if (!plan.start_date) return 'Informe a data inicial das orientações por semana.';
  if (plan.weeks.some(({ instructions }) => !instructions.trim())) {
    return 'Preencha ou remova as semanas sem orientações antes de finalizar.';
  }
  return null;
}

export function weeklyPlanText(value) {
  const plan = normalizeWeeklyPlan(value);
  if (!plan) return '';
  return plan.weeks.filter(entry => entry.instructions.trim()).map(({ week, instructions }) => {
    const period = weekPeriodLabel(plan.start_date, week);
    return 'Semana ' + week + (period ? ' (' + period + ')' : '') + ':\n' + instructions.trim();
  }).join('\n\n');
}

export function weeklyPlanPdfSections(value) {
  const plan = normalizeWeeklyPlan(value);
  if (!plan) return [];
  return plan.weeks.filter(entry => entry.instructions.trim()).map(({ week, instructions }) => ({
    title: 'Orientações - Semana ' + week,
    lines: [
      ...(weekPeriodLabel(plan.start_date, week) ? ['Período: ' + weekPeriodLabel(plan.start_date, week)] : []),
      ...instructions.trim().split(/\r?\n/)
    ]
  }));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function sectionOf(root) { return root?.querySelector?.('[data-weekly-care-plan]') || null; }

export function collectWeeklyPlan(root) {
  const section = sectionOf(root);
  if (!section) return null;
  const entries = [...section.querySelectorAll('[data-weekly-entry]')];
  if (!entries.length) return null;
  return normalizeWeeklyPlan({
    start_date: section.querySelector('[data-weekly-start]')?.value || '',
    weeks: entries.map((entry, index) => ({
      week: index + 1,
      instructions: entry.querySelector('[data-weekly-instructions]')?.value || ''
    }))
  });
}

function render(root, value) {
  const section = sectionOf(root);
  if (!section) return;
  const plan = normalizeWeeklyPlan(value);
  const weeks = plan?.weeks || [];
  const fallback = root?.querySelector?.('[data-encounter-field="startsAt"]')?.value?.slice(0, 10) || '';
  const start = plan?.start_date || fallback;
  const controls = section.querySelector('[data-weekly-controls]');
  if (controls) controls.hidden = weeks.length === 0;
  const startInput = section.querySelector('[data-weekly-start]');
  if (startInput) startInput.value = start;
  const host = section.querySelector('[data-weekly-entries]');
  if (!host) return;
  host.innerHTML = weeks.map(({week,instructions}) => {
    const period = weekPeriodLabel(start, week);
    return '<article class="weekly-care-entry" data-weekly-entry>' +
      '<div class="weekly-care-entry-head"><div><strong>Semana ' + week + '</strong>' +
      '<small data-weekly-period>' + esc(period) + '</small></div>' +
      '<button type="button" class="text-button" data-weekly-remove="' + week + '" aria-label="Remover semana ' + week + '">Remover</button></div>' +
      '<label class="field"><span>Orientações da semana ' + week + '</span>' +
      '<textarea rows="4" data-weekly-instructions placeholder="O que a família deverá seguir nesta semana?">' + esc(instructions) + '</textarea></label>' +
      '</article>';
  }).join('');
  const addButton = section.querySelector('[data-weekly-add]');
  if (addButton) addButton.textContent = weeks.length ? '+ Adicionar outra semana' : '+ Adicionar semana';
}

export function applyWeeklyPlan(root, value) { render(root, value); }
export function resetWeeklyPlan(root) { render(root, null); }

export function mountWeeklyPlan(root) {
  const section = sectionOf(root);
  if (!section || section.dataset.weeklyMounted === '1') return;
  section.dataset.weeklyMounted = '1';
  section.addEventListener('click', event => {
    const add = event.target.closest('[data-weekly-add]');
    const remove = event.target.closest('[data-weekly-remove]');
    if (!add && !remove) return;
    event.preventDefault();
    const current = collectWeeklyPlan(root);
    const weeks = current?.weeks || [];
    const start_date = current?.start_date || section.querySelector('[data-weekly-start]')?.value
      || root.querySelector('[data-encounter-field="startsAt"]')?.value?.slice(0, 10) || '';
    if (add) {
      if (weeks.length >= 104) return;
      weeks.push({week: weeks.length + 1, instructions: ''});
    } else {
      const idx = Number(remove.dataset.weeklyRemove) - 1;
      if (idx < 0 || idx >= weeks.length) return;
      if (weeks[idx].instructions.trim() && !window.confirm('Remover as orientações desta semana? As semanas seguintes serão renumeradas.')) return;
      weeks.splice(idx, 1);
    }
    render(root, weeks.length ? {start_date, weeks} : null);
    section.dispatchEvent(new Event('change', { bubbles: true }));
    if (add) section.querySelector('[data-weekly-entry]:last-child [data-weekly-instructions]')?.focus();
  });
  section.addEventListener('change', event => {
    if (!event.target.matches('[data-weekly-start]')) return;
    const date = event.target.value;
    section.querySelectorAll('[data-weekly-period]').forEach((node, index) => {
      node.textContent = weekPeriodLabel(date, index + 1);
    });
  });
  render(root, null);
}
