import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODE = process.argv.includes('--write') ? 'write' : 'check';
const PATH = resolve(ROOT, 'public/clinical-source/features/clinical-note-feature.js');
const MANIFEST_PATH = resolve(ROOT, 'public/clinical-source/manifest.json');

const stateLine = "const cnState={encounter:null,mother:null,babies:[],addenda:[],revisions:[],saveTimer:null,saving:false,editRevision:0,persistedRevision:0,saveChain:Promise.resolve(),pendingBody:null,pendingButton:null,direction:'forward',opening:false};";

const resolveLine = "async function cnResolveEncounter(encounterId){if(!encounterId||!/^[0-9a-f-]{36}$/i.test(encounterId))throw new Error('encounter_id persistido é obrigatório para abrir o prontuário.');const rows=await cnRest(`clinical_encounters?id=eq.${encodeURIComponent(encounterId)}&select=id,status,owner_id,professional_id,mother_id,baby_id,appointment_id,identification,clinical_note,clinical_note_author_email,clinical_note_created_at,clinical_note_updated_at,occurred_at,updated_at,record_version&limit=1`),hit=rows?.[0];if(!hit)throw new Error('Prontuário não encontrado ou sem permissão.');const [moms,links,adds,revisions]=await Promise.all([cnRest(`mothers?id=eq.${encodeURIComponent(hit.mother_id)}&select=id,name,email,phone&limit=1`),cnRest(`clinical_encounter_babies?encounter_id=eq.${encodeURIComponent(hit.id)}&select=baby_id,is_primary&order=created_at.asc`),cnRest(`clinical_encounter_addenda?encounter_id=eq.${encodeURIComponent(hit.id)}&select=id,body,author_email,created_at&order=created_at.asc`),cnRest(`clinical_note_revisions?encounter_id=eq.${encodeURIComponent(hit.id)}&select=id,changed_at,professional_id&order=changed_at.desc&limit=20`)]);const linkedIds=(links||[]).map(x=>x.baby_id);if(hit.baby_id&&!linkedIds.includes(hit.baby_id))linkedIds.push(hit.baby_id);let babies=[];if(linkedIds.length){const inList=linkedIds.join(',');babies=await cnRest(`babies?mother_id=eq.${encodeURIComponent(hit.mother_id)}&id=in.(${inList})&select=id,mother_id,name,birth_date,sex,birth_weight_g,current_weight_g&order=created_at.asc`);if((babies||[]).length!==linkedIds.length)throw new Error('Vínculo mãe–bebê inconsistente no prontuário.')}cnState.encounter=hit;cnState.mother=moms?.[0]||null;cnState.babies=babies||[];cnState.addenda=adds||[];cnState.revisions=revisions||[];cnState.editRevision=0;cnState.persistedRevision=0;cnState.pendingBody=null;cnState.saveChain=Promise.resolve();return hit}";

const saveBlock = `async function cnPersistSave(item){const enc=cnState.encounter;if(!enc?.id)throw new Error('Prontuário sem encounter_id.');const text=String(item?.body??'');if(text===String(enc.clinical_note||'')){cnState.persistedRevision=Math.max(cnState.persistedRevision,Number(item?.revision||0));cnStatus('Sincronizado com o banco','saved');return enc}cnState.saving=true;cnStatus('Salvando no SQL…','saving');const jwt=cnJwt(),now=new Date().toISOString(),expectedVersion=Number(enc.record_version??0);try{const payload={_expected_version:expectedVersion,clinical_note:text,clinical_note_author_id:jwt.sub||enc.professional_id||null,clinical_note_author_email:jwt.email||enc.clinical_note_author_email||'',clinical_note_created_at:enc.clinical_note_created_at||now,clinical_note_updated_at:now,updated_at:now};const rows=await cnRest(\`clinical_encounters?id=eq.\${encodeURIComponent(enc.id)}&select=id,status,clinical_note,clinical_note_author_email,clinical_note_created_at,clinical_note_updated_at,updated_at,record_version\`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});if(!rows?.length)throw new Error('Prontuário não encontrado para salvar.');cnState.encounter={...enc,...rows[0]};await window.DeboraEncounter?.syncVersion?.(enc.id);cnState.persistedRevision=Math.max(cnState.persistedRevision,Number(item?.revision||0));cnStatus(enc.status==='finalized'?'Alteração salva e auditada ✓':'Salvo no banco ✓','saved');return cnState.encounter}catch(e){cnStatus('Falha ao salvar · texto permanece no campo','error');throw e}finally{cnState.saving=false}}
async function cnDrainSaves(){const drain=async()=>{while(cnState.pendingBody){const item=cnState.pendingBody;cnState.pendingBody=null;await cnPersistSave(item)}return cnState.encounter};cnState.saveChain=cnState.saveChain.catch(()=>null).then(drain);return cnState.saveChain}
async function cnSave(body,{force=false}={}){const enc=cnState.encounter;if(!enc?.id)throw new Error('Prontuário sem encounter_id.');const text=String(body??'');cnDraftWrite(enc.id,text);const pendingText=String(cnState.pendingBody?.body??'');if(force||text!==pendingText){cnState.editRevision+=1;cnState.pendingBody={body:text,revision:cnState.editRevision}}return cnDrainSaves()}
function cnScheduleSave(body){const text=String(body??'');cnDraftWrite(cnState.encounter?.id,text);cnState.editRevision+=1;cnState.pendingBody={body:text,revision:cnState.editRevision};cnStatus('Alterações pendentes','muted');clearTimeout(cnState.saveTimer);cnState.saveTimer=setTimeout(()=>cnDrainSaves().catch(()=>{}),650)}
async function cnFlush(){clearTimeout(cnState.saveTimer);const ta=document.querySelector('#cn-note');if(ta){const text=String(ta.value??'');if(!cnState.pendingBody&&text!==String(cnState.encounter?.clinical_note||'')){cnState.editRevision+=1;cnState.pendingBody={body:text,revision:cnState.editRevision}}}await cnDrainSaves()}`;

