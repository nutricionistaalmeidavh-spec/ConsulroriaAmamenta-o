import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODE = process.argv.includes('--write') ? 'write' : 'check';

function replaceRange(source, start, end, replacement, label) {
  const from = source.indexOf(start);
  const to = from >= 0 ? source.indexOf(end, from) : -1;
  if (from < 0 || to < 0) {
    if (source.includes(replacement.trim())) return source;
    throw new Error(`${label}: trecho esperado não encontrado`);
  }
  return `${source.slice(0, from)}${replacement}${source.slice(to)}`;
}

function writeTarget(relativePath, transform) {
  const path = resolve(ROOT, relativePath);
  const source = readFileSync(path, 'utf8');
  const next = transform(source);
  if (MODE === 'check' && next !== source) throw new Error(`${relativePath}: P1 hardening ainda não materializado`);
  if (MODE === 'write' && next !== source) writeFileSync(path, next, 'utf8');
  return next !== source;
}

function sha256(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function syncClinicalManifest() {
  const notePath = resolve(ROOT, 'public/clinical-source/features/clinical-note-feature.js');
  const manifestPath = resolve(ROOT, 'public/clinical-source/manifest.json');
  const note = readFileSync(notePath, 'utf8');
  const source = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  const entry = manifest?.modules?.['features/clinical-note-feature.js'];
  if (!entry) throw new Error('clinical manifest: módulo de prontuário ausente');
  const hash = sha256(note);
  if (entry.sha256 === hash) return false;
  if (MODE === 'check') throw new Error('clinical manifest: hash do prontuário está desatualizado');
  entry.sha256 = hash;
  if (!String(entry.source || '').includes('+p1-session-read-hardening')) {
    entry.source = `${entry.source || 'clinical-note'}+p1-session-read-hardening`;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return true;
}

const docsRest = `function documentsRuntimeClient(){const client=window.DeboraRuntimeClient;if(!client?.rest)throw new Error('Cliente de sessão indisponível.');return client}\nasync function rest(path,{method='GET',body=null,headers={}}={}){\n  const [table,...queryParts]=String(path).split('?');\n  return documentsRuntimeClient().rest(table,{method,query:queryParts.join('?'),body:body==null?undefined:body,headers});\n}\n`;
const docsStorage = `async function storageRequest(path,{method='GET',body=null,contentType='application/json',headers={}}={}){\n  return documentsRuntimeClient().storageRequest(path,{method,body:body==null?undefined:body,headers:{...(contentType?{'Content-Type':contentType}:{}),...headers}});\n}\n`;
const docsUpload = `async function uploadClinicalMedia(storagePath,file,onProgress=null,contentType=file?.type||'application/octet-stream'){\n  const safeContentType=String(contentType||file?.type||'application/octet-stream').toLowerCase();\n  const client=documentsRuntimeClient();\n  if(typeof onProgress!=='function'){\n    return client.workerRequest(clinicalMediaUploadUrl(storagePath),{method:'POST',headers:{'Content-Type':safeContentType},body:file,raw:true});\n  }\n  const send=async(attempt=0)=>new Promise((resolve,reject)=>{\n    const token=client.getSession()?.access_token;if(!token){reject(new Error('Sessão não encontrada.'));return}\n    const xhr=new XMLHttpRequest();\n    xhr.open('POST',clinicalMediaUploadUrl(storagePath));\n    xhr.setRequestHeader('Authorization',\`Bearer \${token}\`);\n    xhr.setRequestHeader('Content-Type',safeContentType);\n    xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.max(0,Math.min(100,Math.round(event.loaded/event.total*100))))};\n    xhr.onerror=()=>reject(new Error('Falha de rede durante o upload.'));\n    xhr.onabort=()=>reject(new Error('Upload cancelado.'));\n    xhr.onload=async()=>{\n      if(xhr.status>=200&&xhr.status<300){onProgress(100);try{resolve(xhr.responseText?JSON.parse(xhr.responseText):null)}catch{resolve(null)};return}\n      if(xhr.status===401&&attempt===0){try{await client.refreshSession();resolve(await send(1));return}catch(error){reject(error);return}}\n      let msg=\`Erro \${xhr.status}\`;try{const j=JSON.parse(xhr.responseText||'{}');msg=j.error==='SAAS_MEDIA_UPLOAD_NOT_ALLOWED'?'Upload de fotos e vídeos está disponível no plano Pro.':j.message||j.error||msg}catch{}reject(new Error(msg));\n    };\n    onProgress(0);xhr.send(file);\n  });\n  return send();\n}\n`;

const billingRest = `function bvClient(){const client=window.DeboraRuntimeClient;if(!client?.rest||!client?.rpc)throw new Error('Cliente de sessão indisponível.');return client}\nasync function bvRest(path,opt={}){\n  const raw=String(path);\n  if(raw.startsWith('rpc/')){let body={};try{body=typeof opt.body==='string'?JSON.parse(opt.body):opt.body||{}}catch{}return bvClient().rpc(raw.slice(4),body)}\n  const [table,...queryParts]=raw.split('?');\n  let body=opt.body;try{if(typeof body==='string')body=JSON.parse(body)}catch{}\n  return bvClient().rest(table,{method:opt.method||'GET',query:queryParts.join('?'),body,headers:opt.headers||{}});\n}\n`;
const billingRpc = `async function bvRpc(name,body){return bvClient().rpc(name,body)}\n`;

const noteRest = `function cnClient(){const client=window.DeboraRuntimeClient;if(!client?.rest)throw new Error('Cliente de sessão indisponível.');return client}\nasync function cnRest(path,opt={}){\n  const [table,...queryParts]=String(path).split('?');\n  let body=opt.body;try{if(typeof body==='string')body=JSON.parse(body)}catch{}\n  return cnClient().rest(table,{method:opt.method||'GET',query:queryParts.join('?'),body,headers:opt.headers||{}});\n}\n`;

const changed = [];
if (writeTarget('public/documents-feature.js', (source) => {
  let next = source;
  if (!next.includes('function documentsRuntimeClient()')) {
    next = replaceRange(next, "async function rest(path,{method='GET',body=null,headers={}}={}){", '\nasync function storageRequest', docsRest, 'documents rest');
    next = replaceRange(next, "async function storageRequest(path,{method='GET',body=null,contentType='application/json',headers={}}={}){", '\nasync function signedClinicalMediaUrl', docsStorage, 'documents storage');
    next = replaceRange(next, 'async function uploadClinicalMedia(storagePath,file,onProgress=null,contentType=file?.type||\'application/octet-stream\'){', '\nasync function deleteClinicalMedia', docsUpload, 'documents upload');
  }
  return next;
})) changed.push('documents');

if (writeTarget('public/billing-v2.js', (source) => {
  let next = source;
  if (!next.includes('function bvClient()')) {
    next = replaceRange(next, 'async function bvRest(path,opt={}){', '\nasync function bvRpc', billingRest, 'billing rest');
    next = replaceRange(next, 'async function bvRpc(name,body){', '\nfunction bvToast', billingRpc, 'billing rpc');
  }
  return next;
})) changed.push('billing');

if (writeTarget('public/clinical-source/features/clinical-note-feature.js', (source) => {
  let next = source;
  if (!next.includes('function cnClient()')) {
    next = replaceRange(next, 'async function cnRest(path,opt={}){', '\nconst cnE=', noteRest, 'clinical note rest');
  }
  next = next.replaceAll('.catch(()=>[])', '');
  return next;
})) changed.push('clinical-note');

if (syncClinicalManifest()) changed.push('clinical-manifest');

if (writeTarget('public/patient-records-hub.js', (source) => source
  .replace('DOC.consents(motherId).catch(()=>[])', 'DOC.consents(motherId)')
  .replace("DOC.listDocuments(motherId,'referral').catch(()=>[])", "DOC.listDocuments(motherId,'referral')"))) changed.push('patient-records-hub');

console.log(`P1 frontend ${MODE}: ${changed.length ? changed.join(', ') : 'already hardened'}`);
