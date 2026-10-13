import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordByIdForOwner } from './d1-record-store.js';
import { runtimeJson } from './cloudflare-data-runtime.js';

const CANCEL_PATH = '/api/clinical/rpc/cancel_financial_entry';

// Financial entries are retained and linked to clinical/package records.
// "Excluir" hides a pending entry by cancelling it; it never deletes the D1 row.
export async function handleFinancialEntryCancelRuntime(request, env, url = new URL(request.url)) {
  if (url.pathname !== CANCEL_PATH) return null;
  if (request.method !== 'POST') return runtimeJson(405, { message: 'Método não permitido.' });
  if (!env.CLINICAL_DB) return runtimeJson(503, { message: 'Banco clínico indisponível.' });
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { message: 'Sessão expirada. Entre novamente.' });
  const payload = await request.clone().json().catch(() => null);
  if (!payload || String(payload.p_confirmation || '') !== 'EXCLUIR') {
    return runtimeJson(400, { message: 'Confirme a exclusão do lançamento.' });
  }
  const id = String(payload.p_entry_id || '').trim();
  if (!id) return runtimeJson(400, { message: 'Informe o lançamento.' });
  const db = env.CLINICAL_DB;
  const before = await recordByIdForOwner(db, 'financial_entries', id, user.id);
  if (!before) return runtimeJson(404, { message: 'Lançamento não encontrado nesta conta.' });
  const existingStatus = String(before.record?.status || '');
  if (existingStatus === 'Cancelado') {
    return runtimeJson(200, { id: before.record.id || id, status: 'Cancelado', idempotent: true });
  }
  if (existingStatus !== 'Pendente' || before.record?.paid === true || before.record?.paid_at) {
    return runtimeJson(409, {
      message: 'Somente lançamentos pendentes podem ser excluídos. Se estiver pago, desfaça primeiro o pagamento.',
    });
  }
  const now = new Date().toISOString();
  try {
    const result = await db.prepare(`UPDATE supabase_records
      SET record_json = json_set(record_json,
        '$.status','Cancelado',
        '$.cancelled_at',?,
        '$.cancelled_by',?,
        '$.cancelled_reason','manual_financial_card',
        '$.updated_at',?),
        source_updated_at = ?, migrated_at = ?
      WHERE table_name='financial_entries' AND record_key=? AND owner_id=?
        AND json_extract(record_json,'$.status')='Pendente'
        AND COALESCE(json_extract(record_json,'$.paid'),0)=0
        AND COALESCE(json_extract(record_json,'$.paid_at'),'')='' `)
      .bind(now, user.id, now, now, now, before.key, user.id).run();
    if (Number(result?.meta?.changes || 0) === 1) {
      return runtimeJson(200, { id: before.record.id || id, status: 'Cancelado', cancelled_at: now, idempotent: false });
    }
    const after = await recordByIdForOwner(db, 'financial_entries', id, user.id);
    if (after?.record?.status === 'Cancelado') return runtimeJson(200, { id: after.record.id || id, status: 'Cancelado', idempotent: true });
    if (!after) return runtimeJson(404, { message: 'Lançamento não encontrado nesta conta.' });
    return runtimeJson(409, { message: 'Lançamento alterado durante a exclusão. Atualize o Financeiro.' });
  } catch (error) {
    console.error('financial entry cancellation failed', error);
    return runtimeJson(503, { message: 'Não foi possível excluir o lançamento. Tente novamente.' });
  }
}
