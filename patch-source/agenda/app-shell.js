import { createSupabaseClient } from './lib/supabase-client.js';
import { createAuthService } from './lib/auth-service.js';
import { createRepositories } from './lib/repositories.js';
import { createAppData } from './lib/app-data.js';
import { buildEncounterPayload, collectEncounterDraft, applyEncounterDraft } from './lib/encounter-form.js';
import { createMediaService } from './lib/media-service.js';
import { createBackupService, encryptBackup, decryptBackup } from './lib/backup-service.js';
import { createCarePlanPdf, safePdfFilename, normalizePdfLayout } from './lib/pdf-service.js';

const config = globalThis.DEBORA_APP_CONFIG || {};
const loginScreen = document.querySelector('[data-auth-screen="login"]');
const appRoot = document.querySelector('[data-app-root]');
const loginForm = document.querySelector('[data-login-form]');
const loginMessage = document.querySelector('[data-login-message]');
const patientForm = document.querySelector('[data-patient-form]');
const appointmentScreen = document.querySelector('[data-screen="appointment"]');
const bottomNav = document.querySelector('.lactation-bottom-nav');
const fab = document.querySelector('.lactation-fab');
const routeAnnouncer = document.querySelector('[data-route-announcer]');
const pageTitles = [...document.querySelectorAll('[data-page-title]')];
const screens = [...document.querySelectorAll('[data-screen]')];

const titles = {
  home: 'Início', agenda: 'Agenda', patients: 'Pacientes', patient: 'Ficha da paciente',
  'patient-form': 'Cadastro da paciente', followups: 'Acompanhamentos', finance: 'Financeiro',
  library: 'Biblioteca', settings: 'Configurações', more: 'Mais', appointment: 'Atendimento'
};
const routes = {
  home: '#/home', agenda: '#/agenda', patients: '#/patients', followups: '#/followups',
  finance: '#/finance', library: '#/library', settings: '#/settings', more: '#/more', appointment: '#/appointment/new'
};

let client = null;
let authService = null;
let repositories = null;
let appData = null;
let mediaService = null;
let backupService = null;
let activeScreen = 'home';
let previousScreen = 'home';
let currentPatientId = null;
let currentBabyId = null;
let editingPatientId = null;
let wizardStep = 1;
let currentDraftEncounterId = null;
let currentAppointmentId = null;
let encounterAutosaveTimer = null;
let encounterAutosaveBusy = false;
let pendingMediaFile = null;
let appStarted = false;
const state = { patients: [], appointments: [], encounters: [], followups: [], financial: [] };
const PDF_LAYOUT_KEY = 'debora-pdf-layout';
const CLINIC_TIME_ZONE = 'America/Sao_Paulo';
const CLINIC_OFFSET = '-03:00';
let agendaSelectedDay = null;

