export const MANUAL_PLAN_CODE = 'pro_6m';
export const MANUAL_PLAN_MONTHS = 6;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function addMonthsUtc(value, months = MANUAL_PLAN_MONTHS) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Data inicial inválida.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + Number(months || 0));
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function manualGrantState(grant, now = new Date().toISOString()) {
  if (!grant || grant.status !== 'active') return grant?.status === 'revoked' ? 'revoked' : 'inactive';
  if (!grant.expiresAt || grant.expiresAt <= now) return 'expired';
  return 'active';
}
