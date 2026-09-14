const GOOGLE_LOGIN_CLIENT_ID = '826322917381-ia1khl7es1gqddv6jsmg8p75m7amfle5.apps.googleusercontent.com';
const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client';

const authPanel = document.querySelector('#authPanel');
const googleLoginButton = document.querySelector('#googleLoginButton');
const authError = document.querySelector('#authError');
const dashboard = document.querySelector('#dashboard');
const refreshButton = document.querySelector('#refreshButton');
const statusText = document.querySelector('#statusText');
const periodLabel = document.querySelector('#periodLabel');

let googleScriptPromise = null;
let tokenClient = null;

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

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GOOGLE_GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Não foi possível carregar o login Google.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = GOOGLE_GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Não foi possível carregar o login Google.'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

async function createSeoSession(accessToken) {
  const response = await fetch('/api/seo/google/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({ accessToken }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error === 'forbidden'
      ? 'Esta conta Google não tem permissão para acessar o painel SEO.'
      : payload.error === 'google_identity_invalid'
        ? 'O Google não confirmou esta identidade para o painel SEO.'
        : 'Não foi possível concluir o login Google.';
    throw new Error(message);
  }
}

async function startGoogleLogin() {
  authError.textContent = '';
  googleLoginButton.disabled = true;
  googleLoginButton.textContent = 'Abrindo Google…';

  try {
    await loadGoogleIdentityServices();
    if (!window.google?.accounts?.oauth2) throw new Error('Login Google indisponível neste navegador.');

    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_LOGIN_CLIENT_ID,
        scope: 'openid email profile',
        callback: async (response) => {
          try {
            if (response?.error) throw new Error(response.error_description || response.error);
            if (!response?.access_token) throw new Error('O Google não retornou uma credencial válida.');
            googleLoginButton.textContent = 'Concluindo acesso…';
            await createSeoSession(response.access_token);
            await loadDashboard();
          } catch (error) {
            authError.textContent = error.message || 'Não foi possível concluir o login Google.';
          } finally {
            googleLoginButton.disabled = false;
            googleLoginButton.textContent = 'Entrar com Google';
          }
        },
        error_callback: () => {
          authError.textContent = 'O login Google foi cancelado ou bloqueado pelo navegador.';
          googleLoginButton.disabled = false;
          googleLoginButton.textContent = 'Entrar com Google';
        },
      });
    }

    tokenClient.requestAccessToken({ prompt: 'select_account' });
  } catch (error) {
    authError.textContent = error.message || 'Não foi possível abrir o login Google.';
    googleLoginButton.disabled = false;
    googleLoginButton.textContent = 'Entrar com Google';
  }
}

async function loadDashboard() {
  authError.textContent = '';
  statusText.textContent = 'Carregando…';
  refreshButton.disabled = true;

  try {
    const response = await fetch('/api/seo/google/overview', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      authPanel.hidden = false;
      dashboard.hidden = true;
      refreshButton.hidden = true;
      statusText.textContent = 'Acesso administrativo necessário';
      return;
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
loadDashboard();
