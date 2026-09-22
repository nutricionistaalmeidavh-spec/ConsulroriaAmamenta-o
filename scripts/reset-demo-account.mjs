import { pathToFileURL } from 'node:url';
import { buildDemoFixture, deriveDemoCredential, DEMO_EMAIL, DEMO_USER_ID } from './demo-account-fixture.mjs';
import { buildResetAndSeedSql, validateDemoIdentityRows } from './demo-account-sql.mjs';
import { probeDemoIdentity, executeD1Sql } from './demo-account-d1.mjs';
import { syncDemoProLicense } from './demo-account-license.mjs';

export async function resetDemoAccount({
  password = process.env.DEMO_PASSWORD,
  licenseSecret = process.env.LICENSE_SERVICE_SECRET,
  now = new Date(),
  probeIdentity = probeDemoIdentity,
  syncLicense = syncDemoProLicense,
  writeSql = executeD1Sql,
} = {}) {
  const credential = deriveDemoCredential(password);
  const secret = String(licenseSecret || '').trim();
  if (!secret) throw new Error('demo_license_secret_missing');
  const identity = validateDemoIdentityRows(await probeIdentity());
  if (!identity.exists) throw new Error('demo_identity_missing');
  const fixture = buildDemoFixture(now);
  await syncLicense({ secret, now });
  await writeSql(buildResetAndSeedSql({ fixture, credential }));
  return {
    email: DEMO_EMAIL,
    userId: DEMO_USER_ID,
    plan: 'pro_6m',
    created: false,
    reset: true,
    patients: fixture.records.filter((entry) => entry.table === 'mothers').length,
    babies: fixture.records.filter((entry) => entry.table === 'babies').length,
  };
}

async function main() {
  const result = await resetDemoAccount();
  console.log(`Demo restaurado: ${result.email} | plano ${result.plan} | ${result.patients} mães | ${result.babies} bebês.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Falha ao restaurar demo: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