export function configured() {
  return /^https:\/\/.+\.supabase\.co$/.test(config.SUPABASE_URL || '') &&
    /^(sb_publishable_|eyJ)/.test(config.SUPABASE_PUBLISHABLE_KEY || '') &&
    !String(config.SUPABASE_URL).includes('YOUR_PROJECT');
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function currency(cents = 0) { return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function grams(value) { return value == null || value === '' ? 'Não informado' : `${Number(value).toLocaleString('pt-BR')} g`; }
function dateLabel(value) {
  if (!value) return 'Não informado';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}
function clinicParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}
function clinicDayKey(value = new Date()) {
  const parts = clinicParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : '';
}
function clinicMonthKey(value = new Date()) {
  const parts = clinicParts(value);
  return parts ? `${parts.year}-${parts.month}` : '';
}
function dayKeyDate(key) {
  const date = new Date(`${key}T12:00:00${CLINIC_OFFSET}`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}
function shiftDayKey(key, days) {
  const date = dayKeyDate(key);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return clinicDayKey(date);
}
function dateTimeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TIME_ZONE, dateStyle: 'short', timeStyle: 'short' }).format(date);
}
function timeLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--:--' : new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date);
}
function localDateTimeInput(date = new Date()) {
  const parts = clinicParts(date);
  return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : '';
}
function clinicInputToIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date().toISOString();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw).toISOString();
  const normalized = raw.length === 16 ? `${raw}:00` : raw;
  const date = new Date(`${normalized}${CLINIC_OFFSET}`);
  if (Number.isNaN(date.getTime())) throw new Error('Data e hora inválidas.');
  return date.toISOString();
}
function familyBabies(patient) { return patient?.babies?.length ? patient.babies : patient?.baby ? [patient.baby] : []; }
function babyNames(patient) { return familyBabies(patient).map((baby) => baby.name).filter(Boolean); }
function patientLabel(patient) {
  const names = babyNames(patient);
  const babies = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names.at(-1)}` : names[0] || 'bebê';
  return `${patient?.mother?.name || 'Mãe'} + ${babies}`;
}
function patientTargetLabel(patient, babyId = null) {
  if (!patient) return 'Paciente';
  const baby = babyId ? babyById(patient, babyId) : null;
  return baby ? `${patient.mother.name} + ${baby.name}` : patientLabel(patient);
}
function patientInitials(patient) { return `${patient?.mother?.name?.[0] || 'M'}${familyBabies(patient)[0]?.name?.[0] || 'B'}`.toUpperCase(); }
function patientByMotherId(id) { return state.patients.find((p) => p.mother?.id === id) || null; }
function patientByBabyId(id) { return state.patients.find((p) => familyBabies(p).some((baby) => baby.id === id)) || null; }
function babyById(patient, id) { return familyBabies(patient).find((baby) => baby.id === id) || null; }
function selectedPdfLayout() { return normalizePdfLayout(localStorage.getItem(PDF_LAYOUT_KEY) || 'acolhedor'); }
function phoneForWhatsApp(value = '') {
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (!digits.startsWith('55')) digits = `55${digits}`;
  return digits;
}
function toast(text, tone = 'info') {
  let el = document.querySelector('[data-app-toast]');
  if (!el) {
    el = document.createElement('div');
    el.dataset.appToast = '';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.dataset.tone = tone;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 4200);
}
function reportError(error, fallback = 'Não foi possível concluir a ação.') {
  console.error(error);
  const message = error?.message || fallback;
  toast(message, 'error');
  if (/Sessão expirada/i.test(message)) showLoggedOut();
}

function showLoggedOut() {
  appStarted = false;
  appRoot.hidden = true;
  loginScreen.hidden = false;
}
function showLoggedIn() {
  loginScreen.hidden = true;
  appRoot.hidden = false;
}

function hashToScreen(hash = location.hash) {
  if (/^#\/patient\/form(?:\/|$)/.test(hash)) return 'patient-form';
  if (/^#\/patient\/[^/]+$/.test(hash)) return 'patient';
  return Object.entries(routes).find(([, route]) => route === hash)?.[0] || 'home';
}
function patientIdFromHash(hash = location.hash) {
  const match = hash.match(/^#\/patient\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
function editIdFromHash(hash = location.hash) {
  const match = hash.match(/^#\/patient\/form\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
function routeFor(screen, id = null) {
  if (screen === 'patient') return `#/patient/${encodeURIComponent(id || currentPatientId || '')}`;
  if (screen === 'patient-form') return id ? `#/patient/form/${encodeURIComponent(id)}` : '#/patient/form';
  return routes[screen] || routes.home;
}
function navigate(screen, id = null, { replace = false } = {}) {
  const route = routeFor(screen, id);
  if (location.hash !== route) {
    if (replace) history.replaceState({}, '', route); else history.pushState({}, '', route);
  }
  renderRoute();
}
function showScreen(screen) {
  if (screen !== 'appointment' && screen !== activeScreen) previousScreen = activeScreen;
  screens.forEach((el) => { el.hidden = el.dataset.screen !== screen; });
  activeScreen = screen;
  pageTitles.forEach((el) => { el.textContent = titles[screen] || 'Débora Lactação'; });
  document.querySelectorAll('[data-nav-target]').forEach((el) => el.toggleAttribute('aria-current', el.dataset.navTarget === screen));
  document.querySelectorAll('[data-mobile-target]').forEach((el) => el.classList.toggle('active', el.dataset.mobileTarget === screen));
  const focused = screen === 'appointment' || screen === 'patient-form';
  if (bottomNav) bottomNav.hidden = focused;
  if (fab) fab.hidden = focused;
  if (routeAnnouncer) routeAnnouncer.textContent = `Tela ${titles[screen] || screen}`;
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function renderRoute() {
  if (!appStarted) return;
  const screen = hashToScreen();
  if (screen === 'patient') {
    const id = patientIdFromHash();
    if (id) await openPatient(id, { navigateRoute: false });
  } else if (screen === 'patient-form') {
    await openPatientForm(editIdFromHash(), { navigateRoute: false });
  } else if (screen === 'appointment') {
    renderPatientSelect(currentPatientId);
    setEncounterIdentityLock(Boolean(currentDraftEncounterId || currentAppointmentId));
    renderWizard();
  }
  showScreen(screen);
}

function renderPatientList(filter = '') {
  const root = document.querySelector('[data-patient-list]');
  const empty = document.querySelector('[data-patient-empty]');
  if (!root) return;
  const query = String(filter).trim().toLocaleLowerCase('pt-BR');
  const patients = state.patients.filter((p) => !query || `${p.mother?.name} ${babyNames(p).join(' ')}`.toLocaleLowerCase('pt-BR').includes(query));
  root.innerHTML = patients.map((p) => `<button class="patient-card" data-action="open-patient" data-patient-id="${escapeHTML(p.mother.id)}"><div class="patient-avatar">${escapeHTML(patientInitials(p))}</div><div class="patient-copy"><strong>${escapeHTML(p.mother.name)}</strong><span>${escapeHTML(babyNames(p).join(' · ') || 'Bebê não informado')}</span><small>${escapeHTML(p.mother.phone || 'Sem telefone')}</small></div><span class="pill confirmed">Em acompanhamento</span></button>`).join('');
  if (empty) empty.hidden = patients.length > 0;
}
function renderPatientSelect(selectedMotherId = null) {
  const select = document.querySelector('[data-appointment-patient]');
  if (!select) return;
  select.innerHTML = state.patients.map((p) => `<option value="${escapeHTML(p.mother.id)}">${escapeHTML(patientLabel(p))}</option>`).join('');
  if (selectedMotherId && state.patients.some((p) => p.mother.id === selectedMotherId)) select.value = selectedMotherId;
  select.disabled = state.patients.length === 0;
  renderBabyTargetSelect(select.value || selectedMotherId);
}
function renderBabyTargetSelect(motherId, preferred = null) {
  const select = document.querySelector('[data-appointment-baby]');
  const field = document.querySelector('[data-baby-target-field]');
  if (!select) return;
  const patient = patientByMotherId(motherId);
  const babies = familyBabies(patient);
  const options = babies.map((baby) => `<option value="${escapeHTML(baby.id)}">${escapeHTML(baby.name)}</option>`);
  if (babies.length > 1) options.unshift('<option value="all">Todos os bebês</option>');
  select.innerHTML = options.join('');
  const fallback = babies.length > 1 ? 'all' : babies[0]?.id || '';
  select.value = preferred && (preferred === 'all' || babies.some((baby) => baby.id === preferred)) ? preferred : fallback;
  select.disabled = babies.length === 0;
  if (field) field.hidden = babies.length === 0;
  renderBabyClinicalSections();
}
function setText(selector, value) { const el = document.querySelector(selector); if (el) el.textContent = value; }
async function openPatient(motherId, { navigateRoute = true, babyId = null } = {}) {
  const patient = patientByMotherId(motherId) || await appData.getPatient(motherId);
  if (!patient) { toast('Paciente não encontrada.', 'error'); return; }
  currentPatientId = patient.mother.id;
  const babies = familyBabies(patient);
  const selectedBaby = babyById(patient, babyId || currentBabyId) || babies[0] || null;
  currentBabyId = selectedBaby?.id || null;
  setText('[data-patient-avatar]', patientInitials(patient));
  setText('[data-patient-title]', patientLabel(patient));
  setText('[data-patient-subtitle]', `${patient.mother.name} · ${babyNames(patient).join(' e ') || 'bebê'}`);
  setText('[data-mother-phone]', patient.mother.phone || 'Não informado');
  setText('[data-mother-delivery]', patient.mother.delivery || 'Não informado');
  setText('[data-mother-conditions]', patient.mother.conditions || 'Não informado');
  setText('[data-mother-history]', patient.mother.breastfeeding_history || 'Não informado');
  renderBabySelector(patient, selectedBaby?.id);
  renderBabyDetails(selectedBaby);
  try {
    const [weights, encounters] = await Promise.all([
      selectedBaby?.id ? appData.listWeights(selectedBaby.id) : Promise.resolve([]),
      appData.listEncounters(patient.mother.id)
    ]);
    renderPatientWeights(weights, selectedBaby);
    renderPatientTimeline(encounters);
  } catch (error) { reportError(error); }
  if (navigateRoute) navigate('patient', patient.mother.id); else showScreen('patient');
}
function renderBabySelector(patient, selectedId) {
  const root = document.querySelector('[data-baby-selector]');
  if (!root) return;
  const babies = familyBabies(patient);
  root.innerHTML = babies.map((baby) => `<button type="button" class="baby-tab ${baby.id === selectedId ? 'active' : ''}" data-action="select-baby" data-baby-id="${escapeHTML(baby.id)}">${escapeHTML(baby.name)}</button>`).join('');
  root.parentElement?.toggleAttribute('hidden', babies.length < 2);
}
function renderBabyDetails(baby) {
  setText('[data-baby-detail-title]', baby ? `Dados de ${baby.name}` : 'Dados do bebê');
  setText('[data-baby-birth]', baby ? [dateLabel(baby.birth_date), baby.gestational_age].filter(Boolean).join(' · ') : 'Não informado');
  setText('[data-baby-birth-weight]', grams(baby?.birth_weight_g));
  setText('[data-baby-current-weight]', grams(baby?.current_weight_g));
  setText('[data-baby-feeding]', baby?.feeding || 'Não informado');
}
function renderPatientWeights(weights = [], baby = null) {
  const root = document.querySelector('[data-patient-weights-live]');
  if (!root) return;
  if (!weights.length) { root.innerHTML = `<div class="empty-live">Nenhum peso registrado${baby?.name ? ` para ${escapeHTML(baby.name)}` : ''} ainda.</div>`; return; }
  root.innerHTML = `<div class="weight-list">${weights.map((w) => `<div><span>${escapeHTML(dateLabel(w.measured_at))}</span><strong>${escapeHTML(grams(w.weight_g))}</strong></div>`).join('')}</div>`;
}
function renderPatientTimeline(encounters = []) {
  const root = document.querySelector('[data-patient-timeline-live]');
  if (!root) return;
  if (!encounters.length) { root.innerHTML = '<div class="empty-live">Nenhum atendimento clínico registrado.</div>'; return; }
  root.innerHTML = encounters.map((e, i) => `<div class="timeline-item ${i === 0 ? 'active' : ''}"><span></span>${e.status === 'draft' ? `<button type="button" class="timeline-entry" data-action="open-encounter" data-encounter-id="${escapeHTML(e.id)}"><strong>Rascunho</strong><small>${escapeHTML(dateTimeLabel(e.occurred_at || e.created_at))}</small><p>${escapeHTML(e.chief_complaint?.notes || (e.chief_complaint?.tags || []).join(', ') || 'Registro clínico')}</p><em>Abrir e continuar ›</em></button>` : `<div><strong>Atendimento</strong><small>${escapeHTML(dateTimeLabel(e.occurred_at || e.created_at))}</small><p>${escapeHTML(e.chief_complaint?.notes || (e.chief_complaint?.tags || []).join(', ') || 'Registro clínico')}</p></div>`}</div>`).join('');
}

async function openEncounter(encounterId) {
  const encounter = await appData.getEncounter(encounterId);
  if (!encounter) throw new Error('Rascunho não encontrado.');
  if (encounter.status !== 'draft') { toast('Este atendimento já foi finalizado.'); return; }
  const patient = patientByMotherId(encounter.mother_id) || await appData.getPatient(encounter.mother_id);
  if (!patient) throw new Error('Paciente do rascunho não encontrada.');
  currentPatientId = patient.mother.id;
  previousScreen = 'patient';
  resetWizard(patient.mother.id);
  setActiveEncounterIds(encounter.id, encounter.appointment_id);
  renderPatientSelect(patient.mother.id);
  const preferredTarget = encounter.identification?.babyTarget || encounter.baby_id || (Array.isArray(encounter.identification?.babyIds) && encounter.identification.babyIds.length > 1 ? 'all' : null);
  renderBabyTargetSelect(patient.mother.id, preferredTarget);
  renderBabyClinicalSections(encounter);
  applyEncounterDraft(appointmentScreen, encounter);
  setEncounterIdentityLock(true);
  wizardStep = 1;
  renderWizard();
  navigate('appointment');
  toast('Rascunho aberto. Continue de onde parou.', 'success');
}

function babyEditorMarkup(baby = {}, index = 0) {
  const id = baby.id || '';
  return `<article class="detail-card patient-form-card baby-editor-card" data-baby-editor data-baby-id="${escapeHTML(id)}">
    <div class="section-heading"><div><span class="section-kicker">BEBÊ ${index + 1}</span><h3>${escapeHTML(baby.name || `Bebê ${index + 1}`)}</h3></div>${!id && index > 0 ? '<button type="button" class="text-button danger" data-action="remove-baby-editor">Remover</button>' : ''}</div>
    <div class="form-grid">
      <label class="field"><span>Nome do bebê *</span><input data-baby-field="name" required value="${escapeHTML(baby.name || '')}" placeholder="Nome do bebê"></label>
      <label class="field"><span>Data de nascimento</span><input data-baby-field="birth_date" type="date" value="${escapeHTML(baby.birth_date || '')}"></label>
      <label class="field"><span>Peso ao nascer</span><div class="unit-input"><input data-baby-field="birth_weight_g" type="number" min="0" inputmode="numeric" value="${escapeHTML(baby.birth_weight_g ?? '')}" placeholder="3420"><b>g</b></div></label>
      <label class="field"><span>Peso atual</span><div class="unit-input"><input data-baby-field="current_weight_g" type="number" min="0" inputmode="numeric" value="${escapeHTML(baby.current_weight_g ?? '')}" placeholder="3780"><b>g</b></div></label>
      <label class="field"><span>Idade gestacional</span><input data-baby-field="gestational_age" value="${escapeHTML(baby.gestational_age || '')}" placeholder="Ex.: 39s2d"></label>
      <label class="field"><span>Alimentação atual</span><select data-baby-field="feeding"><option value="">Não informado</option>${['Aleitamento materno exclusivo','Aleitamento misto','Fórmula','Leite ordenhado','Outro'].map((item) => `<option ${baby.feeding === item ? 'selected' : ''}>${item}</option>`).join('')}</select></label>
    </div>
  </article>`;
}
function renderBabyEditors(babies = [{}]) {
  const root = document.querySelector('[data-babies-editor]');
  if (!root) return;
  const list = babies.length ? babies : [{}];
  root.innerHTML = list.map(babyEditorMarkup).join('');
}
async function openPatientForm(motherId = null, { navigateRoute = true } = {}) {
  editingPatientId = motherId || null;
  patientForm.reset();
  const patient = motherId ? patientByMotherId(motherId) || await appData.getPatient(motherId) : null;
  const val = (name, value = '') => { const field = patientForm.elements.namedItem(name); if (field) field.value = value ?? ''; };
  val('motherName', patient?.mother?.name); val('motherPhone', patient?.mother?.phone); val('motherBirthDate', patient?.mother?.birth_date);
  val('motherDelivery', patient?.mother?.delivery); val('motherConditions', patient?.mother?.conditions); val('motherHistory', patient?.mother?.breastfeeding_history); val('notes', patient?.mother?.notes);
  renderBabyEditors(patient ? familyBabies(patient) : [{}]);
  setText('[data-patient-form-title]', patient ? 'Editar paciente' : 'Nova paciente');
  if (patient) {
    try {
      const consents = await appData.listConsents(patient.mother.id);
      const map = Object.fromEntries(consents.map((c) => [c.consent_type, c.granted && !c.revoked_at]));
      const pairs = { consentData: 'data_processing', consentWhatsapp: 'whatsapp', consentClinicalMedia: 'clinical_media', consentPublicMedia: 'public_media' };
      for (const [name, type] of Object.entries(pairs)) { const el = patientForm.elements.namedItem(name); if (el) el.checked = Boolean(map[type]); }
    } catch (error) { reportError(error); }
  }
  if (navigateRoute) navigate('patient-form', motherId); else showScreen('patient-form');
}
function patientFormPayload() {
  const get = (name) => patientForm.elements.namedItem(name)?.value ?? '';
  const babies = [...patientForm.querySelectorAll('[data-baby-editor]')].map((card) => {
    const field = (name) => card.querySelector(`[data-baby-field="${name}"]`)?.value ?? '';
    const number = (name) => field(name) === '' ? null : Number(field(name));
    return {
      ...(card.dataset.babyId ? { id: card.dataset.babyId } : {}),
      name: field('name').trim(), birth_date: field('birth_date') || null, birth_weight_g: number('birth_weight_g'), current_weight_g: number('current_weight_g'),
      gestational_age: field('gestational_age').trim(), feeding: field('feeding').trim()
    };
  }).filter((baby) => baby.name);
  return {
    mother: {
      name: get('motherName').trim(), phone: get('motherPhone').trim(), birth_date: get('motherBirthDate') || null,
      delivery: get('motherDelivery').trim(), conditions: get('motherConditions').trim(), breastfeeding_history: get('motherHistory').trim(), notes: get('notes').trim()
    },
    babies
  };
}
function patientConsentPayload() {
  const checked = (name) => Boolean(patientForm.elements.namedItem(name)?.checked);
  return { data_processing: checked('consentData'), whatsapp: checked('consentWhatsapp'), clinical_media: checked('consentClinicalMedia'), public_media: checked('consentPublicMedia') };
}
patientForm?.addEventListener('submit', async (event) => {
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
});

document.querySelector('[data-patient-search]')?.addEventListener('input', (event) => renderPatientList(event.target.value));

function sameMonth(value, date = new Date()) {
  if (!value) return false;
  return clinicMonthKey(value) === clinicMonthKey(date);
}
function appointmentBabyIds(appointment) {
  const ids = Array.isArray(appointment?.baby_ids) ? appointment.baby_ids.filter(Boolean) : [];
  if (!ids.length && appointment?.baby_id) ids.push(appointment.baby_id);
  return [...new Set(ids)];
}
function appointmentPatientLabel(appointment) {
  const patient = patientByMotherId(appointment?.mother_id) || patientByBabyId(appointment?.baby_id);
  const ids = appointmentBabyIds(appointment);
  if (!patient) return 'Paciente';
  if (ids.length === 1) return patientTargetLabel(patient, ids[0]);
  return patientLabel(patient);
}
function appointmentStatusClass(status) {
  if (status === 'Realizado') return 'completed';
  if (status === 'Confirmado' || status === 'Em atendimento') return 'confirmed';
  if (status === 'Cancelado') return 'danger';
  return 'waiting';
}
function isScheduledStatus(status) {
  return status === 'Agendado' || status === 'Confirmado';
}
function renderAgendaCard(appointment, { compact = false } = {}) {
  const scheduled = isScheduledStatus(appointment.status);
  const canDelete = scheduled && !appointment.encounter_id;
  const actions = [];
  if (!compact && scheduled) actions.push(`<button data-action="start-scheduled-appointment" data-appointment-id="${escapeHTML(appointment.id)}">Iniciar</button>`);
  if (!compact && appointment.status === 'Em atendimento' && appointment.encounter_id) actions.push(`<button data-action="open-encounter" data-encounter-id="${escapeHTML(appointment.encounter_id)}">Continuar</button>`);
  if (!compact && appointment.status === 'Realizado' && appointment.encounter_id) actions.push(`<button data-action="open-clinical-note" data-encounter-id="${escapeHTML(appointment.encounter_id)}">Prontuário</button>`);
  actions.push(`<button data-action="open-patient" data-patient-id="${escapeHTML(appointment.mother_id)}">Abrir</button>`);
  if (!compact && canDelete) actions.push(`<button class="danger" data-action="delete-scheduled-appointment" data-appointment-id="${escapeHTML(appointment.id)}">Excluir</button>`);
  return `<article class="agenda-card" data-appointment-id="${escapeHTML(appointment.id)}" data-agenda-date="${escapeHTML(clinicDayKey(appointment.starts_at))}"><time>${escapeHTML(timeLabel(appointment.starts_at))}</time><div class="agenda-main"><strong>${escapeHTML(appointmentPatientLabel(appointment))}</strong><span>${escapeHTML(`${appointment.appointment_type || 'Atendimento'} · ${appointment.format || ''}`)}</span></div><span class="pill ${appointmentStatusClass(appointment.status)}">${escapeHTML(appointment.status || 'Agendado')}</span><div class="agenda-actions">${actions.join('')}</div></article>`;
}
function renderHomeHeader(now = new Date()) {
  const dateText = new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TIME_ZONE, weekday: 'long', day: '2-digit', month: 'long' }).format(now).toUpperCase();
  setText('[data-home-date]', dateText);
  const hour = Number(clinicParts(now)?.hour || 12);
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  setText('[data-home-greeting]', `${greeting}, Débora`);
  const todayKey = clinicDayKey(now);
  const todayCount = state.appointments.filter((a) => a.status !== 'Cancelado' && clinicDayKey(a.starts_at) === todayKey).length;
  const pendingCount = state.followups.filter((f) => f.status === 'Pendente').length;
  setText('[data-home-summary]', `${todayCount} ${todayCount === 1 ? 'atendimento' : 'atendimentos'} hoje · ${pendingCount} ${pendingCount === 1 ? 'acompanhamento pendente' : 'acompanhamentos pendentes'}`);
  const monthCount = state.encounters.filter((encounter) => String(encounter.status || '').toLocaleLowerCase('pt-BR') === 'finalized' && sameMonth(encounter.occurred_at || encounter.created_at, now)).length;
  setText('[data-kpi-month]', String(monthCount));
  const monthName = new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TIME_ZONE, month: 'long' }).format(now);
  setText('[data-kpi-month-meta]', monthCount === 1 ? `1 atendimento realizado em ${monthName}` : `${monthCount} atendimentos realizados em ${monthName}`);
}
function renderDateStrip(selectedDay = agendaSelectedDay || clinicDayKey(new Date())) {
  const root = document.querySelector('[data-date-strip-live]');
  if (!root) return;
  agendaSelectedDay = selectedDay || clinicDayKey(new Date());
  const selectedDate = dayKeyDate(agendaSelectedDay);
  const weekday = selectedDate.getUTCDay() || 7;
  const monday = new Date(selectedDate);
  monday.setUTCDate(monday.getUTCDate() - weekday + 1);
  const dayButtons = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday); date.setUTCDate(monday.getUTCDate() + index);
    const key = clinicDayKey(date);
    const selected = key === agendaSelectedDay;
    const label = new Intl.DateTimeFormat('pt-BR', { timeZone: CLINIC_TIME_ZONE, weekday: 'short' }).format(date).replace('.', '').slice(0, 3);
    return `<button type="button" class="date-pill ${selected ? 'selected active' : ''}" data-action="agenda-select-date" data-agenda-date="${escapeHTML(key)}" aria-pressed="${selected}" ${selected ? 'aria-current="date"' : ''}><small>${escapeHTML(label)}</small><strong>${Number(key.slice(-2))}</strong></button>`;
  }).join('');
  root.innerHTML = `<button type="button" class="date-week-nav" data-action="agenda-shift-week" data-days="-7" aria-label="Semana anterior">‹</button>${dayButtons}<button type="button" class="date-week-nav" data-action="agenda-shift-week" data-days="7" aria-label="Próxima semana">›</button>`;
}
function nextAppointment(now = new Date()) {
  return state.appointments.filter((a) => new Date(a.starts_at) >= now && isScheduledStatus(a.status)).sort((a,b) => new Date(a.starts_at)-new Date(b.starts_at))[0] || null;
}
function renderAgenda() {
  const root = document.querySelector('[data-agenda-live]');
  const homeRoot = document.querySelector('[data-home-agenda-live]');
  const now = new Date();
  const todayKey = clinicDayKey(now);
  if (!agendaSelectedDay) agendaSelectedDay = todayKey;
  renderHomeHeader(now);
  renderDateStrip(agendaSelectedDay);
  const today = state.appointments.filter((a) => a.status !== 'Cancelado' && clinicDayKey(a.starts_at) === todayKey).sort((a,b) => new Date(a.starts_at)-new Date(b.starts_at));
  const selected = state.appointments.filter((a) => clinicDayKey(a.starts_at) === agendaSelectedDay).sort((a,b) => new Date(a.starts_at)-new Date(b.starts_at));
  const render = (items, compact = false) => items.length ? items.map((a) => renderAgendaCard(a, { compact })).join('') : '<div class="empty-live">Nenhum atendimento neste dia.</div>';
  if (root) root.innerHTML = render(selected);
  if (homeRoot) homeRoot.innerHTML = render(today.slice(0, 3), true);
  setText('[data-kpi-today]', String(today.length));
  setText('[data-kpi-today-meta]', today.length === 1 ? '1 atendimento no dia' : `${today.length} atendimentos no dia`);
  const next = nextAppointment(now);
  const actions = document.querySelector('[data-next-actions]');
  const nextCard = document.querySelector('[data-next-appointment]');
  if (next) {
    const p = patientByMotherId(next.mother_id) || patientByBabyId(next.baby_id);
    setText('.next-time', timeLabel(next.starts_at));
    setText('.next-patient strong', appointmentPatientLabel(next));
    setText('.next-patient span', `${next.appointment_type || 'Atendimento'} · ${next.format || ''}`);
    if (nextCard) { nextCard.dataset.motherId = next.mother_id || ''; nextCard.dataset.address = next.address || p?.mother?.address || ''; nextCard.dataset.appointmentId = next.id || ''; }
    if (actions) actions.hidden = false;
  } else {
    setText('.next-time', '--:--'); setText('.next-patient strong', 'Nenhum próximo atendimento'); setText('.next-patient span', 'Sua agenda está livre por enquanto.');
    if (nextCard) { delete nextCard.dataset.motherId; delete nextCard.dataset.address; delete nextCard.dataset.appointmentId; }
    if (actions) actions.hidden = true;
  }
}
function followupMarkup(f) {
  const p = patientByMotherId(f.mother_id);
  const overdue = new Date(f.due_at) < new Date();
  const grouped = Number(f._groupedCount || 1);
  const history = grouped > 1 ? ` · ${grouped} pendências agrupadas` : '';
  return `<article class="followup-card ${overdue ? 'urgent' : ''}"><div class="followup-icon">↻</div><div><strong>${escapeHTML(p ? patientTargetLabel(p, f.baby_id) : 'Paciente')}</strong><span>${escapeHTML(f.notes || 'Acompanhamento')}</span><small>${escapeHTML(dateTimeLabel(f.due_at))}${escapeHTML(history)}</small></div><div class="followup-actions"><button data-action="followup-whatsapp" data-followup-id="${f.id}">WhatsApp</button><button data-action="complete-followup" data-followup-id="${f.id}">Concluir</button></div></article>`;
}
function renderFollowups() {
  const root = document.querySelector('[data-followups-live]');
  const homeRoot = document.querySelector('[data-home-followups-live]');
  const rawPending = state.followups.filter((f) => f.status === 'Pendente').sort((a,b) => new Date(a.due_at)-new Date(b.due_at));
  const groupedByPatient = new Map();
  for (const followup of rawPending) {
    const key = `${followup.mother_id || ''}|${followup.baby_id || ''}`;
    const current = groupedByPatient.get(key);
    if (!current) groupedByPatient.set(key, { ...followup, _groupedCount: 1 });
    else current._groupedCount += 1;
  }
  const pending = [...groupedByPatient.values()];
  setText('[data-kpi-followups]', String(pending.length));
  const markup = pending.length ? pending.map(followupMarkup).join('') : '<div class="empty-live">Nenhum follow-up pendente.</div>';
  if (root) root.innerHTML = markup;
  if (homeRoot) homeRoot.innerHTML = pending.length ? pending.slice(0,2).map(followupMarkup).join('') : '<div class="empty-live">Nenhum acompanhamento pendente.</div>';
}
function renderFinance() {
  const root = document.querySelector('[data-finance-live]');
  const now = new Date();
  const pending = state.financial.filter((f) => f.status === 'Pendente');
  const currentMonth = state.financial.filter((f) => sameMonth(f.created_at || f.due_at || f.paid_at, now) && f.status !== 'Cancelado');
  const paidThisMonth = state.financial.filter((f) => f.status === 'Pago' && sameMonth(f.paid_at || f.updated_at || f.created_at, now));
  const pendingTotal = pending.reduce((sum, f) => sum + Number(f.amount_cents || 0), 0);
  const receivedTotal = paidThisMonth.reduce((sum, f) => sum + Number(f.amount_cents || 0), 0);
  const ticket = currentMonth.length ? currentMonth.reduce((sum, f) => sum + Number(f.amount_cents || 0), 0) / currentMonth.length : 0;
  setText('[data-kpi-receivable]', currency(pendingTotal));
  setText('[data-finance-received]', currency(receivedTotal));
  setText('[data-finance-received-meta]', `${paidThisMonth.length} ${paidThisMonth.length === 1 ? 'pagamento' : 'pagamentos'}`);
  setText('[data-finance-receivable]', currency(pendingTotal));
  setText('[data-finance-receivable-meta]', `${pending.length} ${pending.length === 1 ? 'pendência' : 'pendências'}`);
  setText('[data-finance-ticket]', currency(ticket));
  setText('[data-finance-ticket-meta]', currentMonth.length ? `${currentMonth.length} ${currentMonth.length === 1 ? 'lançamento' : 'lançamentos'} no mês` : 'sem lançamentos no mês');
  if (!root) return;
  root.innerHTML = state.financial.length ? state.financial.map((f) => {
    const p = patientByMotherId(f.mother_id);
    const actions = f.status === 'Pendente'
      ? `<button data-action="finance-whatsapp" data-finance-id="${f.id}">Cobrar</button><button data-action="mark-paid" data-finance-id="${f.id}">Marcar pago</button>`
      : f.status === 'Pago'
        ? `<button data-action="undo-paid" data-finance-id="${f.id}">Desfazer pagamento</button>`
        : '';
    return `<article class="agenda-card finance-card"><div class="agenda-main"><strong>${escapeHTML(p?.mother?.name || 'Paciente')}</strong><span>${escapeHTML(f.description || 'Atendimento')}</span></div><strong class="finance-amount">${escapeHTML(currency(f.amount_cents))}</strong><span class="pill ${f.status === 'Pago' ? 'completed' : 'waiting'}">${escapeHTML(f.status)}</span><div class="agenda-actions">${actions}</div></article>`;
  }).join('') : '<div class="empty-live">Nenhum lançamento financeiro.</div>';
}
async function refreshData() {
  const [patients, appointments, encounters, followups, financial] = await Promise.all([
    appData.listPatients(), appData.listAppointments(), appData.listFinalizedEncounters(), appData.listFollowups(), appData.listFinancialEntries()
  ]);
  state.patients = patients; state.appointments = appointments; state.encounters = encounters; state.followups = followups; state.financial = financial;
  renderPatientList(); renderPatientSelect(currentPatientId); renderAgenda(); renderFollowups(); renderFinance();
}

