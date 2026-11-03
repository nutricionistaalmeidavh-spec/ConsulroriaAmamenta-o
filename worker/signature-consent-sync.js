import { guardedRecordStatement } from './d1-record-store.js';
import { getConsultantConsentDocument } from '../public/consultant-consent-content.js';

const nowId=()=>crypto.randomUUID();
const typeIsNotice=type=>type==='data_processing';

export class ConsentSupersededError extends Error {
  constructor(){super('signature_consent_superseded');this.code='signature_consent_superseded'}
}

/**
 * Create a fail-closed, atomic D1 update plan. Never call it on a draft or on
 * behalf of the consultant: only the mother's explicit signed acceptance can
 * change the clinical consent record.
 *
 * The guard is an INSERT with CHECK-protected actor_role, not a no-op UPDATE:
 * when a concurrent edit changes even one consent JSON record, D1.batch rolls
 * back the PDF version, status, token revocation AND all consent writes.
 */
export async function canonicalConsentStatements(db,entry,when,documentHash) {
  const fetched=await db.prepare(`SELECT record_key,record_json FROM supabase_records
    WHERE table_name='consents' AND owner_id=?
      AND json_extract(record_json,'$.mother_id')=?
      AND json_extract(record_json,'$.consent_type')=?`)
    .bind(entry.owner_id,entry.mother_id,entry.consent_type).all();
  const records=(fetched.results||[]).map(row=>({key:row.record_key,raw:row.record_json,
    record:JSON.parse(row.record_json)}));
  // A newer explicit permission or revocation wins over the pending document.
  // Editing the mother's phone or administrative fields is not a revocation.
  if(records.some(({record})=>
    (record.revoked_at&&record.revoked_at>entry.created_at)||
    (record.accepted_at&&record.accepted_at>entry.created_at)
  ))throw new ConsentSupersededError();
  const model=getConsultantConsentDocument(entry.consent_type);
  if(!model)throw new Error('signature_consent_model_missing');
  const n=records.length;
  const cases=n?records.map(()=>'(record_key=? AND record_json=?)').join(' OR '):'0';
  const values=records.flatMap(row=>[row.key,row.raw]);
  const guard=db.prepare(`INSERT INTO signature_events
    (id,request_id,owner_id,event_type,actor_role,event_at,metadata_json)
    VALUES (?,?,?,'consent_sync_guard',
      CASE WHEN
        (SELECT COUNT(*) FROM supabase_records WHERE table_name='consents' AND owner_id=?
          AND json_extract(record_json,'$.mother_id')=? AND json_extract(record_json,'$.consent_type')=?)=?
        AND (SELECT COUNT(*) FROM supabase_records WHERE table_name='consents'
          AND owner_id=? AND (${cases}))=?
      THEN 'system' ELSE 'stale' END,
      ?,?)`).bind(nowId(),entry.id,entry.owner_id,
       entry.owner_id,entry.mother_id,entry.consent_type,n,
       entry.owner_id,...values,n,when,JSON.stringify({document_sha256:documentHash,record_count:n}));
  const stamp={signature_request_id:entry.id,signature_document_sha256:documentHash,
    signature_evidence_type:'electronic_signature',signature_recorded_at:when};
  const writes=(records.length?records:[{key:nowId(),record:null}]).map(({key,record})=>{
    const base=record||{id:key,owner_id:entry.owner_id,mother_id:entry.mother_id,
      consent_type:entry.consent_type,created_at:when,granted:false,accepted_at:null,revoked_at:null};
    const updated=typeIsNotice(entry.consent_type)
      ?{...base,signature_notice_request_id:entry.id,notice_acknowledged_at:when,
         notice_document_sha256:documentHash}
      :{...base,...stamp,granted:true,accepted_at:when,revoked_at:null,
         version:entry.consent_type==='clinical_media'?'1.1':model.modelVersion};
    return guardedRecordStatement(db,'consents',key,updated,entry.owner_id,when);
  });
  return [guard,...writes];
}
