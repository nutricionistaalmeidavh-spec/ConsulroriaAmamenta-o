const authPanel = document.querySelector('#authPanel');
const loginForm = document.querySelector('#loginForm');
const loginButton = document.querySelector('#loginButton');
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
    await loadDashboard();
  } catch (error) {
    authError.textContent = error.message || 'Não foi possível entrar no painel SEO.';
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
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

loginForm.addEventListener('submit', login);
refreshButton.addEventListener('click', loadDashboard);
loadDashboard();
