const authPanel = document.querySelector('#authPanel');
const loginForm = document.querySelector('#loginForm');
const loginButton = document.querySelector('#loginButton');
const authError = document.querySelector('#authError');
const dashboard = document.querySelector('#dashboard');
const refreshButton = document.querySelector('#refreshButton');
const statusText = document.querySelector('#statusText');
const periodLabel = document.querySelector('#periodLabel');
const seoContext = document.querySelector('#seoContext');
const siteSelect = document.querySelector('#siteSelect');
const pagePrefix = document.querySelector('#pagePrefix');
const applyScopeButton = document.querySelector('#applyScopeButton');
const scopeLabel = document.querySelector('#scopeLabel');
const scopeHelp = document.querySelector('#scopeHelp');

const requestedContext = new URLSearchParams(window.location.search).get('context') || '';
const scopeState = { contexts: [], sites: [], initialized: false };

function number(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function percent(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 }).format(Number(value || 0));
}

function decimal(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderRows(targetId, rows, keyName) {
  const target = document.querySelector(targetId);
  target.innerHTML = rows.length
    ? rows.map((row) => `<tr><td title="${escapeHtml(row[keyName])}">${escapeHtml(row[keyName])}</td><td>${number(row.clicks)}</td><td>${number(row.impressions)}</td><td>${percent(row.ctr)}</td><td>${decimal(row.position)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Sem dados no período.</td></tr>';
}

function renderAudit(audit) {
  const opportunities = Array.isArray(audit?.opportunities) ? audit.opportunities : [];
  document.querySelector('#auditCount').textContent = String(opportunities.length);
  const list = document.querySelector('#auditList');
  list.innerHTML = opportunities.length
    ? opportunities.map((item) => `
      <article class="audit-item">
        <div><span class="pill ${item.priority === 'high' ? 'danger' : ''}">${escapeHtml(item.label || item.type)}</span></div>
        <h3>${escapeHtml(item.title || item.query || item.page || 'Oportunidade')}</h3>
        <p>${escapeHtml(item.recommendation || '')}</p>
        <small>${item.impressions !== undefined ? `${number(item.impressions)} impressões · ` : ''}${item.ctr !== undefined ? `CTR ${percent(item.ctr)} · ` : ''}${item.position !== undefined ? `posição ${decimal(item.position)}` : ''}</small>
      </article>`).join('')
    : '<p class="empty">Nenhuma oportunidade prioritária foi detectada neste recorte.</p>';
}

function render(data) {
  const search = data.googleSearch;
  document.querySelector('#metricClicks').textContent = number(search.metrics.clicks);
  document.querySelector('#metricImpressions').textContent = number(search.metrics.impressions);
  document.querySelector('#metricCtr').textContent = percent(search.metrics.ctr);
  document.querySelector('#metricPosition').textContent = decimal(search.metrics.position);
  renderRows('#queriesBody', search.topQueries || [], 'query');
  renderRows('#pagesBody', search.topPages || [], 'page');
  renderAudit(data.audit);
  periodLabel.textContent = `${search.period.startDate} → ${search.period.endDate}`;
  scopeLabel.textContent = `${data.scope?.label || 'Search Console'} · ${data.scope?.siteUrl || search.siteUrl}`;
  statusText.textContent = 'Dados atualizados do Search Console';
}

function option(value, label, disabled = false) {
  const node = document.createElement('option');
  node.value = value;
  node.textContent = label;
  node.disabled = disabled;
  return node;
}

function populateScopeControls(payload) {
  scopeState.contexts = Array.isArray(payload.contexts) ? payload.contexts : [];
  scopeState.sites = Array.isArray(payload.sites) ? payload.sites : [];

  seoContext.replaceChildren();
  for (const context of scopeState.contexts) {
    seoContext.appendChild(option(context.id, context.label, context.available === false));
  }
  seoContext.appendChild(option('custom-domain', 'Domínio / propriedade inteira'));
  seoContext.appendChild(option('custom-store', 'Loja / URL específica'));

  siteSelect.replaceChildren();
  for (const site of scopeState.sites) {
    siteSelect.appendChild(option(site.siteUrl, site.siteUrl));
  }

  const requested = scopeState.contexts.find((item) => item.id === requestedContext && item.available !== false);
  const fallback = scopeState.contexts.find((item) => item.available !== false);
  seoContext.value = requested?.id || fallback?.id || 'custom-domain';
  syncScopeInputs();
  scopeState.initialized = true;
}

function selectedContextDefinition() {
  return scopeState.contexts.find((item) => item.id === seoContext.value) || null;
}

function syncScopeInputs() {
  const context = selectedContextDefinition();
  if (context) {
    siteSelect.value = context.siteUrl;
    siteSelect.disabled = true;
    pagePrefix.value = context.pagePrefix || '';
    pagePrefix.disabled = true;
    scopeHelp.textContent = context.pagePrefix
      ? `Métricas filtradas para ${context.pagePrefix}`
      : `Métricas da propriedade ${context.siteUrl}.`;
    return;
  }
  siteSelect.disabled = false;
  const storeMode = seoContext.value === 'custom-store';
  pagePrefix.disabled = !storeMode;
  if (!storeMode) pagePrefix.value = '';
  scopeHelp.textContent = storeMode
    ? 'Informe a URL HTTPS da vitrine para separar as métricas desta loja.'
    : 'Mostra todas as métricas da propriedade selecionada.';
}

function overviewUrl() {
  const url = new URL('/api/seo/google/overview', window.location.origin);
  const context = selectedContextDefinition();
  if (context) {
    url.searchParams.set('context', context.id);
  } else {
    if (!siteSelect.value) throw new Error('Selecione uma propriedade do Search Console.');
    url.searchParams.set('siteUrl', siteSelect.value);
    if (seoContext.value === 'custom-store') {
      const prefix = pagePrefix.value.trim();
      if (!prefix) throw new Error('Informe a URL da loja que deseja acompanhar.');
      url.searchParams.set('pagePrefix', prefix);
    }
  }
  return url;
}

function updateAddressBar() {
  const context = selectedContextDefinition();
  const url = new URL(window.location.href);
  if (context) url.searchParams.set('context', context.id);
  else url.searchParams.delete('context');
  window.history.replaceState(null, '', url);
}

async function fetchJson(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function showLogin() {
  authPanel.hidden = false;
  dashboard.hidden = true;
  refreshButton.hidden = true;
  statusText.textContent = 'Acesso administrativo necessário';
}

async function login(event) {
  event.preventDefault();
  authError.textContent = '';
  loginButton.disabled = true;
  loginButton.textContent = 'Entrando…';

  const data = new FormData(loginForm);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');

  try {
    const response = await fetch('/api/seo/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ email, password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) throw new Error('E-mail ou senha inválidos.');
      throw new Error(payload.error || 'Não foi possível entrar no painel SEO.');
    }
    loginForm.reset();
    document.querySelector('#email').value = 'nutricionistaalmeidavh@gmail.com';
    scopeState.initialized = false;
    await loadDashboard();
  } catch (error) {
    authError.textContent = error.message || 'Não foi possível entrar no painel SEO.';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
}

async function ensureScopes() {
  if (scopeState.initialized) return true;
  const { response, payload } = await fetchJson('/api/seo/google/sites');
  if (response.status === 401 || response.status === 403) {
    showLogin();
    return false;
  }
  if (!response.ok) throw new Error(payload.error || `Falha HTTP ${response.status}`);
  populateScopeControls(payload);
  return true;
}

async function loadDashboard() {
  authError.textContent = '';
  statusText.textContent = 'Carregando…';
  refreshButton.disabled = true;
  applyScopeButton.disabled = true;

  try {
    if (!await ensureScopes()) return;
    const { response, payload } = await fetchJson(overviewUrl());
    if (response.status === 401 || response.status === 403 && payload.error === 'unauthorized') {
      showLogin();
      return;
    }
    if (!response.ok) {
      if (payload.error === 'seo_site_not_allowed') throw new Error('A propriedade selecionada ainda não está liberada para a conta conectada no Search Console.');
      throw new Error(payload.error || `Falha HTTP ${response.status}`);
    }
    render(payload);
    updateAddressBar();
    authPanel.hidden = true;
    dashboard.hidden = false;
    refreshButton.hidden = false;
  } catch (error) {
    dashboard.hidden = false;
    refreshButton.hidden = false;
    authError.textContent = error.message || 'Não foi possível carregar o painel.';
    statusText.textContent = 'Falha ao atualizar';
  } finally {
    refreshButton.disabled = false;
    applyScopeButton.disabled = false;
  }
}

seoContext.addEventListener('change', syncScopeInputs);
loginForm.addEventListener('submit', login);
refreshButton.addEventListener('click', loadDashboard);
applyScopeButton.addEventListener('click', loadDashboard);
loadDashboard();
