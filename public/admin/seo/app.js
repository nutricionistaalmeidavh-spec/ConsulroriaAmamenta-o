const authPanel = document.querySelector('#authPanel');
const professionalLoginButton = document.querySelector('#professionalLoginButton');
const authError = document.querySelector('#authError');
const dashboard = document.querySelector('#dashboard');
const refreshButton = document.querySelector('#refreshButton');
const statusText = document.querySelector('#statusText');
const periodLabel = document.querySelector('#periodLabel');

const PROFESSIONAL_SESSION_KEYS = [
  'debora-runtime-access-token',
  'amamentacao-session',
  'debora-lactacao-session',
];

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

function tokenFromStoredValue(raw) {
  if (!raw) return '';
  if (raw.split('.').length === 3) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.access_token?.split('.').length === 3) return parsed.access_token;
    if (parsed?.session?.access_token?.split('.').length === 3) return parsed.session.access_token;
  } catch {
    return '';
  }
  return '';
}

function professionalAccessToken() {
  const runtime = window.__deboraAccessToken;
  if (runtime?.split('.').length === 3) return runtime;
  for (const key of PROFESSIONAL_SESSION_KEYS) {
    const token = tokenFromStoredValue(sessionStorage.getItem(key));
    if (token) return token;
  }
  return '';
}

function openProfessionalLogin() {
  sessionStorage.setItem('debora-seo-return-to', '/admin/seo/');
  window.location.assign('/app/');
}

async function loadDashboard() {
  authError.textContent = '';
  statusText.textContent = 'Carregando…';
  refreshButton.disabled = true;

  const token = professionalAccessToken();
  if (!token) {
    authPanel.hidden = false;
    dashboard.hidden = true;
    refreshButton.hidden = true;
    statusText.textContent = 'Acesso profissional necessário';
    refreshButton.disabled = false;
    return;
  }

  try {
    const response = await fetch('/api/seo/google/overview', {
      headers: { authorization: `Bearer ${token}` },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      authPanel.hidden = false;
      dashboard.hidden = true;
      refreshButton.hidden = true;
      statusText.textContent = 'Acesso administrativo necessário';
      authError.textContent = response.status === 403
        ? 'Esta sessão profissional não pertence à conta autorizada do SEO.'
        : 'Sua sessão profissional expirou. Entre novamente no sistema.';
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

professionalLoginButton.addEventListener('click', openProfessionalLogin);
refreshButton.addEventListener('click', loadDashboard);
window.addEventListener('pageshow', loadDashboard);
loadDashboard();
