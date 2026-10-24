import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { normalizeCloudflareFrontendSource } from './materialize-cloudflare-frontend.mjs';
import { applyWeeklyCarePlan } from './lib/weekly-care-plan-materialize.mjs';
import { applyWeightCorrection } from './lib/weight-correction-materialize.mjs';
import { applyPackageBillingSafety } from './lib/package-billing-materialize.mjs';
import { applyFinancialEntryCancellation } from './lib/financial-entry-cancel-materialize.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const OUT = resolve(PUBLIC, 'clinical-source');
const CLOUDFLARE_OVERLAY = resolve(ROOT, 'patch-source', 'cloudflare-license-authority');
const mode = process.argv.includes('--write') ? 'write' : 'verify';

const BASE_PARTS = [1, 2, 3, 4].map((part) => resolve(PUBLIC, `debora-app-${part}.bin`));
const RELEASE_PARTS = Array.from({ length: 8 }, (_, index) => resolve(PUBLIC, `release-1.11.0-patch-${index + 1}.txt`));
const AGENDA_PARTS = Array.from({ length: 4 }, (_, index) => resolve(PUBLIC, `release-1.12.0-agenda-${index + 1}.txt`));

function decodeMaybeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes.length % 4 !== 0) return bytes;
  const text = Buffer.from(bytes).toString('ascii');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return bytes;
  try {
    return new Uint8Array(Buffer.from(text, 'base64'));
  } catch {
    return bytes;
  }
}

function merge(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.byteLength;
  }
  return merged;
}

function loadBaseArchive() {
  const merged = merge(BASE_PARTS.map((path) => decodeMaybeBase64(readFileSync(path))));
  if (merged[0] !== 80 || merged[1] !== 75) throw new Error('Pacote base inválido.');
  return unzipSync(merged);
}

function loadTextPatch(parts, label) {
  const encoded = parts.map((path) => readFileSync(path, 'utf8')).join('').replace(/\s+/g, '');
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error(`${label} inválido.`);
  return unzipSync(bytes);
}

