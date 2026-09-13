const ARTISYS_OWNER_SSO = 'https://obra-na-mao-comercial.nutricionistaalmeidavh.workers.dev/api/artisys-sso/start?target=debora-seo';

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

function startGoogleLogin() {
  window.location.assign(ARTISYS_OWNER_SSO);
}

async function consumeSsoCallback() {
  if (!window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const code = params.get('artisys_sso_code');
  if (!code) return false;

  history.replaceState({}, document.title, `${window.location.origin}/admin/seo/`);
  authError.textContent = '';
  googleLoginButton.disabled = true;
  googleLoginButton.textContent = 'Concluindo acesso…';
  try {
    const response = await fetch('/api/seo/google/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ code }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir o login Google.');
    return true;
  } catch (error) {
    authError.textContent = error.message || 'Não foi possível concluir o login Google.';
    return false;
  } finally {
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
await consumeSsoCallback();
loadDashboard();