function decorateClinicalChoices() {
  const add = (selector, section, field, multiple = false, babyId = null) => document.querySelectorAll(selector).forEach((el) => {
    if (el.dataset.encounterChoice !== undefined) return;
    el.type = 'button'; el.dataset.encounterChoice = ''; el.dataset.section = section; el.dataset.field = field; el.dataset.value = el.textContent.trim();
    if (multiple) el.dataset.multiple = 'true';
    if (babyId) el.dataset.babyId = babyId;
    el.setAttribute('aria-pressed', el.classList.contains('selected') ? 'true' : 'false');
  });
  add('[data-wizard-step="3"] .tag-choice', 'maternal_assessment', 'symptoms', true);
  add('[data-wizard-step="6"] .chip', 'care_plan', 'libraryItems', true);
}
function selectedWizardBabies() {
  const patient = selectedWizardPatient();
  if (!patient) return [];
  const target = document.querySelector('[data-appointment-baby]')?.value;
  if (!target || target === 'all') return familyBabies(patient);
  const baby = babyById(patient, target);
  return baby ? [baby] : [];
}
function babyAssessmentMarkup(baby) {
  return `<article class="baby-clinical-card"><div class="baby-clinical-title"><span class="patient-avatar mini">${escapeHTML((baby.name || 'B')[0])}</span><div><strong>${escapeHTML(baby.name)}</strong><small>Avaliação individual</small></div></div><div class="form-grid"><label class="field"><span>Peso atual</span><div class="unit-input"><input type="number" data-encounter-field="weightG" data-section="baby_assessment" data-baby-id="${escapeHTML(baby.id)}"><b>g</b></div></label><label class="field"><span>Ganho desde última avaliação</span><div class="unit-input"><input type="number" data-encounter-field="weightGainG" data-section="baby_assessment" data-baby-id="${escapeHTML(baby.id)}"><b>g</b></div></label><label class="field"><span>Fraldas molhadas / 24h</span><input type="number" data-encounter-field="wetDiapers" data-section="baby_assessment" data-baby-id="${escapeHTML(baby.id)}"></label><label class="field"><span>Evacuações / 24h</span><input type="number" data-encounter-field="stools" data-section="baby_assessment" data-baby-id="${escapeHTML(baby.id)}"></label></div><div class="tag-grid">${['Alerta e responsivo','Sonolento','Irritável','Uso de mamadeira','Uso de chupeta'].map((label) => `<button type="button" class="tag-choice" data-encounter-choice data-section="baby_assessment" data-field="observations" data-baby-id="${escapeHTML(baby.id)}" data-value="${escapeHTML(label)}" data-multiple="true" aria-pressed="false">${escapeHTML(label)}</button>`).join('')}</div><label class="field"><span>Observações de ${escapeHTML(baby.name)}</span><textarea rows="3" data-encounter-field="notes" data-section="baby_assessment" data-baby-id="${escapeHTML(baby.id)}"></textarea></label></article>`;
}
function feedingAssessmentMarkup(baby) {
  const choices = (field, labels, multiple = false) => `<div class="choice-grid">${labels.map((label) => `<button type="button" class="choice" data-encounter-choice data-section="feeding_assessment" data-field="${field}" data-baby-id="${escapeHTML(baby.id)}" data-value="${escapeHTML(label)}" ${multiple ? 'data-multiple="true"' : ''} aria-pressed="false">${escapeHTML(label)}</button>`).join('')}</div>`;
  return `<article class="baby-clinical-card"><div class="baby-clinical-title"><span class="patient-avatar mini">${escapeHTML((baby.name || 'B')[0])}</span><div><strong>${escapeHTML(baby.name)}</strong><small>Observação da mamada</small></div></div><div class="assessment-block"><strong>Posição</strong>${choices('position',['Tradicional','Invertida','Cavalinho','Deitada'])}</div><div class="assessment-block"><strong>Pega</strong>${choices('latch',['Adequada após ajuste','Superficial','Assimétrica'])}</div><div class="assessment-block"><strong>Sucção e deglutição</strong>${choices('suckSwallow',['Sucção rítmica','Deglutição audível','Pausas longas','Sucção fraca'], true)}</div><label class="field"><span>Observações sobre ${escapeHTML(baby.name)}</span><textarea rows="3" data-encounter-field="notes" data-section="feeding_assessment" data-baby-id="${escapeHTML(baby.id)}"></textarea></label></article>`;
}
function renderBabyClinicalSections(savedDraft = null) {
  const babies = selectedWizardBabies();
  const babyRoot = document.querySelector('[data-baby-assessment-editor]');
  const feedingRoot = document.querySelector('[data-feeding-assessment-editor]');
  if (babyRoot) babyRoot.innerHTML = babies.length ? babies.map(babyAssessmentMarkup).join('') : '<div class="empty-live">Selecione uma paciente e um bebê.</div>';
  if (feedingRoot) feedingRoot.innerHTML = babies.length ? babies.map(feedingAssessmentMarkup).join('') : '<div class="empty-live">Selecione uma paciente e um bebê.</div>';
  if (savedDraft) applyEncounterDraft(appointmentScreen, savedDraft);
}

