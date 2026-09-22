const SESSION_KEY = 'commercial.saas.session.v1';
const message = document.querySelector('#admin-message');
const form = document.querySelector('#partner-form');
const list = document.querySelector('#partner-list');
const salesBody = document.querySelector('#sales-body');
const filters = {
  partnerId: document.querySelector('#sales-partner-filter'),
  plan: document.querySelector('#sales-plan-filter'),
  status: document.querySelector('#sales-status-filter'),
  commissionStatus: document.querySelector('#sales-commission-filter'),
  from: document.querySelector('#sales-from-filter'),
  to: document.querySelector('#sales-to-filter'),
};
let partners = [];
let currentSales = [];

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function token() { return readSession()?.access_token || ''; }
function money(cents) { return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(cents || 0) / 100); }
function setMessage(text = '', tone = '') { message.textContent = text; message.className = `message${tone ? ` ${tone}` : ''}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function displayDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(date);
}

async function api(path, options = {}) {
  const accessToken = token();
  if (!accessToken) throw new Error('Entre na sua conta antes de acessar o painel de parceiros.');
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const messages = {
      partner_admin_forbidden: 'Sua conta não possui permissão de administrador de parceiros.',
      partner_admin_not_configured: 'O backend de parceiros ainda não foi configurado no ambiente.',
      partner_code_conflict: 'Já existe um parceiro com esse código.',
      commission_approval_failed: 'A comissão não está pendente ou a venda ainda não foi confirmada.',
      invalid_date_filter: 'Revise o período informado.',
      invalid_plan_filter: 'Plano de filtro inválido.',
      invalid_status_filter: 'Status de venda inválido.',
      invalid_commission_status_filter: 'Status de comissão inválido.',
    };
    throw new Error(messages[payload?.error] || payload?.message || payload?.error || `Erro HTTP ${response.status}`);
  }
  return payload;
}

function renderPartnerList() {
  if (!partners.length) {
    list.innerHTML = '<p class="muted">Nenhum parceiro cadastrado.</p>';
    return;
  }
  list.innerHTML = partners.map((partner) => `
    <div class="partner-item">
      <div><strong>${escapeHtml(partner.name)}</strong><small>${escapeHtml(partner.code)} · ${Number(partner.active) === 1 || partner.active === true ? 'ativo' : 'inativo'} · comissão ${escapeHtml(partner.commission_type)} ${escapeHtml(partner.commission_value)}</small></div>
      <button class="button secondary small" type="button" data-edit-partner="${escapeHtml(partner.id)}">Editar</button>
    </div>`).join('');
  list.querySelectorAll('[data-edit-partner]').forEach((button) => {
    button.addEventListener('click', () => editPartner(button.dataset.editPartner));
  });
}

function renderPartnerFilter() {
  const current = filters.partnerId.value;
  filters.partnerId.innerHTML = '<option value="">Todos</option>' + partners.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.code)}</option>`).join('');
  if ([...filters.partnerId.options].some((option) => option.value === current)) filters.partnerId.value = current;
}

function resetForm() {
  form.reset();
  form.elements.id.value = '';
  form.elements.active.checked = true;
  form.elements.commissionValue.value = '0';
  form.elements.discountValue.value = '0';
  document.querySelector('#partner-form-title').textContent = 'Novo parceiro';
}

