const SESSION_KEY = 'artisysSeoGoogleSession';
const SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const OAUTH_REDIRECT = `${window.location.origin}/admin/seo/`;

const authPanel = document.querySelector('#authPanel');
const googleLoginButton = document.querySelector('#googleLoginButton');
const authError = document.querySelector('#authError');
const dashboard = document.querySelector('#dashboard');
const refreshButton = document.querySelector('#refreshButton');
const statusText = document.querySelector('#statusText');
const periodLabel = document.querySelector('#periodLabel');

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
  statusText.textContent = 'Dados atualizados do Search Console';
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.accessToken ? parsed : null;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function consumeOAuthCallback() {
  if (!window.location.hash) return;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  const expiresIn = Number(params.get('expires_in') || 3600);
  const errorDescription = params.get('error_description');

  if (accessToken) {
    saveSession({
      accessToken,
      refreshToken: refreshToken || '',
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    });
    history.replaceState({}, document.title, OAUTH_REDIRECT);
    return;
  }

  if (errorDescription) {
    authError.textContent = decodeURIComponent(errorDescription.replaceAll('+', ' '));
    history.replaceState({}, document.title, OAUTH_REDIRECT);
  }
}

async function refreshSessionIfNeeded(session) {
  if (!session?.accessToken) return null;
  if (!session.expiresAt || session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!response.ok) return null;

  const payload = await response.json();
  return saveSession({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  });
}

function startGoogleLogin() {
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', OAUTH_REDIRECT);
  window.location.assign(url.toString());
}

async function loadDashboard() {
  let session = readSession();
  if (session) {
    try {
      session = await refreshSessionIfNeeded(session);
    } catch {
      session = null;
    }
  }

  if (!session?.accessToken) {
    clearSession();
    authPanel.hidden = false;
    dashboard.hidden = true;
    refreshButton.hidden = true;
    return;
  }

  authError.textContent = '';
  statusText.textContent = 'Carregando…';
  refreshButton.disabled = true;

  try {
    const response = await fetch('/api/seo/google/overview', {
      headers: { authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      clearSession();
      throw new Error('Esta conta Google não tem permissão para acessar o painel SEO.');
    }
    if (!response.ok) throw new Error(payload.error || `Falha HTTP ${response.status}`);
    render(payload);
    authPanel.hidden = true;
    dashboard.hidden = false;
    refreshButton.hidden = false;
  } catch (error) {
    authPanel.hidden = false;
    dashboard.hidden = true;
    refreshButton.hidden = true;
    authError.textContent = error.message || 'Não foi possível carregar o painel.';
  } finally {
    refreshButton.disabled = false;
  }
}

googleLoginButton.addEventListener('click', startGoogleLogin);
refreshButton.addEventListener('click', loadDashboard);
consumeOAuthCallback();
loadDashboard();
