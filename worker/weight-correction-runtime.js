import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { guardedRecordStatement, ownerRows, recordById, recordByIdForOwner, unownedRows } from './d1-record-store.js';

function respond(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function dateKey(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}
function activeWeight(table, row) {
  if (table === 'weights' && row?.voided_at) return false;
  if (table === 'growth_measurements' && row?.weight_voided_at) return false;
  return Number.isFinite(Number(row?.weight_g)) && Number(row.weight_g) > 0 && Boolean(dateKey(row.measured_at));
}
function latestWeight(records) {
  return records.sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at) || String(b.id).localeCompare(String(a.id)))[0] || null;
}
async function ownedRecord(db, table, id, userId, babyId) {
  const owned = await recordByIdForOwner(db, table, id, userId);
  if (owned && String(owned.record?.baby_id) === babyId) return owned;
  // Legacy rows may have a null physical owner. The baby's canonical ownership
  // was already validated; never accept a row linked to another baby/account.
  const legacy = await recordById(db, table, id);
  if (!legacy || legacy.ownerId && String(legacy.ownerId) !== String(userId)) return null;
  if (legacy.record?.owner_id && String(legacy.record.owner_id) !== String(userId)) return null;
  return String(legacy.record?.baby_id) === babyId ? legacy : null;
}

export async function handleWeightCorrectionRuntime(request, env, url = new URL(request.url), deps = {}) {
  if (url.pathname !== '/api/clinical/rpc/revise_weight_measurement') return null;
  if (request.method !== 'POST') return respond(405, { error: 'method_not_allowed' });
  if (!env.CLINICAL_DB) return respond(503, { error: 'cloudflare_d1_required' });
  const user = await (deps.authenticate || authenticateClinicalRequest)(request, env);
  if (!user?.id) return respond(401, { error: 'cloudflare_auth_required' });
  const input = await request.json().catch(() => null);
  const babyId = String(input?.p_baby_id || '');
  const action = String(input?.p_action || '');
  if (!babyId || !['correct', 'void'].includes(action)) return respond(400, { error: 'invalid_revision_request' });
  const db = env.CLINICAL_DB;
  const babyEntry = await recordByIdForOwner(db, 'babies', babyId, user.id);
  if (!babyEntry) return respond(404, { error: 'baby_not_found' });

  const weightIds = input?.p_weight_ids;
  const measurementIds = input?.p_measurement_ids;
  if (!Array.isArray(weightIds) || !Array.isArray(measurementIds) || weightIds.length + measurementIds.length < 1 ||
      weightIds.length + measurementIds.length > 8 ||
      new Set(weightIds).size !== weightIds.length || new Set(measurementIds).size !== measurementIds.length) {
    return respond(400, { error: 'measurement_selection_invalid' });
  }
  const now = deps.now || new Date().toISOString();
  const weight = Number(input?.p_weight_g);
  const rawDate = String(input?.p_measured_at || '');
  const measured = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate + 'T12:00:00.000Z' : rawDate;
  const measuredTimestamp = Date.parse(measured);
  const reason = String(input?.p_reason || '').trim();
  if (action === 'correct' && (!Number.isInteger(weight) || weight < 300 || weight > 50000 ||
      !Number.isFinite(measuredTimestamp) || measuredTimestamp > Date.parse(now) ||
      dateKey(measured) !== rawDate.slice(0, 10))) {
    return respond(400, { error: 'weight_or_date_invalid', message: 'Confira o peso em gramas e a data real da pesagem.' });
  }
  if (action === 'void' && reason.length < 3) {
    return respond(400, { error: 'reason_required', message: 'Informe o motivo da invalidação.' });
  }

  const selected = [];
  for (const [table, ids] of [['weights', weightIds], ['growth_measurements', measurementIds]]) {
    for (const id of ids) {
      if (!id || typeof id !== 'string') return respond(400, { error: 'measurement_id_invalid' });
      const entry = await ownedRecord(db, table, id, user.id, babyId);
      if (!entry) return respond(404, { error: 'measurement_not_found' });
      if (!activeWeight(table, entry.record)) return respond(409, { error: 'measurement_already_invalid' });
      selected.push({ table, entry });
    }
  }
  const expectedDay = String(input?.p_expected_day || '');
  const expectedWeight = Number(input?.p_expected_weight_g);
  if (!expectedDay || !Number.isFinite(expectedWeight) || selected.some(({ entry }) =>
    dateKey(entry.record.measured_at) !== expectedDay || Number(entry.record.weight_g) !== expectedWeight)) {
    return respond(409, { error: 'measurement_changed', message: 'Esta pesagem mudou. Atualize o histórico antes de corrigir.' });
  }

  const revision = { at: now, by: user.id, action, reason: reason || null, previous: {
    measured_at: selected[0].entry.record.measured_at,
    weight_g: Number(selected[0].entry.record.weight_g),
  } };
  const statements = selected.map(({ table, entry }) => {
    const previous = entry.record;
    const row = {
      ...previous, owner_id: user.id,
      ...(action === 'correct' ? { measured_at: new Date(measuredTimestamp).toISOString(), weight_g: weight } :
        table === 'weights' ? { voided_at: now, void_reason: reason } :
          { weight_voided_at: now, weight_void_reason: reason }),
      correction_history: [...(Array.isArray(previous.correction_history) ? previous.correction_history : []), revision],
      updated_at: now,
    };
    return guardedRecordStatement(db, table, entry.key, row, user.id, now);
  });

  // Compute the projection from both canonical sources. The changed rows override
  // the old snapshot; measurement-only legacy entries remain visible and counted.
  const overrides = new Map(selected.map(({table,entry}) => {
    const old = entry.record;
    const row = action === 'correct'
      ? {...old, measured_at:new Date(measuredTimestamp).toISOString(), weight_g:weight}
      : {...old, ...(table === 'weights' ? {voided_at:now} : {weight_voided_at:now})};
    return [table + ':' + entry.key, row];
  }));
  const candidates = [];
  for (const table of ['weights', 'growth_measurements']) {
    const entries = [...await ownerRows(db, table, user.id), ...await unownedRows(db, table)];
    for (const entry of entries) {
      if (String(entry.record?.baby_id) !== babyId) continue;
      if (entry.ownerId && String(entry.ownerId) !== String(user.id)) continue;
      if (entry.record?.owner_id && String(entry.record.owner_id) !== String(user.id)) continue;
      const row = overrides.get(table + ':' + entry.key) || entry.record;
      if (activeWeight(table, row)) candidates.push(row);
    }
  }
  const latest = latestWeight(candidates);
  const projected = {
    ...babyEntry.record,
    owner_id: user.id,
    current_weight_g: latest ? Number(latest.weight_g) : Number(babyEntry.record.birth_weight_g) || null,
    current_weight_measured_at: latest?.measured_at || null,
    updated_at: now,
  };
  statements.push(guardedRecordStatement(db, 'babies', babyEntry.key, projected, user.id, now));
  await db.batch(statements);
  return respond(200, {
    ok: true, baby_id: babyId, action, revised_count: selected.length,
    current_weight_g: projected.current_weight_g, current_weight_measured_at: projected.current_weight_measured_at
  });
}
