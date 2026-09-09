const FAH_SB_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const FAH_SB_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COMPARISON_FIELDS = [
  { key: 'position', label: 'Posição' },
  { key: 'latch', label: 'Pega' },
  { key: 'suckSwallow', label: 'Sucção e deglutição' }
];

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function cleanText(value) {
  return String(value ?? '').trim();
}

function cleanList(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  const text = cleanText(value);
  return text ? [text] : [];
}

export function normalizeFeedingAssessment(value) {
  const source = asObject(value);
  const normalized = {
    position: cleanText(source.position),
    latch: cleanText(source.latch),
    suckSwallow: cleanList(source.suckSwallow),
    notes: cleanText(source.notes)
  };
  if (!normalized.position && !normalized.latch && !normalized.suckSwallow.length && !normalized.notes) return null;
  return normalized;
}

export function extractEncounterFeeding(encounter = {}, linkedBabyIds = []) {
  const raw = asObject(encounter.feeding_assessment);
  const byBaby = asObject(raw.byBaby);
  const structured = Object.entries(byBaby)
    .map(([babyId, value]) => ({ babyId, assessment: normalizeFeedingAssessment(value), legacyUnassigned: false }))
    .filter((row) => row.assessment);

  if (structured.length) return structured;

  const legacy = normalizeFeedingAssessment(raw);
  if (!legacy) return [];

  const links = [...new Set([encounter.baby_id, ...linkedBabyIds].filter(Boolean))];
  if (encounter.baby_id) return [{ babyId: encounter.baby_id, assessment: legacy, legacyUnassigned: false }];
  if (links.length === 1) return [{ babyId: links[0], assessment: legacy, legacyUnassigned: false }];
  return [{ babyId: null, assessment: legacy, legacyUnassigned: true }];
}

function encounterTime(encounter) {
  const value = encounter?.occurred_at || encounter?.created_at || '';
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? stamp : 0;
}

function appointmentType(encounter) {
  const identification = asObject(encounter?.identification);
  return cleanText(identification.appointmentType) || 'Atendimento';
}

export function buildFeedingHistory(encounters = [], linksByEncounter = {}) {
  const ordered = [...encounters].sort((a, b) => encounterTime(a) - encounterTime(b));
  const history = [];
  for (const encounter of ordered) {
    const links = Array.isArray(linksByEncounter?.[encounter.id]) ? linksByEncounter[encounter.id] : [];
    for (const row of extractEncounterFeeding(encounter, links)) {
      history.push({
        encounterId: encounter.id,
        babyId: row.babyId,
        legacyUnassigned: row.legacyUnassigned,
        occurredAt: encounter.occurred_at || encounter.created_at || '',
        appointmentType: appointmentType(encounter),
        assessment: row.assessment
      });
    }
  }
  return history;
}

function comparisonValue(key, value) {
  if (key === 'suckSwallow') {
    const items = cleanList(value);
    return items.length ? items.join(' · ') : 'Não registrado';
  }
  return cleanText(value) || 'Não registrado';
}

function normalizedType(value) {
  return cleanText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function buildFeedingComparison(history = [], currentEncounterId, babyId, mode = 'previous') {
  const rows = history
    .filter((row) => row.babyId === babyId)
    .sort((a, b) => {
      const aTime = Date.parse(a.occurredAt || '') || 0;
      const bTime = Date.parse(b.occurredAt || '') || 0;
      return aTime - bTime;
    });
  const currentIndex = rows.findIndex((row) => row.encounterId === currentEncounterId);
  if (currentIndex <= 0) return null;

  let baseline = null;
  if (mode === 'initial') {
    baseline = rows.slice(0, currentIndex).find((row) => normalizedType(row.appointmentType) === 'consulta inicial') || null;
  } else {
    baseline = rows[currentIndex - 1] || null;
  }
  const current = rows[currentIndex] || null;
  if (!baseline || !current) return null;

  const fields = COMPARISON_FIELDS.map(({ key, label }) => {
    const before = comparisonValue(key, baseline.assessment?.[key]);
    const after = comparisonValue(key, current.assessment?.[key]);
    return { key, label, before, after, changed: before !== after };
  });

  return { baseline, current, fields };
}

const browser = typeof window !== 'undefined' && typeof document !== 'undefined';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

function tokenWalk(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return tokenWalk(JSON.parse(value)); } catch { return value.split('.').length === 3 ? value : null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const token = tokenWalk(item);
      if (token) return token;
    }
  }
  if (typeof value === 'object') {
    if (value.access_token) return value.access_token;
    if (value.session?.access_token) return value.session.access_token;
    for (const item of Object.values(value)) {
      const token = tokenWalk(item);
      if (token) return token;
    }
  }
  return null;
}