function requireEntry(entries, path, label) {
  const value = entries[path];
  if (!value) throw new Error(`${label}: arquivo ausente ${path}`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

const base = loadBaseArchive();
const release = loadTextPatch(RELEASE_PARTS, 'Release clínica');
const agenda = loadTextPatch(AGENDA_PARTS, 'Patch da Agenda');

const resolved = new Map();
const sourceByPath = new Map();

function add(outputPath, entries, entryPath, source) {
  resolved.set(outputPath, requireEntry(entries, entryPath, source));
  sourceByPath.set(outputPath, source);
}
function overlay(outputPath) {
  const sourcePath = resolve(CLOUDFLARE_OVERLAY, outputPath);
  if (!existsSync(sourcePath)) return;
  resolved.set(outputPath, new Uint8Array(readFileSync(sourcePath)));
  sourceByPath.set(outputPath, `cloudflare-license-authority:${outputPath}`);
}
function replaceText(outputPath, search, replacement, label) {
  const bytes = resolved.get(outputPath);
  if (!bytes) throw new Error(`${label}: arquivo não materializado ${outputPath}`);
  const text = Buffer.from(bytes).toString('utf8');
  if (!text.includes(search)) throw new Error(`${label}: trecho esperado não encontrado em ${outputPath}`);
  resolved.set(outputPath, new Uint8Array(Buffer.from(text.replace(search, replacement), 'utf8')));
  sourceByPath.set(outputPath, `${sourceByPath.get(outputPath)}+${label}`);
}

add('index.html', base, 'index.html', 'base:index.html');
add('styles.css', base, 'styles.css', 'base:styles.css');
add('config.js', base, 'config.js', 'base:config.js');

const libPaths = [
  'lib/supabase-client.js',
  'lib/auth-service.js',
  'lib/repositories.js',
  'lib/app-data.js',
  'lib/encounter-form.js',
  'lib/media-service.js',
  'lib/backup-service.js',
  'lib/pdf-service.js'
];

for (const libPath of libPaths) {
  const agendaPath = `core/${libPath}`;
  const releasePath = `core/${libPath}`;
  if (agenda[agendaPath]) add(`core/${libPath}`, agenda, agendaPath, `agenda:${agendaPath}`);
  else if (release[releasePath]) add(`core/${libPath}`, release, releasePath, `release:${releasePath}`);
  else add(`core/${libPath}`, base, libPath, `base:${libPath}`);
}

if (agenda['core/app-shell.js']) add('core/app-shell.js', agenda, 'core/app-shell.js', 'agenda:core/app-shell.js');
else add('core/app-shell.js', release, 'core/app-shell.js', 'release:core/app-shell.js');

add('features/clinical-note-feature.js', release, 'features/clinical-note-feature.js', 'release:features/clinical-note-feature.js');
add('features/clinical-note-feature.css', release, 'features/clinical-note-feature.css', 'release:features/clinical-note-feature.css');
if (release['features/patient-fixes.js']) add('features/patient-fixes.js', release, 'features/patient-fixes.js', 'release:features/patient-fixes.js');
if (release['features/patient-fixes.css']) add('features/patient-fixes.css', release, 'features/patient-fixes.css', 'release:features/patient-fixes.css');

// Source-controlled overlays are applied last so future materialization cannot silently
// restore direct Supabase clinical traffic after the Cloudflare cutover.
overlay('config.js');
overlay('core/lib/supabase-client.js');
overlay('core/lib/repositories.js');
overlay('core/lib/app-data.js');
overlay('core/lib/backup-service.js');

replaceText('index.html',
  `      <button class="ui-button ui-button-primary auth-submit" type="submit">Entrar</button>
      <button class="ui-button ui-button-ghost auth-secondary" type="button" data-signup-action>Criar primeiro acesso</button>
      <p class="form-message" data-login-message role="status"></p>`,
  `      <button class="ui-button ui-button-primary auth-submit" type="submit">Entrar</button>
      <button class="ui-button ui-button-ghost auth-secondary" type="button" data-signup-action>Criar primeiro acesso</button>
      <button class="ui-button ui-button-ghost auth-secondary" type="button" data-recovery-action>Esqueci minha senha</button>
      <p class="form-message" data-login-message role="status"></p>`,
  'clinical-login-password-recovery-action');

replaceText('core/app-shell.js',
  `  } catch (error) {
    loginMessage.textContent = error?.message || 'Não foi possível criar o acesso.';
    loginMessage.className = 'form-message error';
  }
});

document.querySelector('[data-clinical-media-input]')?.addEventListener('change', (event) => {`,
  `  } catch (error) {
    loginMessage.textContent = error?.message || 'Não foi possível criar o acesso.';
    loginMessage.className = 'form-message error';
  }
});

document.querySelector('[data-recovery-action]')?.addEventListener('click', async (event) => {
  if (!configured()) return;
  const button = event.currentTarget;
  const data = new FormData(loginForm);
  const email = String(data.get('email') || '').trim();
  if (!email) {
    loginMessage.textContent = 'Informe seu e-mail para recuperar a senha.';
    loginMessage.className = 'form-message error';
    loginForm?.querySelector('[name="email"]')?.focus();
    return;
  }
  if (config.ALLOWED_EMAIL && email.toLowerCase() !== String(config.ALLOWED_EMAIL).toLowerCase()) {
    loginMessage.textContent = 'Este acesso é exclusivo da profissional autorizada.';
    loginMessage.className = 'form-message error';
    return;
  }
  button.disabled = true;
  try {
    loginMessage.textContent = 'Enviando recuperação…';
    loginMessage.className = 'form-message';
    const baseUrl = String(config.API_BASE_URL || '').replace(/\\\/$/, '');
    const response = await fetch(\`\${baseUrl}/api/auth/recovery\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', apikey: String(config.CLIENT_RUNTIME_KEY || '') },
      body: JSON.stringify({ email }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || payload?.error || 'Não foi possível enviar a recuperação agora.');
    loginMessage.textContent = payload?.message || 'Se a conta existir, você receberá as instruções por e-mail.';
    loginMessage.className = 'form-message success';
  } catch (error) {
    loginMessage.textContent = error?.message || 'Não foi possível enviar a recuperação agora.';
    loginMessage.className = 'form-message error';
  } finally {
    button.disabled = false;
  }
});

document.querySelector('[data-clinical-media-input]')?.addEventListener('change', (event) => {`,
  'clinical-login-password-recovery-handler');

const oldConfigured = `export function configured() {
  return /^https:\\/\\/.+\\.supabase\\.co$/.test(config.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(config.SUPABASE_PUBLISHABLE_KEY || '') &&
    !String(config.SUPABASE_URL).includes('YOUR_PROJECT');
}`;
const newConfigured = `export function configured() {
  return config.BACKEND_MODE === 'cloudflare' && Boolean(config.API_BASE_URL && config.CLIENT_RUNTIME_KEY);
}`;
replaceText('core/app-shell.js', oldConfigured, newConfigured, 'cloudflare-runtime-config');

const oldPatientSubmit = `patientForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('[data-patient-form-status]');
  try {
    const payload = patientFormPayload();
    let saved;
    if (editingPatientId) {
      const current = patientByMotherId(editingPatientId) || await appData.getPatient(editingPatientId);
      saved = await appData.updatePatient({ mother: { ...payload.mother, id: current.mother.id }, babies: payload.babies });
    } else saved = await appData.createPatient(payload);
    await appData.saveConsents(saved.mother.id, patientConsentPayload());
    editingPatientId = null;
    await refreshData();
    await openPatient(saved.mother.id);
  } catch (error) {
    if (status) { status.textContent = error?.message || 'Não foi possível salvar.'; status.classList.add('error'); }
    reportError(error);
  }
});`;
const newPatientSubmit = `let patientSaveBusy = false;
let patientSaveAttempt = null;
let patientConsentsReady = true;
patientForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('[data-patient-form-status]');
  if (editingPatientId && !patientConsentsReady) {
    if (status) { status.textContent = 'Não foi possível carregar as autorizações. Reabra a edição e tente novamente.'; status.classList.add('error'); }
    return;
  }
  if (patientSaveBusy) return;
  patientSaveBusy = true;
  const submitButtons = [...patientForm.querySelectorAll('[type="submit"]')];
  submitButtons.forEach(button => { button.disabled = true; });
  try {
    const payload = patientFormPayload();
    const consents = patientConsentPayload();
    const body = { ...payload, mother: { ...payload.mother, ...(editingPatientId ? { id: editingPatientId } : {}) }, consents };
    const serialized = JSON.stringify(body);
    if (!patientSaveAttempt || patientSaveAttempt.serialized !== serialized) {
      patientSaveAttempt = { serialized, key: crypto.randomUUID() };
    }
    const saved = await repositories.client.workerRequest('/api/clinical/patients', {
      method: editingPatientId ? 'PATCH' : 'POST',
      headers: { 'Idempotency-Key': patientSaveAttempt.key },
      body
    });
    // If the following UI reload fails, the next submit edits this patient, never creates another.
    editingPatientId = saved.mother.id;
    patientSaveAttempt = null;
    await refreshData();
    await openPatient(saved.mother.id);
  } catch (error) {
    if (status) { status.textContent = error?.message || 'Não foi possível salvar.'; status.classList.add('error'); }
    reportError(error);
  } finally {
    patientSaveBusy = false;
    submitButtons.forEach(button => { button.disabled = false; });
  }
});`;
replaceText('core/app-shell.js', oldPatientSubmit, newPatientSubmit, 'atomic-patient-create');

replaceText('core/app-shell.js',
  '  editingPatientId = motherId || null;\n  patientForm.reset();',
  '  editingPatientId = motherId || null;\n  patientSaveAttempt = null;\n  patientConsentsReady = !motherId;\n  patientForm.reset();',
  'patient-save-attempt-lifecycle');

replaceText('core/app-shell.js',
  '  currentBabyId = selectedBaby?.id || null;\n  setText(\'[data-patient-avatar]\', patientInitials(patient));',
  '  currentBabyId = selectedBaby?.id || null;\n  renderPatientWeights([], selectedBaby);\n  renderPatientTimeline([]);\n  setText(\'[data-patient-avatar]\', patientInitials(patient));',
  'patient-projection-reset-before-read');

const oldConsentLoad = `  setText('[data-patient-form-title]', patient ? 'Editar paciente' : 'Nova paciente');
  if (patient) {
    try {
      const consents = await appData.listConsents(patient.mother.id);
      const map = Object.fromEntries(consents.map((c) => [c.consent_type, c.granted && !c.revoked_at]));
      const pairs = { consentData: 'data_processing', consentWhatsapp: 'whatsapp', consentClinicalMedia: 'clinical_media', consentPublicMedia: 'public_media' };
      for (const [name, type] of Object.entries(pairs)) { const el = patientForm.elements.namedItem(name); if (el) el.checked = Boolean(map[type]); }
    } catch (error) { reportError(error); }
  }
  if (navigateRoute) navigate('patient-form', motherId); else showScreen('patient-form');`;
const newConsentLoad = `  setText('[data-patient-form-title]', patient ? 'Editar paciente' : 'Nova paciente');
  const editSubmitButtons = [...patientForm.querySelectorAll('[type="submit"]')];
  const formStatus = document.querySelector('[data-patient-form-status]');
  if (formStatus) { formStatus.textContent = ''; formStatus.classList.remove('error'); }
  editSubmitButtons.forEach(button => { button.disabled = Boolean(patient); });
  if (patient) {
    try {
      const consents = await appData.listConsents(patient.mother.id);
      const map = Object.fromEntries(consents.map((c) => [c.consent_type, c.granted && !c.revoked_at]));
      const pairs = { consentData: 'data_processing', consentWhatsapp: 'whatsapp', consentClinicalMedia: 'clinical_media', consentPublicMedia: 'public_media' };
      for (const [name, type] of Object.entries(pairs)) { const el = patientForm.elements.namedItem(name); if (el) el.checked = Boolean(map[type]); }
      patientConsentsReady = true;
      editSubmitButtons.forEach(button => { button.disabled = false; });
    } catch (error) {
      patientConsentsReady = false;
      if (formStatus) { formStatus.textContent = 'Não foi possível carregar as autorizações. Reabra a edição e tente novamente.'; formStatus.classList.add('error'); }
      reportError(error);
    }
  }
  if (navigateRoute) navigate('patient-form', motherId); else showScreen('patient-form');`;
replaceText('core/app-shell.js', oldConsentLoad, newConsentLoad, 'consent-read-must-complete-before-edit');

replaceText('features/clinical-note-feature.js',
  'async function cnFlush(){clearTimeout(cnState.saveTimer);const ta=document.querySelector(\'#cn-note\');if(ta)await cnSave(ta.value,{force:true}).catch(()=>{})}',
  'async function cnFlush(){clearTimeout(cnState.saveTimer);const ta=document.querySelector(\'#cn-note\');if(ta)await cnSave(ta.value,{force:true})}',
  'clinical-note-flush-propagates');
replaceText('features/clinical-note-feature.js',
  "o.querySelector('[data-cn-close]').onclick=async()=>{await cnFlush();cnClose()}",
  "o.querySelector('[data-cn-close]').onclick=async()=>{try{await cnFlush();cnClose()}catch{}}",
  'clinical-note-close-on-save-only');
replaceText('features/clinical-note-feature.js',
  "o.querySelector('[data-cn-back]').onclick=async()=>{await cnFlush();if(cnState.direction==='backward')cnInvoke(cnState.pendingButton);else cnClose()}",
  "o.querySelector('[data-cn-back]').onclick=async()=>{try{await cnFlush();if(cnState.direction==='backward')cnInvoke(cnState.pendingButton);else cnClose()}catch{}}",
  'clinical-note-back-on-save-only');
replaceText('features/clinical-note-feature.js',
  "o.querySelector('[data-cn-continue]').onclick=async()=>{await cnFlush();if(cnState.direction==='forward')cnInvoke(cnState.pendingButton);else cnClose()}",
  "o.querySelector('[data-cn-continue]').onclick=async()=>{try{await cnFlush();if(cnState.direction==='forward')cnInvoke(cnState.pendingButton);else cnClose()}catch{}}",
  'clinical-note-continue-on-save-only');

const oldStartApp = `async function startApp() {
  if (appStarted) return;
  appStarted = true; showLoggedIn();
  decorateClinicalChoices();
  const pdfDefault = document.querySelector('[data-pdf-layout-default]'); if (pdfDefault) pdfDefault.value = selectedPdfLayout();
  const pdfEncounter = document.querySelector('[data-pdf-layout-encounter]'); if (pdfEncounter) pdfEncounter.value = selectedPdfLayout();
  try {
    await refreshData();
    if (!location.hash) history.replaceState({}, '', routes.home);
    await renderRoute();
  } catch (error) { reportError(error); }
}`;
replaceText('core/app-shell.js', oldStartApp,
  oldStartApp.replace('appStarted = true; showLoggedIn();', 'appStarted = true;')
    .replace('    await renderRoute();', '    await renderRoute();\n    showLoggedIn();')
    .replace('reportError(error);', 'showLoggedOut(); throw error;'),
  'await-startup-before-editing');

for (const [outputPath, bytes] of resolved) {
  const runtimePath = `public/clinical-source/${outputPath}`;
  const text = Buffer.from(bytes).toString('utf8');
  const normalized = normalizeCloudflareFrontendSource(text, runtimePath);
  if (normalized !== text) {
    resolved.set(outputPath, new Uint8Array(Buffer.from(normalized, 'utf8')));
    sourceByPath.set(outputPath, `${sourceByPath.get(outputPath)}+frontend-cloudflare-cutover`);
  }
}

applyWeeklyCarePlan(resolved, sourceByPath, ROOT);
applyWeightCorrection(resolved, sourceByPath);
applyPackageBillingSafety(resolved, sourceByPath);
applyFinancialEntryCancellation(resolved, sourceByPath);


// Backup UX is injected AFTER the clinical source is materialized, so the
// canonical shell (not a standalone fork) receives the upgrade on every build.
replaceText('core/app-shell.js',
  "import { createBackupService, encryptBackup, decryptBackup } from './lib/backup-service.js';",
  "import { createBackupService, encryptBackup, decryptBackup, createBackupWorkbook } from './lib/backup-service.js';",
  'backup-xlsx-export-import');

const backupShell = Buffer.from(resolved.get('core/app-shell.js')).toString('utf8');
const backupBegin = backupShell.indexOf('async function exportBackupAction() {');
const backupEnd = backupShell.indexOf('async function startApp() {',backupBegin);
if (backupBegin < 0 || backupEnd <= backupBegin) throw new Error('backup-action-injection: fluxo canônico não encontrado');
replaceText('core/app-shell.js',backupShell.slice(backupBegin,backupEnd),
  [
    "const BACKUP_STATUS_KEY = 'gestao-amamentacao:backup-last-export';",
    "function backupStatus(kind, records, files) {",
    "  const entry = {kind,records,files,at:new Date().toISOString()};",
    "  try { localStorage.setItem(BACKUP_STATUS_KEY,JSON.stringify(entry)); } catch {}",
    "  updateBackupStatus();",
    "}",
    "function updateBackupStatus() {",
    "  const target = document.querySelector('[data-backup-status]');",
    "  if (!target) return;",
    "  let value = null;",
    "  try { value=JSON.parse(localStorage.getItem(BACKUP_STATUS_KEY)||'null'); } catch {}",
    "  if (!value?.at) return;",
    "  const at = new Date(value.at).toLocaleString('pt-BR');",
    "  target.textContent = 'Última exportação neste aparelho: ' + at + ' · ' + (value.kind==='xlsx'?'Excel':'Backup seguro') + ' · ' + value.records + ' registros';",
    "}",
    "function downloadBackupFile(blob, filename) {",
    "  const link = document.createElement('a');",
    "  const url = URL.createObjectURL(blob);",
    "  link.href = url; link.download = filename; link.rel = 'noopener';",
    "  document.body.appendChild(link); link.click(); link.remove();",
    "  setTimeout(() => URL.revokeObjectURL(url), 30000);",
    "}",
    "function backupRowCount(data) {",
    "  return Object.values(data.tables||{}).reduce((sum,entries)=>sum+(Array.isArray(entries)?entries.length:0),0);",
    "}",
    "async function exportSpreadsheetAction() {",
    "  if (!confirm('A planilha Excel contém dados sensíveis de saúde e NÃO tem senha. Deseja exportar mesmo assim?')) return;",
    "  const data = await backupService.exportAll({metadataOnly:true});",
    "  const workbook = await createBackupWorkbook(data);",
    "  const date = new Date().toISOString().slice(0,10);",
    "  downloadBackupFile(workbook,'gestao-amamentacao-dados-'+date+'.xlsx');",
    "  backupStatus('xlsx',backupRowCount(data),(data.files||[]).length);",
    "  toast('Planilha Excel gerada. Guarde em local seguro.', 'success');",
    "}",
    "async function exportBackupAction() {",
    "  const passphrase = prompt('Crie uma senha forte para o backup (mínimo 6 caracteres). Sem essa senha não será possível restaurar.');",
    "  if (!passphrase) return;",
    "  const confirmation = prompt('Confirme a senha do backup:');",
    "  if (confirmation === null) return;",
    "  if (passphrase !== confirmation) throw new Error('As senhas do backup não coincidem.');",
    "  const data = await backupService.exportAll();",
    "  const envelope = await encryptBackup(data,passphrase);",
    "  const blob = new Blob([JSON.stringify(envelope)],{type:'application/octet-stream'});",
    "  const date = new Date().toISOString().slice(0,10);",
    "  downloadBackupFile(blob,'gestao-amamentacao-backup-'+date+'.amamentacao');",
    "  backupStatus('backup',backupRowCount(data),(data.files||[]).length);",
    "  toast('Backup protegido exportado. Guarde a senha separadamente.', 'success');",
    "}",
    "async function restoreBackupAction() {",
    "  const input = document.createElement('input');",
    "  input.type='file'; input.accept='.amamentacao,.json,application/json,application/octet-stream';",
    "  input.addEventListener('change',async()=>{",
    "    const file = input.files?.[0]; if (!file) return;",
    "    try {",
    "      const envelope = JSON.parse(await file.text());",
    "      const passphrase = prompt('Senha do backup'); if (!passphrase) return;",
    "      const backup = await decryptBackup(envelope,passphrase);",
    "      const preview = await backupService.previewRestore(backup);",
    "      const message = 'Backup de ' + (preview.exportedAt || 'data não informada') +",
    "        '\\n' + preview.records + ' registros · ' + preview.files + ' arquivos.' +",
    "        '\\n\\nEsta restauração ATUALIZA registros com os mesmos IDs e NÃO exclui os demais.' +",
    "        '\\n\\nDeseja continuar?';",
    "      if (!confirm(message)) return;",
    "      const result = await backupService.restoreAll(backup);",
    "      if (!result?.verified) throw new Error('Restauração não foi confirmada pelo servidor.');",
    "      await refreshData();",
    "      toast('Backup restaurado e verificado: '+result.records+' registros.', 'success');",
    "    } catch (error) { reportError(error); }",
    "  });",
    "  input.click();",
    "}",
    "updateBackupStatus();",
    ""
  ].join('\n'),
  'backup-ux-safe-export-and-preflight');
replaceText('core/app-shell.js',
  "else if (action === 'backup-export') await exportBackupAction();",
  "else if (action === 'backup-spreadsheet') await exportSpreadsheetAction();\n    else if (action === 'backup-export') await exportBackupAction();",
  'backup-spreadsheet-action');

replaceText('index.html',
  '<button data-action="backup-export"><span>⇩</span><div><strong>Exportar backup criptografado</strong><small>Baixa uma cópia protegida por senha.</small></div><b>›</b></button>',
  '<button data-action="backup-spreadsheet"><span>▤</span><div><strong>Exportar planilha Excel</strong><small>Abas com todos os dados, para consulta. Arquivo sem criptografia.</small></div><b>›</b></button>\n          <button data-action="backup-export"><span>⇩</span><div><strong>Backup completo e protegido</strong><small>Inclui registros e anexos. Necessita senha para restaurar.</small></div><b>›</b></button>',
  'backup-export-options');
replaceText('index.html',
  '<button data-action="backup-restore"><span>⇧</span><div><strong>Restaurar backup</strong><small>Importa uma cópia criptografada deste sistema.</small></div><b>›</b></button>',
  '<button data-action="backup-restore"><span>⇧</span><div><strong>Restaurar backup</strong><small>Verifica o arquivo antes de atualizar registros. Aceita backups antigos .json.</small></div><b>›</b></button>\n          <p class="form-message" data-backup-status role="status">Nenhuma exportação registrada neste aparelho.</p>',
  'backup-restore-guidance');

// A patient-detail load may finish after navigation has already returned to
// the appointment wizard. Never allow an outdated async route to hide it.
replaceText('core/app-shell.js',
  "  showScreen('patient');\n}\nfunction renderBabySelector",
  "  if (hashToScreen() === 'patient' && patientIdFromHash() === patient.mother.id) showScreen('patient');\n}\nfunction renderBabySelector",
  'patient-navigation-prevent-stale-show');
replaceText('core/app-shell.js',
  "  const screen = hashToScreen();\n  if (screen === 'patient') {",
  "  const screen = hashToScreen();\n  const routeAtStart = location.hash;\n  if (screen === 'patient') {",
  'route-capture-latest-location');
replaceText('core/app-shell.js',
  "  showScreen(screen);\n}\n\nfunction renderPatientList",
  "  if (location.hash !== routeAtStart) return;\n  showScreen(screen);\n}\n\nfunction renderPatientList",
  'route-discard-outdated-response');

const modules = {};
for (const [outputPath, bytes] of [...resolved.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  modules[outputPath] = {
    promoted: true,
    source: sourceByPath.get(outputPath),
    sha256: sha256(bytes)
  };
}

const manifest = Buffer.from(`${JSON.stringify({
  version: 3,
  strategy: 'cloudflare-d1-r2-native-runtime',
  generatedFromLegacyArtifacts: true,
  modules
}, null, 2)}\n`, 'utf8');
resolved.set('manifest.json', new Uint8Array(manifest));

let mismatches = 0;
for (const [outputPath, bytes] of resolved) {
  const destination = resolve(OUT, outputPath);
  if (mode === 'write') {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(bytes));
    continue;
  }
  if (!existsSync(destination)) {
    console.error(`missing ${outputPath}`);
    mismatches += 1;
    continue;
  }
  const current = readFileSync(destination);
  if (!current.equals(Buffer.from(bytes))) {
    console.error(`mismatch ${outputPath}`);
    mismatches += 1;
  }
}

if (mode === 'write') {
  console.log(`Materialized ${resolved.size - 1} clinical source files plus manifest.`);
} else if (mismatches) {
  console.error(`Clinical source verification failed: ${mismatches} mismatch(es).`);
  process.exit(1);
} else {
  console.log(`Clinical source verified: ${resolved.size - 1} files match Cloudflare runtime resolution.`);
}