function setEncounterIdentityLock(locked) {
  const patientSelect = document.querySelector('[data-appointment-patient]');
  const babySelect = document.querySelector('[data-appointment-baby]');
  if (patientSelect) patientSelect.disabled = Boolean(locked) || state.patients.length === 0;
  if (babySelect) babySelect.disabled = Boolean(locked) || babySelect.options.length === 0;
}
function setActiveEncounterIds(encounterId, appointmentId) {
  currentDraftEncounterId = encounterId || null;
  currentAppointmentId = appointmentId || null;
  if (appointmentScreen) {
    if (currentDraftEncounterId) appointmentScreen.dataset.encounterId = currentDraftEncounterId; else delete appointmentScreen.dataset.encounterId;
    if (currentAppointmentId) appointmentScreen.dataset.appointmentId = currentAppointmentId; else delete appointmentScreen.dataset.appointmentId;
  }
  setEncounterIdentityLock(Boolean(currentDraftEncounterId || currentAppointmentId));
}
async function ensureEncounterStarted() {
  if (currentDraftEncounterId && currentAppointmentId) return { encounter_id: currentDraftEncounterId, appointment_id: currentAppointmentId };
  const patient = selectedWizardPatient();
  if (!patient) throw new Error('Selecione uma paciente antes de iniciar o atendimento.');
  const selectedBabies = selectedWizardBabies();
  if (!selectedBabies.length) throw new Error('Selecione pelo menos um bebê.');
  const draft = collectEncounterDraft(appointmentScreen), ident = draft.identification || {};
  const startsAt = ident.startsAt ? clinicInputToIso(ident.startsAt) : new Date().toISOString();
  const valueCents = Math.max(0, Math.round(Number(ident.value || 0) * 100));
  await window.DeboraBilling?.beforeStart?.(patient.mother.id);

  if (currentAppointmentId) {
    await appData.updateAppointment(currentAppointmentId, {
      starts_at: startsAt,
      duration_min: Number(ident.durationMin || 60),
      appointment_type: ident.appointmentType || 'Atendimento',
      format: ident.format || 'Domiciliar',
      value_cents: valueCents,
      payment_status: valueCents ? 'Pendente' : 'Sem cobrança',
      address: patient.mother.address || ''
    });
    const result = await appData.startClinicalEncounterFromAppointment(currentAppointmentId);
    if (!result?.encounter_id || !result?.appointment_id) throw new Error('O banco não retornou encounter_id/appointment_id do agendamento.');
    setActiveEncounterIds(result.encounter_id, result.appointment_id);
    return result;
  }

  const result = await appData.startClinicalEncounter({
    p_mother_id: patient.mother.id,
    p_baby_ids: selectedBabies.map((baby) => baby.id),
    p_starts_at: startsAt,
    p_duration_min: Number(ident.durationMin || 60),
    p_appointment_type: ident.appointmentType || 'Atendimento',
    p_format: ident.format || 'Domiciliar',
    p_value_cents: valueCents,
    p_payment_status: valueCents ? 'Pendente' : 'Sem cobrança',
    p_address: patient.mother.address || '',
    p_notes: selectedBabies.length > 1 ? `Atendimento conjunto: ${selectedBabies.map((baby) => baby.name).join(', ')}` : ''
  });
  if (!result?.encounter_id || !result?.appointment_id) throw new Error('O banco não retornou encounter_id/appointment_id.');
  setActiveEncounterIds(result.encounter_id, result.appointment_id);
  return result;
}
function scheduleEncounterAutosave() {
  if (!currentDraftEncounterId || encounterAutosaveBusy) return;
  clearTimeout(encounterAutosaveTimer);
  encounterAutosaveTimer = setTimeout(async () => {
    if (!currentDraftEncounterId || encounterAutosaveBusy) return;
    encounterAutosaveBusy = true;
    try { await saveDraft({ silent: true }); } catch (error) { console.warn('Autosave clínico falhou', error); }
    finally { encounterAutosaveBusy = false; }
  }, 700);
}
function resetWizard(selectedMotherId = currentPatientId) {
  clearTimeout(encounterAutosaveTimer);
  currentDraftEncounterId = null; currentAppointmentId = null; pendingMediaFile = null; wizardStep = 1;
  setText('.wizard-header h1', 'Novo atendimento');
  if (appointmentScreen) { delete appointmentScreen.dataset.encounterId; delete appointmentScreen.dataset.appointmentId; }
  setEncounterIdentityLock(false);
  renderPatientSelect(selectedMotherId);
  document.querySelectorAll('[data-encounter-field]').forEach((el) => {
    if (el.dataset.encounterField === 'patientId' || el.dataset.encounterField === 'babyTarget') return;
    if (el.tagName === 'SELECT') el.selectedIndex = 0;
    else if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
    else el.value = '';
  });
  document.querySelectorAll('[data-encounter-choice]').forEach((el) => { el.classList.remove('selected'); el.setAttribute('aria-pressed', 'false'); });
  const defaultChoice = (field, value) => {
    const el = document.querySelector(`[data-encounter-choice][data-field="${field}"][data-value="${value}"]`);
    if (el) { el.classList.add('selected'); el.setAttribute('aria-pressed', 'true'); }
  };
  defaultChoice('appointmentType', 'Consulta inicial');
  defaultChoice('format', 'Domiciliar');
  const starts = document.querySelector('[data-encounter-field="startsAt"]'); if (starts) starts.value = localDateTimeInput();
  const duration = document.querySelector('[data-encounter-field="durationMin"]'); if (duration) duration.value = '60';
  const value = document.querySelector('[data-encounter-field="value"]'); if (value) value.value = '0';
  const followup = document.querySelector('[data-encounter-field="followup"]'); if (followup) followup.value = '48 horas';
  const mediaInput = document.querySelector('[data-clinical-media-input]'); if (mediaInput) mediaInput.value = '';
  const pdfSelect = document.querySelector('[data-pdf-layout-encounter]'); if (pdfSelect) pdfSelect.value = selectedPdfLayout();
  renderBabyClinicalSections();
  renderWizard();
}
function renderWizard() {
  document.querySelectorAll('[data-wizard-step]').forEach((el) => { el.hidden = Number(el.dataset.wizardStep) !== wizardStep; });
  document.querySelectorAll('[data-progress-segment]').forEach((el, i) => el.classList.toggle('active', i < wizardStep));
  setText('[data-wizard-count]', String(wizardStep));
  const prev = document.querySelector('[data-wizard-prev]'); if (prev) prev.disabled = wizardStep === 1;
  const next = document.querySelector('[data-wizard-next]'); if (next) next.textContent = wizardStep === 7 ? 'Salvar atendimento' : 'Continuar';
  if (wizardStep === 7) {
    const p = patientByMotherId(document.querySelector('[data-appointment-patient]')?.value);
    const draft = collectEncounterDraft(appointmentScreen);
    const plan = draft.care_plan || {};
    const targets = selectedWizardBabies();
    setText('[data-final-patient]', p ? `${p.mother.name} + ${targets.map((baby) => baby.name).join(' e ') || babyNames(p).join(' e ')}` : 'Selecione uma paciente');
    const hasPlan = Boolean(String(plan.objectives || '').trim() || String(plan.instructions || '').trim() || (Array.isArray(plan.libraryItems) && plan.libraryItems.length));
    setText('[data-final-plan]', hasPlan ? 'Plano preenchido' : 'Sem orientações registradas');
    setText('[data-final-followup]', plan.followup || 'A combinar');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function selectedWizardPatient() { return patientByMotherId(document.querySelector('[data-appointment-patient]')?.value); }
function selectedWizardBabyId() { const babies = selectedWizardBabies(); return babies.length === 1 ? babies[0].id : null; }
function followupDue(label, base = new Date()) {
  const due = new Date(base);
  if (label === '24 horas') due.setHours(due.getHours() + 24);
  else if (label === '48 horas') due.setHours(due.getHours() + 48);
  else if (label === '3 dias') due.setDate(due.getDate() + 3);
  else if (label === '7 dias') due.setDate(due.getDate() + 7);
  else return null;
  return due.toISOString();
}
async function saveDraft({ silent = false } = {}) {
  const patient = selectedWizardPatient();
  if (!patient) throw new Error('Cadastre ou selecione uma paciente antes de salvar.');
  await ensureEncounterStarted();
  const clinicalState = collectEncounterDraft(appointmentScreen);
  clinicalState.identification ||= {};
  clinicalState.identification.babyIds = selectedWizardBabies().map((baby) => baby.id);
  const payload = buildEncounterPayload({ motherId: patient.mother.id, babyId: selectedWizardBabyId(), appointmentId: currentAppointmentId, state: clinicalState, status: 'draft' });
  const saved = await appData.updateEncounter(currentDraftEncounterId, payload);
  if (!saved?.id) throw new Error('Não foi possível confirmar o rascunho no SQL.');
  if (!silent) toast('Rascunho salvo no banco.', 'success');
  return saved;
}
async function finalizeEncounter() {
  const patient = selectedWizardPatient();
  if (!patient) throw new Error('Selecione uma paciente.');
  const selectedBabies = selectedWizardBabies();
  if (!selectedBabies.length) throw new Error('Selecione pelo menos um bebê.');
  await ensureEncounterStarted();
  const singleBabyId = selectedBabies.length === 1 ? selectedBabies[0].id : null;
  const clinicalState = collectEncounterDraft(appointmentScreen);
  const ident = clinicalState.identification || {};
  ident.babyIds = selectedBabies.map((baby) => baby.id);
  clinicalState.identification = ident;
  const startsAt = ident.startsAt ? clinicInputToIso(ident.startsAt) : new Date().toISOString();
  const valueCents = Math.max(0, Math.round(Number(ident.value || 0) * 100));
  await appData.updateAppointment(currentAppointmentId, {
    mother_id: patient.mother.id,
    baby_id: singleBabyId,
    starts_at: startsAt,
    duration_min: Number(ident.durationMin || 60),
    appointment_type: ident.appointmentType || 'Atendimento',
    format: ident.format || 'Domiciliar',
    status: 'Realizado',
    value_cents: valueCents,
    payment_status: valueCents ? 'Pendente' : 'Sem cobrança',
    notes: selectedBabies.length > 1 ? `Atendimento conjunto: ${selectedBabies.map((baby) => baby.name).join(', ')}` : ''
  });
  const encounterPayload = buildEncounterPayload({ motherId: patient.mother.id, babyId: singleBabyId, appointmentId: currentAppointmentId, state: clinicalState, status: 'finalized' });
  const encounter = await appData.updateEncounter(currentDraftEncounterId, encounterPayload);
  for (const baby of selectedBabies) {
    const assessment = clinicalState.baby_assessment?.byBaby?.[baby.id] || (selectedBabies.length === 1 ? clinicalState.baby_assessment : {});
    const weight = Number(assessment?.weightG || 0);
    if (weight > 0) {
      await appData.addWeight({ baby_id: baby.id, encounter_id: encounter.id, measured_at: startsAt, weight_g: weight });
      await repositories.babies.update(baby.id, { current_weight_g: weight });
    }
  }
  const dueAt = followupDue(clinicalState.care_plan?.followup, new Date(startsAt));
  if (dueAt) await appData.createOrSupersedeFollowup({ mother_id: patient.mother.id, baby_id: singleBabyId, encounter_id: encounter.id, due_at: dueAt, notes: selectedBabies.length > 1 ? `Acompanhamento de ${selectedBabies.map((baby) => baby.name).join(' e ')}` : 'Acompanhamento após atendimento' });
  if (valueCents > 0) await appData.ensureFinancialEntryForEncounter({ mother_id: patient.mother.id, appointment_id: currentAppointmentId, encounter_id: encounter.id, description: ident.appointmentType || 'Atendimento', amount_cents: valueCents, due_at: startsAt.slice(0,10) });
  if (pendingMediaFile) {
    const consents = await appData.listConsents(patient.mother.id);
    await mediaService.upload({ file: pendingMediaFile, ownerId: authService.getSession()?.user?.id, motherId: patient.mother.id, babyId: singleBabyId, encounterId: encounter.id, consents });
  }
  await window.DeboraBilling?.afterStart?.(patient.mother.id, encounter.id);
  clearTimeout(encounterAutosaveTimer);
  setActiveEncounterIds(null, null);
  pendingMediaFile = null;
  toast('Atendimento salvo com segurança.', 'success');
  await refreshData();
  await openPatient(patient.mother.id);
}

function choosePatientPrompt() {
  if (!state.patients.length) { toast('Cadastre uma paciente primeiro.', 'error'); return null; }
  const options = state.patients.map((p, i) => `${i + 1}. ${patientLabel(p)}`).join('\n');
  const answer = prompt(`Escolha a paciente:\n${options}`, '1');
  if (answer == null) return null;
  const index = Number(answer) - 1;
  return state.patients[index] || null;
}
function chooseBabyTargetPrompt(patient, { allowAll = true } = {}) {
  const babies = familyBabies(patient);
  if (!babies.length) return null;
  if (babies.length === 1) return babies[0];
  const options = babies.map((baby, index) => `${index + 1}. ${baby.name}`).join('\n');
  const answer = prompt(`Escolha o bebê${allowAll ? ' (0 = todos)' : ''}:\n${options}`, allowAll ? '0' : '1');
  if (answer == null) return undefined;
  if (allowAll && Number(answer) === 0) return null;
  return babies[Number(answer) - 1] || undefined;
}
async function scheduleAppointment() {
  const patient = choosePatientPrompt(); if (!patient) return;
  const baby = chooseBabyTargetPrompt(patient, { allowAll: true }); if (baby === undefined) return;
  const when = prompt('Data e hora (AAAA-MM-DDTHH:MM)', localDateTimeInput(new Date(Date.now() + 86400000))); if (!when) return;
  const type = prompt('Tipo do atendimento', 'Consulta inicial') || 'Consulta inicial';
  const format = prompt('Formato: Domiciliar, Presencial ou Online', 'Domiciliar') || 'Domiciliar';
  const value = Number((prompt('Valor em R$ (opcional)', '0') || '0').replace(',', '.'));
  const selectedBabies = baby ? [baby] : familyBabies(patient);
  await appData.scheduleAppointment({
    p_mother_id: patient.mother.id,
    p_baby_ids: selectedBabies.map((item) => item.id),
    p_starts_at: clinicInputToIso(when),
    p_duration_min: 60,
    p_appointment_type: type,
    p_format: format,
    p_value_cents: Math.max(0, Math.round(value * 100)),
    p_payment_status: value > 0 ? 'Pendente' : 'Sem cobrança',
    p_address: patient.mother.address || '',
    p_notes: selectedBabies.length > 1 ? `Atendimento conjunto: ${selectedBabies.map((item) => item.name).join(', ')}` : ''
  });
  agendaSelectedDay = clinicDayKey(clinicInputToIso(when));
  await refreshData(); toast('Atendimento agendado.', 'success');
}
function setEncounterChoice(field, value) {
  let normalized = String(value || '');
  if (field === 'appointmentType' && !['Retorno','Consulta inicial','Pré-natal','Acompanhamento'].includes(normalized)) {
    if (/acompanh/i.test(normalized)) normalized = 'Acompanhamento';
    else if (/retorno/i.test(normalized)) normalized = 'Retorno';
    else if (/pré|pre/i.test(normalized)) normalized = 'Pré-natal';
    else normalized = 'Consulta inicial';
  }
  const controls = [...document.querySelectorAll(`[data-encounter-choice][data-field="${field}"]`)];
  controls.forEach((control) => {
    const selected = control.dataset.value === normalized;
    control.classList.toggle('selected', selected);
    control.setAttribute('aria-pressed', String(selected));
  });
}
async function openScheduledAppointment(appointmentId) {
  const appointment = state.appointments.find((item) => item.id === appointmentId);
  if (!appointment) throw new Error('Agendamento não encontrado.');
  if (!isScheduledStatus(appointment.status)) throw new Error('Somente um agendamento pendente pode ser iniciado por esta ação.');
  if (appointment.encounter_id) throw new Error('Este agendamento já possui um atendimento clínico vinculado.');
  const patient = patientByMotherId(appointment.mother_id) || await appData.getPatient(appointment.mother_id);
  if (!patient) throw new Error('Paciente do agendamento não encontrada.');
  previousScreen = 'agenda';
  currentPatientId = patient.mother.id;
  resetWizard(patient.mother.id);
  renderPatientSelect(patient.mother.id);
  const babyIds = appointmentBabyIds(appointment);
  const preferredTarget = babyIds.length > 1 ? 'all' : babyIds[0] || null;
  renderBabyTargetSelect(patient.mother.id, preferredTarget);
  setActiveEncounterIds(null, appointment.id);
  setText('.wizard-header h1', 'Atendimento agendado');
  setEncounterChoice('appointmentType', appointment.appointment_type || 'Consulta inicial');
  setEncounterChoice('format', appointment.format || 'Domiciliar');
  const starts = document.querySelector('[data-encounter-field="startsAt"]'); if (starts) starts.value = localDateTimeInput(new Date(appointment.starts_at));
  const duration = document.querySelector('[data-encounter-field="durationMin"]'); if (duration && [...duration.options].some((option) => Number(option.value) === Number(appointment.duration_min))) duration.value = String(appointment.duration_min);
  const value = document.querySelector('[data-encounter-field="value"]'); if (value) value.value = String(Number(appointment.value_cents || 0) / 100);
  wizardStep = 1;
  renderWizard();
  navigate('appointment');
  toast('Agendamento carregado. Ao continuar, ele passa para “Em atendimento”.', 'success');
}
async function deleteScheduledAppointment(appointmentId) {
  const appointment = state.appointments.find((item) => item.id === appointmentId);
  if (!appointment) throw new Error('Agendamento não encontrado.');
  const ui = window.DeboraUI;
  if (!ui?.confirmTyped) throw new Error('Confirmação segura indisponível.');
  const ok = await ui.confirmTyped({
    title: 'Excluir agendamento?',
    message: `${appointmentPatientLabel(appointment)} · ${dateTimeLabel(appointment.starts_at)}. Somente este agendamento, ainda sem prontuário, será removido.`,
    expected: 'EXCLUIR',
    confirmLabel: 'Excluir agendamento',
    cancelLabel: 'Cancelar',
    danger: true
  });
  if (!ok) return;
  await appData.deleteScheduledAppointment(appointmentId, 'EXCLUIR');
  await refreshData();
  toast('Agendamento excluído.', 'success');
}
async function addWeight() {
  const patient = patientByMotherId(currentPatientId); if (!patient) return;
  const baby = babyById(patient, currentBabyId) || familyBabies(patient)[0]; if (!baby?.id) return;
  const value = Number(prompt(`Peso atual de ${baby.name} em gramas`, String(baby.current_weight_g || ''))); if (!value) return;
  await appData.addWeight({ baby_id: baby.id, weight_g: value, measured_at: new Date().toISOString() });
  await repositories.babies.update(baby.id, { current_weight_g: value });
  await refreshData(); await openPatient(patient.mother.id, { navigateRoute: false, babyId: baby.id }); toast('Peso registrado.', 'success');
}
async function createFollowup() {
  const patient = choosePatientPrompt(); if (!patient) return;
  const baby = chooseBabyTargetPrompt(patient, { allowAll: true }); if (baby === undefined) return;
  const due = prompt('Quando? (AAAA-MM-DDTHH:MM)', localDateTimeInput(new Date(Date.now() + 48 * 3600000))); if (!due) return;
  const notes = prompt('O que você quer verificar?', 'Como estão a dor e a pega?') || '';
  await appData.createFollowup({ mother_id: patient.mother.id, baby_id: baby?.id || null, due_at: new Date(due).toISOString(), notes: baby ? notes : `${notes} · ${babyNames(patient).join(' e ')}` });
  await refreshData(); toast('Follow-up criado.', 'success');
}
async function createFinancialEntry() {
  const patient = choosePatientPrompt(); if (!patient) return;
  const amount = Number((prompt('Valor em R$', '180') || '0').replace(',', '.')); if (!(amount >= 0)) return;
  const description = prompt('Descrição', 'Atendimento') || 'Atendimento';
  await appData.createFinancialEntry({ mother_id: patient.mother.id, description, amount_cents: Math.round(amount * 100), status: 'Pendente', due_at: new Date().toISOString().slice(0,10) });
  await refreshData(); toast('Lançamento criado.', 'success');
}
async function ensureConsent(motherId, type) {
  const consents = await appData.listConsents(motherId);
  return consents.some((c) => c.consent_type === type && c.granted && !c.revoked_at);
}
async function openWhatsApp(patient, message) {
  if (!patient) return;
  if (!(await ensureConsent(patient.mother.id, 'whatsapp'))) { toast('Contato por WhatsApp não está autorizado para esta paciente.', 'error'); return; }
  const phone = phoneForWhatsApp(patient.mother.phone); if (!phone) { toast('Paciente sem telefone cadastrado.', 'error'); return; }
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}
function currentPlanText() {
  const patient = selectedWizardPatient();
  const draft = collectEncounterDraft(appointmentScreen);
  return `Plano de cuidado - ${patient ? patientLabel(patient) : 'Paciente'}

Objetivos:
${draft.care_plan?.objectives || ''}

Orientações:
${draft.care_plan?.instructions || ''}

Próximo acompanhamento: ${draft.care_plan?.followup || 'a combinar'}`;
}
function pdfEncounterData() {
  const draft = collectEncounterDraft(appointmentScreen);
  const selectedBabies = selectedWizardBabies();
  const complaint = [...(draft.chief_complaint?.tags || []), draft.chief_complaint?.notes].filter(Boolean).join(' · ');
  const babySummaries = selectedBabies.map((baby) => {
    const a = draft.baby_assessment?.byBaby?.[baby.id] || {};
    const f = draft.feeding_assessment?.byBaby?.[baby.id] || {};
    const parts = [];
    if (a.weightG) parts.push(`Peso: ${a.weightG} g`);
    if (Array.isArray(a.observations) && a.observations.length) parts.push(a.observations.join(', '));
    if (f.position) parts.push(`Posição: ${f.position}`);
    if (f.latch) parts.push(`Pega: ${f.latch}`);
    if (Array.isArray(f.suckSwallow) && f.suckSwallow.length) parts.push(f.suckSwallow.join(', '));
    if (a.notes) parts.push(a.notes);
    if (f.notes) parts.push(f.notes);
    return { name: baby.name, details: parts.join(' · ') || 'Sem observações específicas.' };
  });
  return {
    occurredAt: draft.identification?.startsAt || new Date().toISOString(), complaint: complaint || 'Não informado',
    objectives: draft.care_plan?.objectives || '', instructions: draft.care_plan?.instructions || '', followup: draft.care_plan?.followup || 'A combinar', babySummaries
  };
}
async function printPlan() {
  const patient = selectedWizardPatient();
  const layout = normalizePdfLayout(document.querySelector('[data-pdf-layout-encounter]')?.value || selectedPdfLayout());
  const blob = createCarePlanPdf({ title: 'Débora Lactação', layout, patient: patient || {}, encounter: pdfEncounterData() });
  const filename = safePdfFilename(patient ? patientLabel(patient) : 'paciente');
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'application/pdf' }) : null;
  if (file && navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
    try {
      await navigator.share({ title: 'Plano de cuidado', text: 'Plano de cuidado em PDF', files: [file] });
      toast(`PDF ${layout} gerado.`, 'success');
      return;
    } catch (error) { if (error?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener';
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('PDF gerado. Abra em Downloads/Arquivos.', 'success');
}
async function exportBackupAction() {
  const passphrase = prompt('Crie uma senha para proteger este backup (mínimo 6 caracteres).'); if (!passphrase) return;
  const data = await backupService.exportAll();
  const envelope = await encryptBackup(data, passphrase);
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `debora-lactacao-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href);
  toast('Backup criptografado exportado.', 'success');
}
async function restoreBackupAction() {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; if (!file) return;
    try {
      const envelope = JSON.parse(await file.text());
      const passphrase = prompt('Senha do backup'); if (!passphrase) return;
      const backup = await decryptBackup(envelope, passphrase);
      if (!confirm('Restaurar os dados deste backup? Registros com o mesmo ID serão atualizados.')) return;
      await backupService.restoreAll(backup); await refreshData(); toast('Backup restaurado.', 'success');
    } catch (error) { reportError(error); }
  });
  input.click();
}

async function startApp() {
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
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!configured()) return;
  const data = new FormData(loginForm);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  if (config.ALLOWED_EMAIL && email.toLowerCase() !== String(config.ALLOWED_EMAIL).toLowerCase()) {
    loginMessage.textContent = 'Este acesso é exclusivo da profissional autorizada.'; loginMessage.className = 'form-message error'; return;
  }
  try {
    loginMessage.textContent = 'Conectando…'; loginMessage.className = 'form-message';
    await authService.signIn(email, password);
    loginMessage.textContent = '';
    await startApp();
  } catch (error) { loginMessage.textContent = error?.message || 'Não foi possível entrar.'; loginMessage.className = 'form-message error'; }
});


document.querySelector('[data-signup-action]')?.addEventListener('click', async () => {
  if (!configured()) return;
  const data = new FormData(loginForm);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  if (!email || !password) {
    loginMessage.textContent = 'Informe e-mail e uma senha para criar o primeiro acesso.';
    loginMessage.className = 'form-message error';
    return;
  }
  if (password.length < 8) {
    loginMessage.textContent = 'Use uma senha com pelo menos 8 caracteres.';
    loginMessage.className = 'form-message error';
    return;
  }
  if (config.ALLOWED_EMAIL && email.toLowerCase() !== String(config.ALLOWED_EMAIL).toLowerCase()) {
    loginMessage.textContent = 'Este acesso é exclusivo da profissional autorizada.';
    loginMessage.className = 'form-message error';
    return;
  }
  try {
    loginMessage.textContent = 'Criando acesso…';
    loginMessage.className = 'form-message';
    const result = await authService.signUp(email, password);
    if (result?.access_token) {
      loginMessage.textContent = '';
      await startApp();
    } else {
      loginMessage.textContent = 'Cadastro criado. Verifique o e-mail para confirmar a conta e depois toque em Entrar.';
      loginMessage.className = 'form-message success';
    }
  } catch (error) {
    loginMessage.textContent = error?.message || 'Não foi possível criar o acesso.';
    loginMessage.className = 'form-message error';
  }
});

document.querySelector('[data-clinical-media-input]')?.addEventListener('change', (event) => {
  pendingMediaFile = event.target.files?.[0] || null;
  if (pendingMediaFile) toast(`Arquivo selecionado: ${pendingMediaFile.name}`);
});


document.querySelector('[data-appointment-patient]')?.addEventListener('change', (event) => {
  if (currentDraftEncounterId) { setEncounterIdentityLock(true); return; }
  currentPatientId = event.target.value || null;
  renderBabyTargetSelect(currentPatientId);
});
document.querySelector('[data-appointment-baby]')?.addEventListener('change', () => {
  if (currentDraftEncounterId) { setEncounterIdentityLock(true); return; }
  renderBabyClinicalSections();
});
appointmentScreen?.addEventListener('input', scheduleEncounterAutosave);
appointmentScreen?.addEventListener('change', scheduleEncounterAutosave);
document.querySelector('[data-pdf-layout-default]')?.addEventListener('change', (event) => {
  const layout = normalizePdfLayout(event.target.value);
  localStorage.setItem(PDF_LAYOUT_KEY, layout);
  const encounterSelect = document.querySelector('[data-pdf-layout-encounter]'); if (encounterSelect) encounterSelect.value = layout;
  toast('Modelo padrão do PDF atualizado.', 'success');
});

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-nav-target]');
  if (nav) { event.preventDefault(); navigate(nav.dataset.navTarget); return; }
  const mobile = event.target.closest('[data-mobile-target]'); if (mobile) { navigate(mobile.dataset.mobileTarget); return; }
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) {
    const choice = event.target.closest('[data-encounter-choice],.choice,.tag-choice,.chip');
    if (choice && appointmentScreen?.contains(choice)) {
      const group = choice.parentElement;
      const multiple = choice.dataset.multiple === 'true' || choice.classList.contains('tag-choice') || choice.classList.contains('chip');
      if (!multiple) group?.querySelectorAll('[data-encounter-choice]').forEach((el) => { el.classList.remove('selected'); el.setAttribute('aria-pressed','false'); });
      const selected = multiple ? choice.getAttribute('aria-pressed') !== 'true' : true;
      choice.classList.toggle('selected', selected); choice.setAttribute('aria-pressed', String(selected));
    }
    if (event.target.closest('[data-wizard-close]')) navigate(previousScreen || 'home');
    if (event.target.closest('[data-wizard-next]')) {
      try {
        if (wizardStep < 7) {
          if (wizardStep === 1) await ensureEncounterStarted();
          else if (currentDraftEncounterId) await saveDraft({ silent: true });
          wizardStep += 1; renderWizard();
        } else await finalizeEncounter();
      } catch (error) { reportError(error); }
    }
    if (event.target.closest('[data-wizard-prev]')) { if (wizardStep > 1) { wizardStep -= 1; renderWizard(); } }
    return;
  }
  const action = actionEl.dataset.action;
  try {
    if (action === 'open-next-patient') {
      const next = nextAppointment();
      if (next?.mother_id) await openPatient(next.mother_id); else toast('Nenhum próximo atendimento agendado.');
    }
    else if (action === 'next-whatsapp') {
      const next = nextAppointment();
      if (!next) toast('Nenhum próximo atendimento agendado.');
      else await openWhatsApp(patientByMotherId(next.mother_id), `Olá! Passando para confirmar nosso atendimento de ${dateTimeLabel(next.starts_at)}.`);
    }
    else if (action === 'next-route') {
      const next = nextAppointment();
      const patient = next ? patientByMotherId(next.mother_id) : null;
      const address = next?.address || patient?.mother?.address || '';
      if (!address) toast('Este atendimento não possui endereço cadastrado.', 'error');
      else window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank', 'noopener');
    }
    else if (action === 'new-patient') await openPatientForm();
    else if (action === 'add-baby') { const root = document.querySelector('[data-babies-editor]'); const count = root?.querySelectorAll('[data-baby-editor]').length || 0; root?.insertAdjacentHTML('beforeend', babyEditorMarkup({}, count)); }
    else if (action === 'remove-baby-editor') { const card = actionEl.closest('[data-baby-editor]'); if (card && !card.dataset.babyId) card.remove(); }
    else if (action === 'select-baby') { currentBabyId = actionEl.dataset.babyId; await openPatient(currentPatientId, { navigateRoute: false, babyId: currentBabyId }); }
    else if (action === 'edit-patient') await openPatientForm(currentPatientId);
    else if (action === 'open-patient') await openPatient(actionEl.dataset.patientId || currentPatientId || state.patients[0]?.mother?.id);
    else if (action === 'open-encounter') await openEncounter(actionEl.dataset.encounterId);
    else if (action === 'open-clinical-note') await window.DeboraClinicalNote?.openEncounter?.(actionEl.dataset.encounterId);
    else if (action === 'agenda-select-date') { agendaSelectedDay = actionEl.dataset.agendaDate || clinicDayKey(new Date()); renderAgenda(); }
    else if (action === 'agenda-shift-week') { agendaSelectedDay = shiftDayKey(agendaSelectedDay || clinicDayKey(new Date()), Number(actionEl.dataset.days || 0)); renderAgenda(); }
    else if (action === 'start-scheduled-appointment') await openScheduledAppointment(actionEl.dataset.appointmentId);
    else if (action === 'delete-scheduled-appointment') await deleteScheduledAppointment(actionEl.dataset.appointmentId);
    else if (action === 'new-appointment') { previousScreen = activeScreen; resetWizard(activeScreen === 'patient' ? currentPatientId : null); navigate('appointment'); }
    else if (action === 'schedule-appointment') await scheduleAppointment();
    else if (action === 'save-draft') { await saveDraft(); navigate(previousScreen || 'home'); }
    else if (action === 'add-weight') await addWeight();
    else if (action === 'new-followup' || action === 'schedule-followup') await createFollowup();
    else if (action === 'complete-followup') { await appData.completeFollowup(actionEl.dataset.followupId); await refreshData(); }
    else if (action === 'followup-whatsapp') { const f = state.followups.find((x) => x.id === actionEl.dataset.followupId); await openWhatsApp(patientByMotherId(f?.mother_id), f?.notes || 'Olá! Como vocês estão hoje?'); }
    else if (action === 'new-finance') await createFinancialEntry();
    else if (action === 'mark-paid') { await appData.markFinancialPaid(actionEl.dataset.financeId, 'Pix'); await refreshData(); toast('Pagamento confirmado.', 'success'); }
    else if (action === 'undo-paid') {
      const finance = state.financial.find((item) => item.id === actionEl.dataset.financeId);
      if (!finance) throw new Error('Lançamento financeiro não encontrado.');
      if (!window.confirm(`Desfazer a confirmação de pagamento de ${currency(finance.amount_cents)}? O lançamento voltará para Pendente.`)) return;
      await appData.undoFinancialPaid(finance.id);
      await refreshData();
      toast('Pagamento desfeito. O lançamento voltou para Pendente.', 'success');
    }
    else if (action === 'finance-whatsapp') { const f = state.financial.find((x) => x.id === actionEl.dataset.financeId); await openWhatsApp(patientByMotherId(f?.mother_id), `Olá! Passando para lembrar do pagamento de ${currency(f?.amount_cents)} referente a ${f?.description || 'atendimento'}.`); }
    else if (action === 'print-plan') await printPlan();
    else if (action === 'share-whatsapp') await openWhatsApp(selectedWizardPatient(), currentPlanText());
    else if (action === 'backup-export') await exportBackupAction();
    else if (action === 'backup-restore') await restoreBackupAction();
    else if (action === 'logout') { await authService.signOut(); showLoggedOut(); }
  } catch (error) { reportError(error); }
});

window.DeboraEncounter={
  getEncounterId:()=>currentDraftEncounterId,
  getAppointmentId:()=>currentAppointmentId,
  ensureStarted:ensureEncounterStarted,
  flush:()=>currentDraftEncounterId?saveDraft({silent:true}):Promise.resolve(null)
};

window.addEventListener('hashchange', () => renderRoute().catch(reportError));
window.addEventListener('popstate', () => renderRoute().catch(reportError));

if (!configured()) {
  loginMessage.textContent = 'Configuração do banco pendente. O app ainda não deve receber dados reais.';
  loginMessage.className = 'form-message error';
} else {
  client = createSupabaseClient(config);
  authService = createAuthService(client);
  repositories = createRepositories(client);
  appData = createAppData(repositories);
  mediaService = createMediaService(client);
  backupService = createBackupService(client);
  if (authService.getSession()) startApp().catch(reportError); else showLoggedOut();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}
