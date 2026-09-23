import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hardenBillingHtml, validateBillingHtml } from '../scripts/harden-delivery9-html.mjs';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

function authHeaders(session) {
  return { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
}

async function putRecord(db, table, key, record) {
  await db.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at)
    VALUES(?,?,?,?,?,?)`)
    .bind(table, key, userId, JSON.stringify(record), '2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z')
    .run();
}

test('C08 billing markup escapes persisted plan and service labels before assigning innerHTML', () => {
  const rawSource = readFileSync(new URL('../public/billing-v2.js', import.meta.url), 'utf8');
  const source = hardenBillingHtml(rawSource);
  validateBillingHtml(source);
  const helper = source.match(/function bvEscapeHtml\(value\)\{[^\n]+\}/)?.[0];
  assert.ok(helper, 'billing runtime must define one HTML escaping helper');
  const escapeHtml = Function(`${helper}; return bvEscapeHtml;`)();
  const payload = `<img src=x onerror="globalThis.__xss=1">'&`;
  const escaped = escapeHtml(payload);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;globalThis.__xss=1&quot;&gt;&#39;&amp;');
  assert.doesNotMatch(escaped, /<img|onerror="/);

  assert.match(source, /bvEscapeHtml\(p\.service_label\|\|'Plano'\)/);
  assert.match(source, /bvEscapeHtml\(active\.service_label\|\|'Plano ativo'\)/);
  assert.match(source, /bvEscapeHtml\(item\.label\|\|'Serviço'\)/);
  assert.match(source, /data-bv-use-item="'\+bvEscapeHtml\(item\.id\)/);
  assert.match(source, /data-bv-plan-id="'\+bvEscapeHtml\(pkg\.id\)/);
  assert.match(source, /data-bv-add-item="'\+bvEscapeHtml\(pkg\.id\)/);
  assert.doesNotMatch(source, /<strong>'\+String\(item\.label/);
  assert.doesNotMatch(source, /<h2>'\+String\(pkg\.service_label/);

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const script of ['dev', 'build', 'test:frontend-cutover', 'test:stability']) {
    assert.match(pkg.scripts[script], /harden-delivery9-html\.mjs --write/, `${script} must materialize C08 hardening`);
  }
});

test('generic records API rejects unknown table names instead of creating a fake rpc table', async () => {
  const runtime = await createLocalRuntime();
  try {
    const session = await runtime.login();
    const headers = authHeaders(session);
    const created = await runtime.mf.dispatchFetch('http://localhost/api/clinical/records/rpc/delete_appointment', {
      method: 'POST', headers, body: JSON.stringify({ p_appointment_id: 'a1', p_confirmation: 'EXCLUIR' }),
    });
    assert.equal(created.status, 404);
    const body = await created.json();
    assert.equal(body.error, 'clinical_table_not_allowed');
    const count = await runtime.db.prepare("SELECT COUNT(*) AS n FROM supabase_records WHERE table_name='rpc'").first();
    assert.equal(Number(count?.n || 0), 0);

    const read = await runtime.mf.dispatchFetch('http://localhost/api/clinical/records/not_a_real_table?select=*', { headers });
    assert.equal(read.status, 404);
    assert.equal((await read.json()).error, 'clinical_table_not_allowed');
  } finally { await runtime.close(); }
});

test('generic CRUD cannot mutate domain-managed records while canonical reads remain available', async () => {
  const runtime = await createLocalRuntime();
  try {
    const session = await runtime.login();
    const headers = authHeaders(session);
    await putRecord(runtime.db, 'mothers', 'm1', { id: 'm1', owner_id: userId, name: 'Paciente' });
    await putRecord(runtime.db, 'care_packages', 'p1', {
      id: 'p1', owner_id: userId, mother_id: 'm1', service_label: 'Plano seguro', sessions_total: 2, sessions_used: 0, status: 'active',
    });

    const read = await runtime.mf.dispatchFetch('http://localhost/api/clinical/records/care_packages?id=eq.p1&select=*', { headers });
    assert.equal(read.status, 200);
    assert.equal((await read.json())[0]?.service_label, 'Plano seguro');

    for (const [method, url, body] of [
      ['POST', 'http://localhost/api/clinical/records/care_packages', { mother_id: 'm1', service_label: 'Bypass', sessions_total: 99 }],
      ['POST', 'http://localhost/api/clinical/records/care_packages?on_conflict=mother_id,service_label', { mother_id: 'm1', service_label: 'Plano seguro', sessions_total: 99 }],
      ['PATCH', 'http://localhost/api/clinical/records/care_packages?id=eq.p1', { sessions_used: 99 }],
      ['DELETE', 'http://localhost/api/clinical/records/care_packages?id=eq.p1', null],
      ['POST', 'http://localhost/api/clinical/records/growth_measurements', { baby_id: 'b1', weight_g: -1 }],
      ['POST', 'http://localhost/api/clinical/records/appointment_babies', { appointment_id: 'a1', baby_id: 'b1' }],
      ['POST', 'http://localhost/api/clinical/records/clinical_encounters', { mother_id: 'm1', status: 'draft' }],
    ]) {
      const response = await runtime.mf.dispatchFetch(url, {
        method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 405, `${method} ${url}`);
      const payload = await response.json();
      assert.equal(payload.error, 'generic_mutation_not_allowed');
    }

    const packageRow = await runtime.db.prepare("SELECT record_json FROM supabase_records WHERE table_name='care_packages' AND record_key='p1'").first();
    assert.equal(JSON.parse(packageRow.record_json).sessions_used, 0);
    const bypassCount = await runtime.db.prepare("SELECT COUNT(*) AS n FROM supabase_records WHERE table_name IN ('growth_measurements','appointment_babies','clinical_encounters')").first();
    assert.equal(Number(bypassCount?.n || 0), 0);
  } finally { await runtime.close(); }
});

test('generic CRUD still permits intentional low-level patient support writes not migrated in this stage', async () => {
  const runtime = await createLocalRuntime();
  try {
    const session = await runtime.login();
    const headers = authHeaders(session);
    const response = await runtime.mf.dispatchFetch('http://localhost/api/clinical/records/library_items', {
      method: 'POST', headers, body: JSON.stringify({ title: 'Material permitido' }),
    });
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved[0]?.title, 'Material permitido');
  } finally { await runtime.close(); }
});
