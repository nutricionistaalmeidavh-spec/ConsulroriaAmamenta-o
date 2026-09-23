import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppData } from '../public/clinical-source/core/lib/app-data.js';

test('C01 finalization drains the active autosave and rejects any newer draft', async () => {
  const calls = [];
  let releaseDraft;
  let markDraftStarted;
  const draftStarted = new Promise((resolve) => { markDraftStarted = resolve; });
  const draftGate = new Promise((resolve) => { releaseDraft = resolve; });
  let finalizeBody = null;

  const repos = {
    client: {
      rpc: async (name, body) => {
        calls.push(name);
        if (name !== 'finalize_clinical_encounter_atomic') throw new Error(`unexpected rpc ${name}`);
        finalizeBody = body;
        return { appointment_id: 'a1', encounter_id: 'e1' };
      },
    },
    appointments: { update: async () => { throw new Error('Realizado must be deferred to atomic finalization'); } },
    encounters: {
      update: async (id, payload) => {
        calls.push(`draft:${payload.clinical_note}`);
        markDraftStarted();
        await draftGate;
        calls.push(`draft-done:${payload.clinical_note}`);
        return { id, ...payload };
      },
    },
    followups: { list: async () => [] },
    weights: { list: async () => [], create: async (payload) => payload, update: async (_id, payload) => payload },
  };

  const appData = createAppData(repos);
  await appData.updateAppointment('a1', {
    status: 'Realizado',
    starts_at: '2026-09-24T15:00:00.000Z',
    appointment_type: 'Atendimento',
  });

  const draft = appData.updateEncounter('e1', {
    status: 'draft', appointment_id: 'a1', clinical_note: 'versão anterior',
  });
  await draftStarted;

  const finalize = appData.updateEncounter('e1', {
    status: 'finalized',
    appointment_id: 'a1',
    occurred_at: '2026-09-24T15:00:00.000Z',
    identification: { startsAt: '2026-09-24T12:00', babyIds: [], value: 0, appointmentType: 'Atendimento' },
    care_plan: {},
  });

  await assert.rejects(
    appData.updateEncounter('e1', { status: 'draft', appointment_id: 'a1', clinical_note: 'save atrasado' }),
    /já está em finalização/,
  );
  assert.equal(calls.includes('finalize_clinical_encounter_atomic'), false, 'finalization must wait for the active draft');

  releaseDraft();
  await draft;
  await finalize;

  assert.deepEqual(calls, [
    'draft:versão anterior',
    'draft-done:versão anterior',
    'finalize_clinical_encounter_atomic',
  ]);
  assert.equal(finalizeBody.p_appointment_patch.status, 'Realizado');
  assert.equal(finalizeBody.p_appointment_patch.starts_at, '2026-09-24T15:00:00.000Z');
  assert.equal(finalizeBody.p_request_key, 'encounter:e1:finalize');
});

test('R08 post-finalization followup call reuses the atomic followup instead of creating a duplicate', async () => {
  let rpcCalls = 0;
  const existing = { id: 'encounter:e1:followup', encounter_id: 'e1', status: 'Pendente' };
  const repos = {
    client: { rpc: async () => { rpcCalls += 1; return { id: 'duplicate' }; } },
    followups: { list: async () => [existing] },
  };
  const appData = createAppData(repos);
  const result = await appData.createOrSupersedeFollowup({
    mother_id: 'm1', baby_id: 'b1', encounter_id: 'e1', due_at: '2026-09-25T15:00:00.000Z', notes: 'Retorno',
  });
  assert.equal(result.id, existing.id);
  assert.equal(rpcCalls, 0);
});
