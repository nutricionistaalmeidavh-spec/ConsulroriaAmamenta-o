import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const origin = 'https://deboralactacao.com';
const calendarPath = '/api/calendar/outlook';
const name = 'Atendimento - Gestao Amamentacao';

async function api(mf, url, options = {}) {
  return mf.dispatchFetch(origin + url, options);
}

test('Outlook subscription API requires a real session and does not change Google or Apple', async () => {
  const { mf, close } = await createLocalRuntime();
  try {
    for (const [path, method] of [
      ['/status', 'GET'], ['/create', 'POST'], ['/revoke', 'POST'],
    ]) {
      const response = await api(mf, calendarPath + path, { method });
      assert.equal(response.status, 401, method + path);
    }
    const res = await api(mf, '/api/calendar/outlook/feed/' + 'a'.repeat(64) + '.ics');
    assert.equal(res.status, 404);
    const statusApple = await api(mf, '/api/calendar/apple/status');
    assert.equal(statusApple.status, 401);
  } finally { await close(); }
});

test('Each professional has an independent, revocable, read-only Outlook ICS subscription', async () => {
  const { mf, db, close, login } = await createLocalRuntime();
  try {
    const a = await login();
    const b = await login('other@example.test');
    const headersA = { authorization: 'Bearer ' + a.access_token };
    const headersB = { authorization: 'Bearer ' + b.access_token };

    const initial = await api(mf, calendarPath + '/status', { headers: headersA });
    assert.deepEqual(await initial.json(), { active: false, updated_at: null });

    const first = await api(mf, calendarPath + '/create', { method: 'POST', headers: headersA });
    assert.equal(first.status, 200);
    const info = await first.json();
    assert.equal(info.active, true);
    assert.match(info.subscription_url, /^https:\/\/deboralactacao\.com\/api\/calendar\/outlook\/feed\/[a-f0-9]{64}\.ics$/);

    const token = info.subscription_url.split('/').pop().replace('.ics', '');
    const persisted = await db.prepare('SELECT owner_id, token_hash FROM calendar_outlook_feeds WHERE owner_id=?')
      .bind(userId).first();
    assert.equal(persisted.owner_id, userId);
    assert.notEqual(token, persisted.token_hash);
    assert.match(persisted.token_hash, /^[a-f0-9]{64}$/);

    // A real second tenant must never see the first tenant's appointment.
    const appointment = { id:'appointment-private', owner_id:userId, mother_id:'MÃE-SECRETA',
      starts_at:'2026-11-03T16:30:00.000Z', duration_min:75, status:'Agendado',
      notes:'DADOS CLÍNICOS SIGILOSOS', address:'ENDEREÇO-PRIVADO' };
    const other = { ...appointment, id:'outro-tenant', owner_id:'audit-other', starts_at:'2026-11-04T13:30:00.000Z' };
    for(const row of [appointment, other]) {
      await db.prepare('INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES(?,?,?,?)')
        .bind('appointments',row.id,row.owner_id,JSON.stringify(row)).run();
    }
    const feed = await api(mf, new URL(info.subscription_url).pathname);
    assert.equal(feed.status, 200);
    assert.match(feed.headers.get('content-type'), /text\/calendar/);
    assert.match(feed.headers.get('cache-control'), /no-store/);
    assert.equal(feed.headers.get('referrer-policy'), 'no-referrer');
    const body = await feed.text();
    assert.match(body,/BEGIN:VCALENDAR/);
    assert.match(body,/BEGIN:VEVENT/);
    assert.match(body,/DTSTART:20261103T163000Z/);
    assert.match(body,/DTEND:20261103T174500Z/);
    assert.match(body,/SUMMARY:Atendimento - Gestao Amamentacao/);
    assert.doesNotMatch(body,/MÃE-SECRETA|DADOS CLÍNICOS SIGILOSOS|ENDEREÇO-PRIVADO|outro-tenant|20261104T133000Z|audit-other/);

    const head = await api(mf, new URL(info.subscription_url).pathname, {method:'HEAD'});
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const statusA = await api(mf, calendarPath + '/status', {headers:headersA});
    assert.equal((await statusA.json()).active, true);
    assert.doesNotMatch(await (await api(mf, calendarPath + '/status', {headers:headersA})).text(), new RegExp(token));
    assert.equal((await (await api(mf, calendarPath + '/status', {headers:headersB})).json()).active, false);

    const second = await (await api(mf, calendarPath + '/create', {method:'POST', headers:headersB})).json();
    assert.notEqual(second.subscription_url, info.subscription_url);
    assert.equal((await api(mf,new URL(second.subscription_url).pathname)).status,200);

    // Updating and canceling an appointment changes the next feed response.
    appointment.starts_at='2026-11-03T18:00:00.000Z';
    await db.prepare('UPDATE supabase_records SET record_json=? WHERE table_name=? AND record_key=?')
      .bind(JSON.stringify(appointment),'appointments',appointment.id).run();
    const changed=await (await api(mf,new URL(info.subscription_url).pathname)).text();
    assert.match(changed,/DTSTART:20261103T180000Z/);
    assert.doesNotMatch(changed,/DTSTART:20261103T163000Z/);
    appointment.status='Cancelado';
    await db.prepare('UPDATE supabase_records SET record_json=? WHERE table_name=? AND record_key=?')
      .bind(JSON.stringify(appointment),'appointments',appointment.id).run();
    const removed=await (await api(mf,new URL(info.subscription_url).pathname)).text();
    assert.doesNotMatch(removed,/BEGIN:VEVENT/);

    // Creating new token revokes previous token, without affecting another user's token.
    const rotated=await (await api(mf, calendarPath+'/create',{method:'POST',headers:headersA})).json();
    assert.notEqual(rotated.subscription_url,info.subscription_url);
    assert.equal((await api(mf,new URL(info.subscription_url).pathname)).status,404);
    assert.equal((await api(mf,new URL(rotated.subscription_url).pathname)).status,200);
    assert.equal((await api(mf,new URL(second.subscription_url).pathname)).status,200);
    const revoked=await api(mf,calendarPath+'/revoke',{method:'POST',headers:headersA});
    assert.deepEqual(await revoked.json(),{active:false,revoked:true});
    assert.equal((await api(mf,new URL(rotated.subscription_url).pathname)).status,404);
    assert.equal((await api(mf,new URL(second.subscription_url).pathname)).status,200);
  } finally { await close(); }
});

