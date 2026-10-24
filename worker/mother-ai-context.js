import {canPublishToMother} from '../public/mother-portal-contract.js';

/**
 * Phase 4: Clinician-approved projections ONLY. Never read clinical_encounters
 * or send private patient records to a model. Only the explicit publication in
 * member_shared_items is an authorization to display its safe body.
 */
export async function selectMotherApprovedOrientations(db,ownerId,motherId) {
  if(!ownerId||!motherId) return [];
  const response=await db.prepare(
    "SELECT record_json FROM supabase_records WHERE table_name='member_shared_items' AND owner_id=? AND json_extract(record_json,'$.mother_id')=? AND json_extract(record_json,'$.published')=1 ORDER BY source_updated_at DESC LIMIT 30"
  ).bind(ownerId,motherId).all();
  return (response.results||[]).flatMap(row=>{
    try {
      const entry=JSON.parse(row.record_json);
      if(!['care_plan','orientation'].includes(String(entry.kind)) || !canPublishToMother(entry) || entry.published!==true)
        return [];
      const title=String(entry.title||'').trim().slice(0,120);
      const body=String(entry.body||'').trim().slice(0,1200);
      if(!title||!body) return [];
      return [{id:String(entry.id||''),kind:entry.kind,title,body,occurred_at:String(entry.occurred_at||'')}];
    }catch{return []}
  }).slice(0,3);
}
/** Limits only already-published text; each week is quoted as originally approved. */
export function publishedOrientationContext(rows=[]) {
  return rows.slice(0,2).map((row,index)=>'[ORIENTAÇÃO '+(index+1)+'] '+row.title+'\n'+row.body.slice(0,850))
    .join('\n\n').slice(0,1800);
}