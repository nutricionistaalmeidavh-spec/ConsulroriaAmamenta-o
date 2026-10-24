/** Server-side member identity never trusts ids from a browser request. */
export async function verifiedMotherAiAccess(db,user) {
  if(!db||!user?.id) return null;
  const rows=await db.prepare("SELECT owner_id,record_json FROM supabase_records WHERE table_name='member_portal_access' AND json_extract(record_json,'$.member_user_id') = ? LIMIT 3")
    .bind(user.id).all();
  const active=(rows.results||[]).flatMap(row=>{
    try {
      const record=JSON.parse(row.record_json);
      const ownerId=String(row.owner_id||record.owner_id||''), motherId=String(record.mother_id||'');
      if(!ownerId||!motherId||ownerId!==String(record.owner_id||ownerId)||
        ['0','false','disabled','inactive','cancelled'].includes(String(record.active??true).toLowerCase())||
        !Number.isFinite(Date.parse(record.member_verified_at||''))||
        String(record.member_user_id)!==String(user.id))return [];
      return [{ownerId,motherId,memberUserId:String(user.id)}];
    }catch{return []}
  });
  return active.length===1 ? active[0] : null;
}