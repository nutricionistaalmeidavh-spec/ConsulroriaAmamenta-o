const runtime = window.SAAS_RUNTIME_CONFIG || {};
const supabaseUrl = String(runtime.supabaseUrl || '').replace(/\/$/, '');
const publishableKey = String(runtime.supabasePublishableKey || '');
const SESSION_KEY = 'commercial.saas.session.v1';
const REFERRAL_KEY = 'commercial.saas.partner-code.v1';
const REFERRAL_SOURCE_KEY = 'commercial.saas.partner-source.v1';

const authRequired = document.querySelector('#auth-required');
const content = document.querySelector('#plan-content');
const message = document.querySelector('#plan-message');
const logoutButton = document.querySelector('#logout-button');
const pageUrl = new URL(window.location.href);

function normalizePartnerCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 64);
}

function rememberPartnerCode(code, source = 'manual_code') {
  const normalized = normalizePartnerCode(code);
  if (!normalized) {
    sessionStorage.removeItem(REFERRAL_KEY);
    sessionStorage.removeItem(REFERRAL_SOURCE_KEY);
    return '';
  }
  sessionStorage.setItem(REFERRAL_KEY, normalized);
  sessionStorage.setItem(REFERRAL_SOURCE_KEY, source === 'ref_link' ? 'ref_link' : 'manual_code');
  return normalized;
}

const requestedReferral = normalizePartnerCode(pageUrl.searchParams.get('ref'));
if (requestedReferral) rememberPartnerCode(requestedReferral, 'ref_link');

function currentPartnerCode() {
  return normalizePartnerCode(sessionStorage.getItem(REFERRAL_KEY) || '');
}

function currentAttributionSource() {
  return sessionStorage.getItem(REFERRAL_SOURCE_KEY) === 'ref_link' ? 'ref_link' : 'manual_code';
}

function ensurePartnerCodeField() {
  const section = document.querySelector('#upgrade-section');
  if (!section || section.querySelector('input[name="partnerCode"]')) return;
  const box = document.createElement('div');
  box.className = 'partner-code-box';
  const label = document.createElement('label');
  label.textContent = 'Cupom ou código do parceiro';
  const input = document.createElement('input');
  input.type = 'text';
  input.name = 'partnerCode';
  input.maxLength = 64;
  input.autocomplete = 'off';
  input.placeholder = 'Opcional';
  input.value = currentPartnerCode();
  input.addEventListener('change', () => rememberPartnerCode(input.value, 'manual_code'));
  label.appendChild(input);
  const help = document.createElement('small');
  help.textContent = 'Use o código de quem indicou você. Se houver desconto configurado, ele será calculado no servidor antes do Asaas.';
  box.append(label, help);
  section.querySelector('.section-heading')?.after(box);
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function setMessage(text = '', tone = '') {
  message.textContent = text;
  message.className = `plan-message${tone ? ` ${tone}` : ''}`;
}

async function api(path, token, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) throw new Error(payload?.message || payload?.msg || payload?.error || `Erro HTTP ${response.status}`);
  return { payload, response };
}

async function workerApi(path, token, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Erro HTTP ${response.status}`);
  return payload;
}

async function loadPatientCount(ownerId, token) {
  const response = await fetch(`${supabaseUrl}/rest/v1/mothers?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
  });
  if (!response.ok) return null;
  const total = (response.headers.get('content-range') || '').split('/')[1];
  return total && total !== '*' ? Number(total) : null;
}

function showSignedOut() {
  authRequired.hidden = false;
  content.hidden = true;
  logoutButton.hidden = true;
}
function showSignedIn() {
  authRequired.hidden = true;
  content.hidden = false;
  logoutButton.hidden = false;
}

function checkoutReturnMessage() {
  const state = new URL(window.location.href).searchParams.get('asaas');
  if (state === 'success') return ['Checkout concluído. A liberação do Pro ocorre após a confirmação recebida pelo webhook do Asaas.', 'success'];
  if (state === 'cancel') return ['Checkout cancelado. Seu plano atual não foi alterado.', ''];
  if (state === 'expired') return ['O checkout expirou. Você pode gerar um novo quando quiser.', ''];
  return null;
}

