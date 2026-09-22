import { pathToFileURL } from 'node:url';
import { buildDemoFixture, deriveDemoCredential, DEMO_EMAIL, DEMO_USER_ID } from './demo-account-fixture.mjs';
import { buildSeedSql, validateDemoIdentityRows } from './demo-account-sql.mjs';
import { probeDemoIdentity, executeD1Sql } from './demo-account-d1.mjs';
import { syncDemoProLicense } from './demo-account-license.mjs';

export async function seedDemoAccount({
  password = process.env.DEMO_PASSWORD,
  licenseSecret = process.env.LICENSE_SERVICE_SECRET,
  now = new Date(),
  probeIdentity = probeDemoIdentity,
  syncLicense = syncDemoProLicense,
  writeSql = executeD1Sql,
} = {}) {
  const credential = deriveDemoCredential(password, { iterations: 100000 });
  const secret = String(licenseSecret || '').trim();
  if (!secret) throw new Error('demo_license_secret_missing');
  const fixture = buildDemoFixture(now);
  const identity = validateDemoIdentityRows(await probeIdentity());
  await syncLicense({ secret, now });
  await writeSql(buildSeedSql({ fixture, credential }));
  return {
    email: DEMO_EMAIL,
    userId: DEMO_USER_ID,
    plan: 'pro_6m',
    created: !identity.exists,
    reset: false,
    patients: fixture.records.filter((entry) => entry.table === 'mothers').length,
    babies: fixture.records.filter((entry) => entry.table === 'babies').length,
  };
}

async function main() {
  const result = await seedDemoAccount();
  console.log(`Demo pronto: ${result.email} | plano ${result.plan} | ${result.patients} mães | ${result.babies} bebês.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Falha ao criar demo: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