function transform(source) {
  let next = String(source);
  if (!next.includes('editRevision:0')) {
    next = next.replace(/const cnState=\{[^\n]+\};/, stateLine);
  }
  if (!next.includes('record_version&limit=1')) {
    next = next.replace(/async function cnResolveEncounter\(encounterId\)\{[^\n]+/, resolveLine);
  }
  if (!next.includes('async function cnDrainSaves()')) {
    next = next.replace(/async function cnSave\(body,\{force=false\}=\{\}\)\{[^\n]+\}\nfunction cnScheduleSave\(body\)\{[^\n]+\}\nasync function cnFlush\(\)\{[^\n]+\}/, saveBlock);
  }
  const versionSync = 'await window.DeboraEncounter?.syncVersion?.(enc.id)';
  if (!next.includes(versionSync)) {
    const marker = 'cnState.encounter={...enc,...rows[0]};cnState.persistedRevision=';
    if (!next.includes(marker)) throw new Error('Stage 12 note version handoff target not found');
    next = next.replace(marker, `cnState.encounter={...enc,...rows[0]};${versionSync};cnState.persistedRevision=`);
  }
  return next;
}

function manifestWithNoteHash(noteSource) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const entry = manifest?.modules?.['features/clinical-note-feature.js'];
  if (!entry) throw new Error('delivery 3 manifest: módulo de prontuário ausente');
  entry.sha256 = createHash('sha256').update(noteSource, 'utf8').digest('hex');
  if (!String(entry.source || '').includes('+delivery3-versioning')) {
    entry.source = `${entry.source || 'release:features/clinical-note-feature.js'}+delivery3-versioning`;
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const source = readFileSync(PATH, 'utf8');
const next = transform(source);
for (const marker of ['editRevision:0','persistedRevision:0','saveChain:Promise.resolve()','pendingBody:null','async function cnDrainSaves()','_expected_version','record_version','await window.DeboraEncounter?.syncVersion?.(enc.id)']) {
  if (!next.includes(marker)) throw new Error(`delivery 3 note hardening missing marker: ${marker}`);
}
const manifestSource = readFileSync(MANIFEST_PATH, 'utf8');
const nextManifest = manifestWithNoteHash(next);
const noteChanged = next !== source;
const manifestChanged = nextManifest !== manifestSource;
if (MODE === 'check' && (noteChanged || manifestChanged)) {
  throw new Error('clinical note delivery 3 hardening ou manifest ainda não materializado');
}
if (MODE === 'write') {
  if (noteChanged) writeFileSync(PATH, next, 'utf8');
  if (manifestChanged) writeFileSync(MANIFEST_PATH, nextManifest, 'utf8');
}
const changed = [noteChanged ? 'note' : '', manifestChanged ? 'manifest' : ''].filter(Boolean).join(', ');
console.log(`Delivery 3 note hardening ${MODE}: ${changed || 'already hardened'}`);