async function requestCheckout(planCode, token) {
  setMessage('Preparando checkout seguro no Asaas…');
  const input = document.querySelector('#upgrade-section input[name="partnerCode"]');
  const typedCode = normalizePartnerCode(input?.value || '');
  const existingCode = currentPartnerCode();
  const attributionSource = typedCode && typedCode === existingCode ? currentAttributionSource() : 'manual_code';
  const partnerCode = typedCode ? rememberPartnerCode(typedCode, attributionSource) : rememberPartnerCode('', 'manual_code');
  const response = await fetch('/api/asaas/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ planCode, partnerCode, attributionSource }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errors = {
      invalid_partner_code: 'Cupom ou código do parceiro inválido ou inativo.',
      partner_lookup_failed: 'Não foi possível validar o código do parceiro agora.',
    };
    throw new Error(errors[payload?.error] || payload?.details?.[0]?.description || payload?.message || payload?.error || 'Não foi possível preparar o checkout.');
  }
  if (!payload.checkoutUrl) throw new Error('O Asaas não retornou o link do checkout.');
  window.location.assign(payload.checkoutUrl);
}

function paintAccess(access, patientCount) {
  const legacy = access?.commercial === false;
  const isPro = access?.commercial === true && access?.active === true && String(access?.planCode || '').startsWith('pro_');
  const patientLimit = Number.isInteger(access?.patientLimit) ? access.patientLimit : null;

  document.querySelector('#current-plan-badge').textContent = legacy ? 'Existente' : isPro ? 'Pro' : 'Freemium';
  document.querySelector('#current-plan-name').textContent = legacy
    ? 'Conta clínica existente'
    : isPro
      ? (access.planCode === 'pro_6m' ? 'Plano Pro · 6 meses' : 'Plano Pro')
      : 'Plano Freemium';
  document.querySelector('#current-plan-copy').textContent = legacy
    ? 'Operação clínica preservada, fora das regras comerciais do SaaS.'
    : isPro
      ? 'Uso ilimitado e upload de fotos e vídeos habilitado.'
      : 'Fluxo completo, até 3 mães/pacientes e sem upload de fotos e vídeos.';
  document.querySelector('#patient-usage').textContent = `${patientCount ?? '—'} / ${legacy || isPro ? 'ilimitado' : (patientLimit ?? 3)}`;
  document.querySelector('#media-access').textContent = legacy || access?.mediaUpload ? 'Habilitado' : 'Bloqueado';
  document.querySelector('#subscription-status').textContent = legacy
    ? 'Fora do SaaS comercial'
    : isPro
      ? (access.planCode === 'pro_6m' ? 'Ativa · 6 meses' : 'Ativa')
      : 'Sem Pro ativo';
  document.querySelector('#upgrade-section').hidden = legacy || isPro;
}

async function init() {
  if (!supabaseUrl || !publishableKey) {
    setMessage('Configuração comercial indisponível.', 'error');
    showSignedOut();
    return;
  }

  const session = readSession();
  const token = session?.access_token;
  if (!token) { showSignedOut(); return; }

  try {
    const { payload: user } = await api('/auth/v1/user', token);
    if (!user?.id) throw new Error('Sessão inválida.');
    const [profilesRes, patientCount, access] = await Promise.all([
      api(`/rest/v1/professional_profiles?owner_id=eq.${encodeURIComponent(user.id)}&select=professional_name,business_name,phone,settings&limit=1`, token),
      loadPatientCount(user.id, token),
      workerApi('/api/license/me', token),
    ]);
    const profile = profilesRes.payload?.[0] || {};

    showSignedIn();
    paintAccess(access, patientCount);
    ensurePartnerCodeField();
    document.querySelector('#account-email').textContent = user.email || 'Conta autenticada';
    document.querySelector('#account-name').textContent = profile.professional_name || profile.business_name || 'Perfil profissional';

    const returned = checkoutReturnMessage();
    if (returned) setMessage(returned[0], returned[1]);

    document.querySelectorAll('[data-checkout]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await requestCheckout(button.dataset.checkout, token); }
        catch (error) { setMessage(error?.message || 'Não foi possível preparar o checkout.', 'error'); }
        finally { button.disabled = false; }
      });
    });
  } catch (error) {
    sessionStorage.removeItem(SESSION_KEY);
    showSignedOut();
    setMessage(error?.message || 'Sua sessão expirou. Entre novamente.', 'error');
  }
}

logoutButton.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.assign('./index.html');
});

init();
