import { DEMO_EMAIL } from './demo-account-fixture.mjs';

export const DEFAULT_LICENSE_ENDPOINT = 'https://obra-na-mao-comercial.nutricionistaalmeidavh.workers.dev/api/internal/product-license';

function addCalendarMonths(value, months) {
  const input = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(input.getTime())) throw new Error('invalid_demo_license_date');
  const originalDay = input.getUTCDate();
  const target = new Date(input.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(originalDay, lastDay));
  return target;
}

export async function syncDemoProLicense({
  secret,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  endpoint = DEFAULT_LICENSE_ENDPOINT,
} = {}) {
  const licenseSecret = String(secret || '').trim();
  if (!licenseSecret) throw new Error('demo_license_secret_missing');
  if (typeof fetchImpl !== 'function') throw new Error('demo_license_fetch_missing');
  const startsAt = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(startsAt.getTime())) throw new Error('invalid_demo_license_date');
  const expiresAt = addCalendarMonths(startsAt, 6).toISOString();
  const body = {
    action: 'sync',
    productCode: 'debora-lactacao',
    email: DEMO_EMAIL,
    planCode: 'pro_6m',
    status: 'active',
    expiresAt,
    source: 'demo_seed',
    externalRef: 'demo-account',
    actor: 'demo-provisioner',
  };
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-artisys-license-secret': licenseSecret,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = String(payload?.error || response.status || 'unknown');
    throw new Error(`demo_license_sync_failed:${reason}`);
  }
  return payload;
}
