// Contrato canônico de projeção clínica para a Área das Mães.
// Nunca expor avaliação, anamnese ou encaminhamento por decisão apenas do navegador.
const BLOCKED = /prontu[aá]rio|anamnese|encaminhamento|avalia[cç][aã]o completa|hist[oó]rico cl[ií]nico/i;
const KINDS = new Set(['care_plan','orientation','appointment','document']);
const str = value => String(value ?? '').trim();

export function canPublishToMother(item = {}) {
  const kind = str(item.kind);
  if (!KINDS.has(kind) || item.published === false || !str(item.title) || BLOCKED.test(str(item.title))) return false;
  if (kind === 'document' && !str(item.attachment_path) && !/termo|consentimento/i.test(str(item.title))) return false;
  if (kind === 'appointment' && !/retorno|pr[oó]xima consulta|pr[oó]ximo acompanhamento/i.test(str(item.title))) return false;
  return Boolean(str(item.body) || str(item.attachment_path));
}

export function isPublishedForMother(item = {}) {
  return item.published !== false && canPublishToMother(item);
}

const obj = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
  catch { return {}; }
};
function weekPeriod(date, number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str(date))) return '';
  const from = new Date(str(date) + 'T12:00:00Z');
  if (Number.isNaN(from.getTime())) return '';
  const begin = new Date(from.getTime() + (number - 1) * 7 * 86400000);
  const finish = new Date(begin.getTime() + 6 * 86400000);
  const fmt = d => new Intl.DateTimeFormat('pt-BR',{timeZone:'UTC',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
  return fmt(begin) + ' a ' + fmt(finish);
}
export function buildSafeMotherShare(encounter = {}) {
  const plan = obj(encounter.care_plan);
  const weekly = obj(plan.weekly_plan);
  const mode = plan.orientation_mode === 'weekly' || (plan.orientation_mode !== 'single' && Array.isArray(weekly.weeks) && weekly.weeks.length) ? 'weekly' : 'single';
  const instructions = mode === 'weekly'
    ? (Array.isArray(weekly.weeks) ? weekly.weeks : []).map((w,i) => {
      const detail = str(w?.instructions);
      if (!detail) return '';
      const period = weekPeriod(weekly.start_date, i + 1);
      return 'Semana ' + (i + 1) + (period ? ' (' + period + ')' : '') + '\n' + detail;
    }).filter(Boolean).join('\n\n')
    : str(plan.instructions);
  const sections = [
    str(plan.objectives) ? 'Objetivos\n' + str(plan.objectives) : '',
    instructions,
    str(plan.followup) ? 'Próximo acompanhamento\n' + str(plan.followup) : '',
  ].filter(Boolean);
  return {
    kind:'care_plan',title:'Meu plano de cuidado',body:sections.join('\n\n'),
    mother_id:str(encounter.mother_id),source_table:'clinical_encounters',source_id:str(encounter.id),
  };
}