function browserToken() {
  if (!browser) return null;
  const runtime = window.__deboraAccessToken || sessionStorage.getItem('debora-runtime-access-token');
  if (runtime?.split('.').length === 3) return runtime;
  for (const store of [localStorage, sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) {
      const token = tokenWalk(store.getItem(store.key(index)));
      if (token?.split('.').length === 3) return token;
    }
  }
  return null;
}

async function rest(path) {
  const token = browserToken();
  if (!token) throw new Error('Sessão profissional não encontrada.');
  const response = await fetch(`${FAH_SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey: FAH_SB_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const payload = await response.json();
      message = payload.message || payload.error_description || payload.error || message;
    } catch {}
    throw new Error(message);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function dateLabel(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function babyName(babyId, babiesById) {
  if (!babyId) return 'Avaliação geral do atendimento';
  return babiesById.get(babyId)?.name || 'Bebê';
}

function assessmentValue(assessment, key) {
  if (key === 'suckSwallow') return cleanList(assessment?.[key]).join(' · ') || 'Não registrado';
  return cleanText(assessment?.[key]) || 'Não registrado';
}

function currentAssessmentHtml(rows, babiesById) {
  const cards = rows.length
    ? rows.map((row) => `<article class="fah-assessment-card">
        <div class="fah-card-head"><strong>${escapeHtml(babyName(row.babyId, babiesById))}</strong>${row.legacyUnassigned ? '<span>registro legado sem bebê identificado</span>' : ''}</div>
        <dl class="fah-assessment-grid">
          <div><dt>Posição</dt><dd>${escapeHtml(assessmentValue(row.assessment, 'position'))}</dd></div>
          <div><dt>Pega</dt><dd>${escapeHtml(assessmentValue(row.assessment, 'latch'))}</dd></div>
          <div class="fah-wide"><dt>Sucção e deglutição</dt><dd>${escapeHtml(assessmentValue(row.assessment, 'suckSwallow'))}</dd></div>
          <div class="fah-wide"><dt>Observações</dt><dd>${escapeHtml(assessmentValue(row.assessment, 'notes'))}</dd></div>
        </dl>
      </article>`).join('')
    : '<div class="fah-empty">Avaliação da mamada não registrada neste atendimento.</div>';

  return `<section class="fah-current" data-fah-current>
    <div class="fah-section-head"><div><small>AVALIAÇÃO ESTRUTURADA</small><h3>Avaliação da mamada</h3></div><span>Somente leitura</span></div>
    <div class="fah-assessment-list">${cards}</div>
  </section>`;
}

function historyRowHtml(row, babiesById, currentEncounterId) {
  return `<article class="fah-history-row${row.encounterId === currentEncounterId ? ' is-current' : ''}">
    <div class="fah-history-meta"><strong>${escapeHtml(row.appointmentType)}</strong><small>${escapeHtml(dateLabel(row.occurredAt, true))}</small>${row.encounterId === currentEncounterId ? '<span>Atual</span>' : ''}</div>
    <div><small>Posição</small><strong>${escapeHtml(assessmentValue(row.assessment, 'position'))}</strong></div>
    <div><small>Pega</small><strong>${escapeHtml(assessmentValue(row.assessment, 'latch'))}</strong></div>
    <div class="fah-history-suck"><small>Sucção e deglutição</small><strong>${escapeHtml(assessmentValue(row.assessment, 'suckSwallow'))}</strong></div>
    ${row.assessment?.notes ? `<p>${escapeHtml(row.assessment.notes)}</p>` : ''}
  </article>`;
}

function comparisonHtml(comparison, label) {
  if (!comparison) return '';
  return `<details class="fah-comparison">
    <summary>${escapeHtml(label)}</summary>
    <div class="fah-comparison-meta">Base: ${escapeHtml(comparison.baseline.appointmentType)} · ${escapeHtml(dateLabel(comparison.baseline.occurredAt))}</div>
    <div class="fah-comparison-table" role="table" aria-label="${escapeHtml(label)}">
      <div class="fah-comparison-row fah-comparison-header" role="row"><span>Item</span><span>Base</span><span>Atual</span></div>
      ${comparison.fields.map((field) => `<div class="fah-comparison-row${field.changed ? ' is-changed' : ''}" role="row">
        <strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.before)}</span><span>${escapeHtml(field.after)}</span>
      </div>`).join('')}
    </div>
  </details>`;
}

function historyHtml({ history, current, linksByEncounter, babiesById }) {
  const currentRows = extractEncounterFeeding(current, linksByEncounter[current.id] || []);
  const currentBabyIds = [...new Set([
    current.baby_id,
    ...(linksByEncounter[current.id] || []),
    ...currentRows.map((row) => row.babyId)
  ].filter(Boolean))];

  const relevant = history.filter((row) => !row.babyId || !currentBabyIds.length || currentBabyIds.includes(row.babyId));
  if (!relevant.length) {
    return `<section class="fah-history" data-fah-history>
      <div class="fah-section-head"><div><small>EVOLUÇÃO</small><h3>Histórico da mamada</h3></div><span>0 registros</span></div>
      <div class="fah-empty">Nenhuma avaliação de mamada registrada no histórico.</div>
    </section>`;
  }

  const groupIds = [...new Set(relevant.map((row) => row.babyId ?? '__legacy__'))];
  const groups = groupIds.map((groupId) => {
    const babyId = groupId === '__legacy__' ? null : groupId;
    const rows = relevant.filter((row) => (row.babyId ?? '__legacy__') === groupId);
    const previous = babyId ? buildFeedingComparison(history, current.id, babyId, 'previous') : null;
    const initial = babyId ? buildFeedingComparison(history, current.id, babyId, 'initial') : null;
    const comparisons = [
      comparisonHtml(previous, 'Comparar com atendimento anterior'),
      comparisonHtml(initial, 'Comparar com consulta inicial')
    ].filter(Boolean).join('');
    return `<div class="fah-history-group">
      <div class="fah-group-title"><strong>${escapeHtml(babyName(babyId, babiesById))}</strong><span>${rows.length} ${rows.length === 1 ? 'avaliação' : 'avaliações'}</span></div>
      <div class="fah-history-list">${rows.map((row) => historyRowHtml(row, babiesById, current.id)).join('')}</div>
      ${comparisons ? `<div class="fah-comparisons">${comparisons}</div>` : ''}
    </div>`;
  }).join('');

  return `<section class="fah-history" data-fah-history>
    <div class="fah-section-head"><div><small>EVOLUÇÃO</small><h3>Histórico da mamada</h3></div><span>${relevant.length} ${relevant.length === 1 ? 'registro' : 'registros'}</span></div>
    ${groups}
  </section>`;
}

async function loadClinicalBundle(encounterId) {
  const currentRows = await rest(`clinical_encounters?id=eq.${encodeURIComponent(encounterId)}&select=id,mother_id,baby_id,status,identification,feeding_assessment,occurred_at,created_at&limit=1`);
  const current = currentRows?.[0];
  if (!current) throw new Error('Atendimento não encontrado ou sem permissão.');

  const [encounters, allLinks, babies] = await Promise.all([
    rest(`clinical_encounters?mother_id=eq.${encodeURIComponent(current.mother_id)}&select=id,mother_id,baby_id,status,identification,feeding_assessment,occurred_at,created_at&order=occurred_at.asc&limit=200`).catch(() => [current]),
    rest('clinical_encounter_babies?select=encounter_id,baby_id,is_primary&order=created_at.asc').catch(() => []),
    rest(`babies?mother_id=eq.${encodeURIComponent(current.mother_id)}&select=id,name&order=created_at.asc`).catch(() => [])
  ]);

  const encounterIds = new Set((encounters || []).map((item) => item.id));
  const linksByEncounter = {};
  for (const link of allLinks || []) {
    if (!encounterIds.has(link.encounter_id)) continue;
    linksByEncounter[link.encounter_id] ||= [];
    if (!linksByEncounter[link.encounter_id].includes(link.baby_id)) linksByEncounter[link.encounter_id].push(link.baby_id);
  }

  const babiesById = new Map((babies || []).map((baby) => [baby.id, baby]));
  return {
    current,
    linksByEncounter,
    babiesById,
    history: buildFeedingHistory(encounters || [current], linksByEncounter)
  };
}

const browserState = {
  lastEncounterId: '',
  mounting: false,
  mountTimer: null,
  wrappedApi: null
};

function activeWizardEncounterId() {
  const screen = document.querySelector('[data-screen="appointment"]:not([hidden])');
  const id = screen?.dataset.encounterId || '';
  return UUID_RE.test(id) ? id : '';
}

function capturedEncounterId() {
  const active = activeWizardEncounterId();
  if (active) return active;
  return UUID_RE.test(browserState.lastEncounterId) ? browserState.lastEncounterId : '';
}

function captureEncounterId(value) {
  const id = cleanText(value);
  if (UUID_RE.test(id)) browserState.lastEncounterId = id;
}

function wrapClinicalNoteApi() {
  const api = window.DeboraClinicalNote;
  if (!api || api === browserState.wrappedApi) return;
  for (const method of ['open', 'openEncounter']) {
    const original = api[method];
    if (typeof original !== 'function' || original.__fahWrapped) continue;
    const wrapped = async function (...args) {
      if (method === 'openEncounter') captureEncounterId(args[0]);
      else captureEncounterId(args[0]?.encounterId || args[0]?.encounter?.id);
      try {
        return await original.apply(this, args);
      } finally {
        queueMount();
      }
    };
    wrapped.__fahWrapped = true;
    api[method] = wrapped;
  }
  browserState.wrappedApi = api;
}

function ensureStyles() {
  if (document.querySelector('link[data-fah-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/feeding-assessment-history-feature.css';
  link.dataset.fahStyles = '1';
  document.head.appendChild(link);
}

function renderLoading(overlay) {
  const body = overlay.querySelector('.cn-body');
  if (!body || body.querySelector('[data-fah-loading]')) return;
  const loading = document.createElement('section');
  loading.dataset.fahLoading = '1';
  loading.className = 'fah-current fah-loading';
  loading.innerHTML = '<div class="fah-section-head"><div><small>AVALIAÇÃO ESTRUTURADA</small><h3>Avaliação da mamada</h3></div><span>Carregando…</span></div>';
  body.querySelector('.cn-editor-head')?.before(loading);
}

function renderError(overlay) {
  const loading = overlay.querySelector('[data-fah-loading]');
  if (loading) {
    loading.classList.remove('fah-loading');
    loading.dataset.fahCurrent = '1';
    delete loading.dataset.fahLoading;
    loading.innerHTML = '<div class="fah-section-head"><div><small>AVALIAÇÃO ESTRUTURADA</small><h3>Avaliação da mamada</h3></div><span>Somente leitura</span></div><div class="fah-empty">Não foi possível carregar os dados estruturados deste atendimento. O prontuário textual permanece disponível normalmente.</div>';
  }
}

async function mountOverlay() {
  if (browserState.mounting) return;
  const overlay = document.querySelector('#cn-overlay');
  if (!overlay) return;
  const encounterId = capturedEncounterId();
  if (!encounterId) return;
  if (overlay.dataset.fahEncounterId === encounterId && overlay.querySelector('[data-fah-current]')) return;

  browserState.mounting = true;
  renderLoading(overlay);
  try {
    const bundle = await loadClinicalBundle(encounterId);
    if (!overlay.isConnected) return;
    overlay.querySelectorAll('[data-fah-current],[data-fah-history],[data-fah-loading]').forEach((node) => node.remove());
    const body = overlay.querySelector('.cn-body');
    if (!body) return;

    const currentHost = document.createElement('div');
    currentHost.innerHTML = currentAssessmentHtml(extractEncounterFeeding(bundle.current, bundle.linksByEncounter[bundle.current.id] || []), bundle.babiesById);
    const currentSection = currentHost.firstElementChild;
    body.querySelector('.cn-editor-head')?.before(currentSection);

    const historyHost = document.createElement('div');
    historyHost.innerHTML = historyHtml(bundle);
    const historySection = historyHost.firstElementChild;
    const author = body.querySelector('.cn-author');
    if (author) author.insertAdjacentElement('afterend', historySection);
    else body.appendChild(historySection);

    overlay.dataset.fahEncounterId = encounterId;
  } catch (error) {
    console.warn('Histórico da mamada indisponível', error);
    if (overlay.isConnected) renderError(overlay);
  } finally {
    browserState.mounting = false;
  }
}

function queueMount() {
  clearTimeout(browserState.mountTimer);
  browserState.mountTimer = setTimeout(() => {
    wrapClinicalNoteApi();
    mountOverlay();
  }, 40);
}

function bootBrowserFeature() {
  ensureStyles();
  document.addEventListener('click', (event) => {
    const target = event.target.closest?.('[data-pf-encounter],[data-encounter-id]');
    if (target) captureEncounterId(target.dataset.pfEncounter || target.dataset.encounterId);
  }, true);
  new MutationObserver(queueMount).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', queueMount);
  queueMount();
}

if (browser) bootBrowserFeature();
