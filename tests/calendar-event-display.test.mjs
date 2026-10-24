import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEventTitle, calendarEventTitlesForOwner, escapeIcsText, handleCalendarDisplayPreferences } from '../worker/calendar-event-display.js';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const item = (id, mother_id, appointment_type = 'Consulta inicial') => ({id,mother_id,appointment_type,starts_at:'2026-11-11T13:00:00Z',duration_min:60,status:'Agendado'});

test('Event titles stay anonymous unless a professional explicitly enables names', () => {
  assert.equal(calendarEventTitle(item('a','m1'), 'Mariana Costa', false),'Atendimento - Gestão Amamentação');
  assert.equal(calendarEventTitle(item('a','m1'), 'Mariana Costa', true),'Consulta — Mariana Costa');
  assert.equal(calendarEventTitle(item('a','m1','Retorno'), 'Ana Souza', true),'Retorno — Ana Souza');
  assert.equal(calendarEventTitle(item('a','m1','Acompanhamento'), 'Ana Souza', true),'Acompanhamento — Ana Souza');
  assert.equal(calendarEventTitle(item('a','m1'), '', true),'Atendimento - Gestão Amamentação');
  assert.equal(calendarEventTitle(item('a','m1'),'\r\nMÃE SENSÍVEL\t',true),'Consulta — MÃE SENSÍVEL');
});
test('ICS titles escape unsafe delimiter and injection characters', () => {
  assert.equal(escapeIcsText('Consulta — Ana, Souza; Teste\nINJECT'), 'Consulta — Ana\\, Souza\\; Teste\\nINJECT');
});
test('Preference API requires login and opts in to external name sharing explicitly', async () => {
  const runtime = await createLocalRuntime();
  const { mf, db, close, login } = runtime;
  try {
    const url='https://deboralactacao.com/api/calendar/display-preferences';
    assert.equal((await mf.dispatchFetch(url)).status,401);
    assert.equal((await mf.dispatchFetch(url,{method:'POST'})).status,401);
    const a=await login();
    const headers={authorization:'Bearer '+a.access_token};
    const initial=await mf.dispatchFetch(url,{headers});
    assert.deepEqual(await initial.json(),{show_patient_name:false});
    const set=await mf.dispatchFetch(url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({show_patient_name:true,acknowledged_external_visibility:true})});
    assert.equal(set.status,200);
    assert.equal((await set.json()).show_patient_name,true);
    const bad=await mf.dispatchFetch(url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({show_patient_name:true})});
    assert.equal(bad.status,400);
    const second=await login('other@example.test');
    const b=await mf.dispatchFetch(url,{headers:{authorization:'Bearer '+second.access_token}});
    assert.deepEqual(await b.json(),{show_patient_name:false});
    assert.equal((await (await mf.dispatchFetch(url,{headers})).json()).show_patient_name,true);
    await db.prepare('INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES(?,?,?,?)')
      .bind('mothers','m1',userId,JSON.stringify({id:'m1',owner_id:userId,name:'Mariana Costa'})).run();
    await db.prepare('INSERT INTO supabase_records (table_name,record_key,owner_id,record_json) VALUES(?,?,?,?)')
      .bind('mothers','m2','audit-other',JSON.stringify({id:'m2',owner_id:'audit-other',name:'NÃO VAZAR'})).run();
    const titles=await calendarEventTitlesForOwner({CLINICAL_DB:db},userId,[item('a','m1'),item('b','m2')]);
    assert.equal(titles.get('a'),'Consulta — Mariana Costa');
    assert.equal(titles.get('b'),'Atendimento - Gestão Amamentação');
    const off=await mf.dispatchFetch(url,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({show_patient_name:false})});
    assert.equal((await off.json()).show_patient_name,false);
  } finally { await close(); }
});
