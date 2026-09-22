const SESSION_KEY = 'commercial.saas.session.v1';
const message = document.querySelector('#admin-message');
const form = document.querySelector('#partner-form');
const list = document.querySelector('#partner-list');
const salesBody = document.querySelector('#sales-body');
const salesFilter = document.querySelector('#sales-partner-filter');
let partners = [];

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function token() { return readSession()?.access_token || ''; }
function money(cents) { return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(cents || 0) / 100); }
function setMessage(text = '', tone = '') { message.textContent = text; message.className = `message${tone ? ` ${tone}` : ''}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

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
      <div><strong>${escapeHtml(partner.name)}</strong><small>${escapeHtml(partner.code)} · ${partner.active ? 'ativo' : 'inativo'} · comissão ${escapeHtml(partner.commission_type)} ${escapeHtml(partner.commission_value)}</small></div>
      <button class="button secondary small" type="button" data-edit-partner="${escapeHtml(partner.id)}">Editar</button>
    </div>`).join('');
  list.querySelectorAll('[data-edit-partner]').forEach((button) => {
    button.addEventListener('click', () => editPartner(button.dataset.editPartner));
  });
}

function renderPartnerFilter() {
  const current = salesFilter.value;
  salesFilter.innerHTML = '<option value="">Todos</option>' + partners.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.code)}</option>`).join('');
  if ([...salesFilter.options].some((option) => option.value === current)) salesFilter.value = current;
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
  form.elements.active.checked = partner.active !== false;
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
  document.querySelector('#metric-sales').textContent = String(summary.paidSales || 0);
  document.querySelector('#metric-revenue').textContent = money(summary.revenueCents);
  document.querySelector('#metric-pending').textContent = money(summary.pendingCommissionCents);
  document.querySelector('#metric-approved').textContent = money(summary.approvedCommissionCents);
  const sales = Array.isArray(payload.sales) ? payload.sales : [];
  if (!sales.length) {
    salesBody.innerHTML = '<tr><td colspan="7">Nenhuma venda atribuída neste filtro.</td></tr>';
    return;
  }
  salesBody.innerHTML = sales.map((sale) => {
    const partnerName = sale.partners?.name || sale.partner_code_snapshot || '—';
    const approve = sale.status === 'paid' && sale.commission_status === 'pending'
      ? `<button class="button small" type="button" data-approve="${escapeHtml(sale.id)}">Aprovar</button>` : '—';
    return `<tr>
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

async function loadSales() {
  const query = salesFilter.value ? `?partnerId=${encodeURIComponent(salesFilter.value)}` : '';
  renderSales(await api(`/api/admin/partner-sales${query}`));
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
salesFilter.addEventListener('change', () => loadSales().catch((error) => setMessage(error.message, 'error')));
reloadAll();