function editPartner(id) {
  const partner = partners.find((item) => item.id === id);
  if (!partner) return;
  form.elements.id.value = partner.id;
  form.elements.name.value = partner.name || '';
  form.elements.code.value = partner.code || '';
  form.elements.partnerType.value = partner.partner_type || 'partner';
  form.elements.commissionType.value = partner.commission_type || 'none';
  form.elements.commissionValue.value = partner.commission_value ?? 0;
  form.elements.discountType.value = partner.discount_type || 'none';
  form.elements.discountValue.value = partner.discount_value ?? 0;
  form.elements.active.checked = Number(partner.active) === 1 || partner.active === true;
  document.querySelector('#partner-form-title').textContent = `Editar ${partner.name}`;
  form.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function loadPartners() {
  const payload = await api('/api/admin/partners');
  partners = Array.isArray(payload.partners) ? payload.partners : [];
  renderPartnerList();
  renderPartnerFilter();
}

function renderSales(payload) {
  const summary = payload.summary || {};
  currentSales = Array.isArray(payload.sales) ? payload.sales : [];
  const discountCents = summary.discountCents ?? currentSales.reduce((sum, sale) => sum + Number(sale.discount_cents || 0), 0);
  document.querySelector('#metric-sales').textContent = String(summary.paidSales || 0);
  document.querySelector('#metric-revenue').textContent = money(summary.revenueCents);
  document.querySelector('#metric-discounts').textContent = money(discountCents);
  document.querySelector('#metric-pending').textContent = money(summary.pendingCommissionCents);
  document.querySelector('#metric-approved').textContent = money(summary.approvedCommissionCents);
  if (!currentSales.length) {
    salesBody.innerHTML = '<tr><td colspan="8">Nenhuma venda atribuída neste filtro.</td></tr>';
    return;
  }
  salesBody.innerHTML = currentSales.map((sale) => {
    const partnerName = sale.partners?.name || sale.partner_code_snapshot || '—';
    const approve = sale.status === 'paid' && sale.commission_status === 'pending'
      ? `<button class="button small" type="button" data-approve="${escapeHtml(sale.id)}">Aprovar</button>` : '—';
    return `<tr>
      <td>${escapeHtml(displayDate(sale.created_at))}</td>
      <td><strong>${escapeHtml(partnerName)}</strong><br><small>${escapeHtml(sale.partner_code_snapshot || '')}</small></td>
      <td>${escapeHtml(sale.plan_code)}</td>
      <td><span class="status">${escapeHtml(sale.status)}</span><br><small>${escapeHtml(sale.commission_status)}</small></td>
      <td>${money(sale.total_cents)}</td>
      <td>${money(sale.discount_cents)}</td>
      <td>${money(sale.commission_cents)}</td>
      <td>${approve}</td>
    </tr>`;
  }).join('');
  salesBody.querySelectorAll('[data-approve]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await api('/api/admin/partner-commission', { method:'POST', body:JSON.stringify({ attributionId: button.dataset.approve }) });
        setMessage('Comissão aprovada.', 'success');
        await loadSales();
      } catch (error) { setMessage(error.message, 'error'); }
      finally { button.disabled = false; }
    });
  });
}

function salesQuery() {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, element]) => {
    const value = String(element?.value || '').trim();
    if (!value) return;
    if (key === 'from') params.set(key, `${value}T00:00:00.000Z`);
    else if (key === 'to') params.set(key, `${value}T23:59:59.999Z`);
    else params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function loadSales() {
  renderSales(await api(`/api/admin/partner-sales${salesQuery()}`));
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function exportSalesCsv() {
  if (!currentSales.length) {
    setMessage('Não há vendas no filtro atual para exportar.', 'error');
    return;
  }
  const headers = ['Data','Parceiro','Código','Origem','Plano','Status da venda','Status da comissão','Subtotal','Desconto','Total','Comissão'];
  const rows = currentSales.map((sale) => [
    displayDate(sale.created_at),
    sale.partners?.name || '',
    sale.partner_code_snapshot || '',
    sale.attribution_source || '',
    sale.plan_code || '',
    sale.status || '',
    sale.commission_status || '',
    (Number(sale.subtotal_cents || 0) / 100).toFixed(2),
    (Number(sale.discount_cents || 0) / 100).toFixed(2),
    (Number(sale.total_cents || 0) / 100).toFixed(2),
    (Number(sale.commission_cents || 0) / 100).toFixed(2),
  ]);
  const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `parceiros-vendas-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setMessage('CSV exportado com o filtro atual.', 'success');
}

async function reloadAll() {
  setMessage('Atualizando…');
  try {
    await loadPartners();
    await loadSales();
    setMessage('Dados atualizados.', 'success');
  } catch (error) { setMessage(error.message, 'error'); }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api('/api/admin/partners', {
      method:'POST',
      body:JSON.stringify({
        id: String(data.get('id') || ''),
        name: String(data.get('name') || '').trim(),
        code: String(data.get('code') || '').trim().toUpperCase(),
        partnerType: String(data.get('partnerType') || 'partner'),
        commissionType: String(data.get('commissionType') || 'none'),
        commissionValue: Number(data.get('commissionValue') || 0),
        discountType: String(data.get('discountType') || 'none'),
        discountValue: Number(data.get('discountValue') || 0),
        active: data.get('active') === 'on',
      }),
    });
    resetForm();
    setMessage('Parceiro salvo.', 'success');
    await loadPartners();
    await loadSales();
  } catch (error) { setMessage(error.message, 'error'); }
  finally { submit.disabled = false; }
});

document.querySelector('#partner-reset').addEventListener('click', resetForm);
document.querySelector('#reload').addEventListener('click', reloadAll);
document.querySelector('#export-sales').addEventListener('click', exportSalesCsv);
Object.values(filters).forEach((filter) => {
  filter.addEventListener('change', () => loadSales().catch((error) => setMessage(error.message, 'error')));
});
reloadAll();
