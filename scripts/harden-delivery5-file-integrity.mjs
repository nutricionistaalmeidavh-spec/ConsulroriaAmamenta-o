import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT=resolve(import.meta.dirname,'..');
const MODE=process.argv.includes('--write')?'write':'check';

function sha256(text){return createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex')}
function target(path,transform){
  const full=resolve(ROOT,path),source=readFileSync(full,'utf8'),next=transform(source);
  if(MODE==='check'&&next!==source)throw new Error(`${path}: Delivery 5 ainda não materializado`);
  if(MODE==='write'&&next!==source)writeFileSync(full,next,'utf8');
  return next!==source;
}
function replaceLine(source,prefix,replacement,label){
  const lines=source.split('\n'),index=lines.findIndex(line=>line.startsWith(prefix));
  if(index<0){if(source.includes(replacement))return source;throw new Error(`${label}: linha esperada não encontrada`)}
  lines[index]=replacement;return lines.join('\n');
}

const uuidLine="function pfUuid(){return globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)})}";
const signedLine="function pfResolveSignedUrl(u){const raw=String(u||'').trim();if(!raw)return null;if(/^https?:\\/\\//i.test(raw))return raw;return PF_SB+(raw.startsWith('/')?raw:'/'+raw)}\nasync function pfSigned(path){const r=await pfNativeFetch(PF_SB+'/api/files/object/sign/'+PF_BUCKET+'/'+path,{method:'POST',headers:{apikey:PF_KEY,Authorization:'Bearer '+(pfToken()||''),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:900})});if(!r.ok)return null;const j=await r.json(),u=j.signedURL||j.signedUrl||j.signed_url;return pfResolveSignedUrl(u)}";
const uploadLine="async function pfUploadPhoto(mid,file){const owner=pfUid();if(!owner)throw new Error('Sessão não encontrada.');if(mid!==pfPatientId())throw new Error('Paciente ativa mudou durante o envio.');const path=owner+'/patient-photos/'+mid+'/profile',operation=pfUuid(),r=await pfNativeFetch(PF_SB+'/api/files/object/'+PF_BUCKET+'/'+path,{method:'POST',headers:{apikey:PF_KEY,Authorization:'Bearer '+pfToken(),'Content-Type':file.type||'image/jpeg','x-storage-operation':operation},body:file});if(!r.ok)throw new Error('Não foi possível salvar a foto.');const rows=await pfRest('mothers?id=eq.'+encodeURIComponent(mid),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({profile_photo_path:path})});pfPhotoUrlCache.delete(mid);await pfShowPhoto(mid,true,rows?.[0]||{profile_photo_path:path});pfToast('Foto atualizada.')}";
const showLine="async function pfShowPhoto(mid,force=false,mother=null){if(!mid||mid!==pfPatientId())return;const avatar=document.querySelector('[data-screen=\\\"patient\\\"] [data-patient-avatar]')||document.querySelector('[data-screen=\\\"patient\\\"] .patient-title-row .patient-avatar');if(!avatar)return;let current=mother;if(!current){const rows=await pfRest('mothers?id=eq.'+encodeURIComponent(mid)+'&select=id,profile_photo_path&limit=1').catch(()=>[]);current=rows?.[0]||null}if(mid!==pfPatientId())return;const path=String(current?.profile_photo_path||'');if(!path){avatar.querySelector('img[data-pf-photo]')?.remove();pfPhotoUrlCache.delete(mid);return}const cached=pfPhotoUrlCache.get(mid);let u=!force&&cached?.path===path&&cached.expiresAt>Date.now()?cached.url:null;if(!u){u=await pfSigned(path);if(!u)return;pfPhotoUrlCache.set(mid,{path,url:u,expiresAt:Date.now()+780000})}if(mid!==pfPatientId())return;let img=avatar.querySelector('img[data-pf-photo]');if(!img){img=document.createElement('img');img.dataset.pfPhoto='1';img.alt='Foto da paciente';img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:inherit;display:block';avatar.textContent='';avatar.appendChild(img)}img.src=u}";

const changed=[];
if(target('public/clinical-source/features/patient-fixes.js',source=>{
  let next=source;
  if(!next.includes('const pfPhotoUrlCache=new Map();'))next=next.replace('const pfNativeFetch=window.fetch.bind(window);\n','const pfNativeFetch=window.fetch.bind(window);\nconst pfPhotoUrlCache=new Map();\n');
  if(!next.includes('function pfUuid()'))next=next.replace(/(function pfUid\(\)\{[^\n]+\})/,`$1\n${uuidLine}`);
  if(!next.includes('function pfResolveSignedUrl('))next=replaceLine(next,'async function pfSigned(path)',signedLine,'patient signed URL');
  next=replaceLine(next,'async function pfUploadPhoto(mid,file)',uploadLine,'patient photo upload');
  next=replaceLine(next,'async function pfShowPhoto(mid,force)',showLine,'patient photo render');
  next=next.replace('await pfShowPhoto(mid,false).catch(()=>{});await pfMountProntuario(m)','await pfShowPhoto(mid,false,m).catch(()=>{});await pfMountProntuario(m)');
  if(!next.includes('profile_photo_path'))throw new Error('patient photo: referência de backend ausente');
  if(next.includes("localStorage.setItem('pf-photo-path-"))throw new Error('patient photo: localStorage legado ainda ativo');
  if(next.includes('sessionStorage.setItem(key,u)'))throw new Error('patient photo: signed URL legado ainda persistido');
  return next;
}))changed.push('patient-photo');

if(target('public/clinical-source/index.html',source=>{
  const patientAt=source.indexOf('data-screen="patient"');if(patientAt<0)throw new Error('patient screen ausente');
  const avatarAt=source.indexOf('<div class="patient-avatar">',patientAt);
  if(avatarAt<0){if(source.includes('class="patient-avatar" data-patient-avatar'))return source;throw new Error('patient avatar ausente')}
  return source.slice(0,avatarAt)+source.slice(avatarAt).replace('<div class="patient-avatar">','<div class="patient-avatar" data-patient-avatar>',1);
}))changed.push('patient-avatar');

const docs=readFileSync(resolve(ROOT,'public/documents-feature.js'),'utf8');
if(!docs.includes('function resolveSignedFileUrl(')||!docs.includes('confirmClinicalMedia')||!docs.includes('x-clinical-media-operation'))throw new Error('documents-feature: contrato Delivery 5 ausente');
const album=readFileSync(resolve(ROOT,'public/album-feature.js'),'utf8');
if(!album.includes('operationKey')||!album.includes('confirmClinicalMedia')||album.includes('deleteClinicalMedia(storagePath).catch'))throw new Error('album-feature: contrato Delivery 5 ausente');

const manifestPath=resolve(ROOT,'public/clinical-source/manifest.json');
const patientPath=resolve(ROOT,'public/clinical-source/features/patient-fixes.js');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const entry=manifest?.modules?.['features/patient-fixes.js'];
if(!entry)throw new Error('clinical manifest: patient-fixes ausente');
const hash=sha256(readFileSync(patientPath,'utf8'));
if(entry.sha256!==hash){
  if(MODE==='check')throw new Error('clinical manifest: hash patient-fixes desatualizado');
  entry.sha256=hash;
  if(!String(entry.source||'').includes('+delivery5-file-integrity'))entry.source=`${entry.source||'patient-fixes'}+delivery5-file-integrity`;
  writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');changed.push('clinical-manifest');
}

console.log(`Delivery 5 file integrity ${MODE}: ${changed.length?changed.join(', '):'already hardened'}`);