test('Outlook is a separate card, preserving existing Apple and limited Google integrations', () => {
  const entry=readFileSync(new URL('../worker/domain-entry.js',import.meta.url),'utf8');
  const bootstrap=readFileSync(new URL('../src/bootstrap.js',import.meta.url),'utf8');
  const outlook=readFileSync(new URL('../public/outlook-calendar-feature.js',import.meta.url),'utf8');
  assert.match(entry,/handleAppleCalendarIntegration/);
  assert.match(entry,/handleGoogleCalendarIntegration/);
  assert.match(entry,/handleOutlookCalendarIntegration/);
  assert.match(bootstrap,/outlook-calendar-feature\.js/);
  assert.match(bootstrap,/apple-calendar-feature\.js/);
  assert.match(bootstrap,/google-calendar-debora-feature\.js/);
  assert.match(outlook,/data-outlook-calendar-integration/);
  assert.match(outlook,/Assinar da Web/);
  assert.match(outlook,/Copiar link/);
  assert.match(outlook,/Link não criado/);
  assert.match(outlook,/Assine da Web no Outlook/);
  assert.doesNotMatch(outlook,/iPhone ou Mac/);
  assert.doesNotMatch(outlook,/GOOGLE_CALENDAR_CLIENT_SECRET|calendar\/apple\/create/);
});
