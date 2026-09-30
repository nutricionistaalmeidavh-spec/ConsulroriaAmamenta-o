const runtime = window.SAAS_RUNTIME_CONFIG || {};
const apiBaseUrl = String(runtime.apiBaseUrl || window.location.origin || '').replace(/\/$/, '');
const clientRuntimeKey = String(runtime.clientRuntimeKey || 'cloudflare-runtime');
const SESSION_KEY = 'commercial.saas.session.v1';
const REFERRAL_KEY = 'commercial.saas.partner-code.v1';
const REFERRAL_SOURCE_KEY = 'commercial.saas.partner-source.v1';

const authRequired = document.querySelector('#auth-required');
const content = document.querySelector('#plan-content');
const message = document.querySelector('#plan-message');
const logoutButton = document.querySelector('#logout-button');
const cancelRenewalButton = document.querySelector('#cancel-renewal-button');
const cancelSubscriptionDialog = document.querySelector('#cancel-subscription-dialog');
const confirmCancelRenewalButton = document.querySelector('#confirm-cancel-renewal');
const pageUrl = new URL(window.location.href);
let checkoutBusy = false;
let activationPending = false;
let cancellationBusy = false;
let subscriptionState = null;
let currentAccess = null;
let currentPatientCount = null;
let statusTimer;
let statusAttempts = 0;

function setCheckoutDisabled(disabled) {
  document.querySelectorAll('[data-checkout]').forEach((button) => { button.disabled = disabled; });
}

function httpError(payload, status) {
  const error = new Error(payload?.message || payload?.msg || payload?.error || `Erro HTTP ${status}`);
  error.status = status;
  return error;
}

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

function formatPlanDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

async function api(path, token, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: clientRuntimeKey,
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
  if (!response.ok) throw httpError(payload, response.status);
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
  if (!response.ok) throw httpError(payload, response.status);
  return payload;
}

async function loadPatientCount(ownerId, token) {
  const response = await fetch(`${apiBaseUrl}/rest/v1/mothers?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`, {
    headers: { apikey: clientRuntimeKey, Authorization: `Bearer ${token}`, Prefer: 'count=exact' },
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
  if (state === 'success') return ['Retorno do checkout recebido. Verificando pagamento e liberação do Pro…', ''];
  if (state === 'cancel') return ['Checkout cancelado. Seu plano atual não foi alterado.', ''];
  if (state === 'expired') return ['O checkout expirou. Você pode gerar um novo quando quiser.', ''];
  return null;
}

function paintSubscriptionManagement(state) {
  const box = document.querySelector('#subscription-management');
  const status = document.querySelector('#renewal-status');
  const copy = document.querySelector('#renewal-copy');
  const monthly = state?.planCode === 'pro_monthly' && state?.recurring === true;
  box.hidden = !monthly;
  cancelRenewalButton.hidden = true;
  if (!monthly) return;

  const end = formatPlanDate(state.currentPeriodEnd);
  if (state.cancelAtPeriodEnd) {
    status.textContent = state.expired ? 'Período encerrado' : 'Renovação cancelada';
    copy.textContent = state.expired
      ? 'O período pago terminou. Você pode contratar um novo plano quando quiser.'
      : `Seu acesso Pro continua disponível até ${end || 'o fim do período pago'}. Não haverá nova cobrança automática.`;
    return;
  }

  if (state.canCancel) {
    status.textContent = 'Renovação automática ativa';
    copy.textContent = end
      ? `O plano mensal renova automaticamente após o período atual, que termina em ${end}.`
      : 'O plano mensal está configurado para renovação automática.';
    cancelRenewalButton.hidden = false;
    return;
  }

  status.textContent = state.status === 'past_due' ? 'Cobrança pendente' : 'Renovação indisponível';
  copy.textContent = 'Não foi possível disponibilizar o gerenciamento da renovação neste estado da assinatura.';
}

async function requestCheckout(planCode, token) {
  if (checkoutBusy || activationPending) return;
  checkoutBusy = true;
  setCheckoutDisabled(true);
  try {
    const state = await workerApi('/api/asaas/status', token);
    if (handlePurchaseState(state)) return;
    if (state?.status !== 'none') throw new Error('Não foi possível confirmar o estado da compra. Tente novamente em instantes.');
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
    if (handlePurchaseState(payload)) return;
    if (!payload.checkoutUrl) throw new Error('O Asaas não retornou o link do checkout.');
    window.location.assign(payload.checkoutUrl);
  } finally {
    checkoutBusy = false;
    setCheckoutDisabled(activationPending);
  }
}

function handlePurchaseState(state, patientCount = null) {
  if (state?.status === 'active') {
    activationPending = false;
    if (state.access) {
      currentAccess = state.access;
      paintAccess(state.access, patientCount);
    }
    document.querySelector('#upgrade-section').hidden = true;
    setMessage('Seu acesso Pro está liberado.', 'success');
    return true;
  }
  if (state?.status === 'activation_pending') {
    activationPending = true;
    setCheckoutDisabled(true);
    setMessage('Pagamento aprovado. Estamos finalizando a liberação do Pro. Não faça outro pagamento. Recarregue esta página para consultar novamente.');
    return true;
  }
  if (state?.status === 'awaiting_payment') {
    if (state.checkoutUrl) window.location.assign(state.checkoutUrl);
    else {
      activationPending = true;
      setMessage('Sua compra está em processamento. Não faça outro pagamento. Recarregue esta página para consultar novamente.');
    }
    return true;
  }
  return false;
}

async function refreshPurchaseStatus(token, patientCount) {
  clearTimeout(statusTimer);
  try {
    const state = await workerApi('/api/asaas/status', token);
    if (state.status === 'active') {
      const [access, billing] = await Promise.all([
        state.access ? Promise.resolve(state.access) : workerApi('/api/license/me', token),
        workerApi('/api/asaas/subscription', token).catch(() => null),
      ]);
      subscriptionState = billing;
      currentAccess = access;
      paintSubscriptionManagement(subscriptionState);
      handlePurchaseState({ ...state, access }, patientCount);
      return;
    }
    if (state.status === 'activation_pending') handlePurchaseState(state);
    else {
      activationPending = false;
      setMessage(state.status === 'awaiting_payment'
        ? 'Aguardando confirmação do pagamento. Não é necessário iniciar outra compra.'
        : 'Nenhum pagamento confirmado até o momento.');
    }
    setCheckoutDisabled(activationPending);
    if (++statusAttempts < 12) statusTimer = setTimeout(() => refreshPurchaseStatus(token, patientCount), 5000);
  } catch (error) {
    setMessage('Não foi possível atualizar seu plano. Recarregue a página para tentar novamente. Sua compra não será repetida.', 'error');
  }
}

function paintAccess(access, patientCount, billing = subscriptionState) {
  const legacy = access?.commercial === false;
  const isPro = access?.commercial === true && access?.active === true && String(access?.planCode || '').startsWith('pro_');
  const patientLimit = Number.isInteger(access?.patientLimit) ? access.patientLimit : null;
  const cancellationEnd = billing?.cancelAtPeriodEnd ? formatPlanDate(billing.currentPeriodEnd) : null;

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
    : isPro && cancellationEnd
      ? `Ativa até ${cancellationEnd} · sem renovação`
      : isPro
        ? (access.planCode === 'pro_6m' ? 'Ativa · 6 meses' : 'Ativa')
        : 'Sem Pro ativo';
  document.querySelector('#upgrade-section').hidden = legacy || isPro;
}

function cancellationErrorMessage(error) {
  const messages = {
    subscription_not_found: 'Nenhuma assinatura mensal foi encontrada nesta conta.',
    subscription_not_recurring: 'Este plano não possui renovação automática para cancelar.',
    subscription_period_unknown: 'Não foi possível confirmar até quando o período atual está pago. O cancelamento não foi realizado.',
    subscription_not_cancellable: 'A renovação não pode ser cancelada no estado atual da assinatura.',
    subscription_change_in_progress: 'Já existe uma atualização da assinatura em andamento. Tente novamente em instantes.',
    asaas_subscription_delete_failed: 'Não foi possível cancelar a renovação no provedor de pagamento. Nenhuma alteração local foi aplicada.',
  };
  return messages[error?.message] || 'Não foi possível cancelar a renovação agora. Sua assinatura atual não foi alterada.';
}

function openCancellationDialog() {
  if (!subscriptionState?.canCancel || cancellationBusy) return;
  const end = formatPlanDate(subscriptionState.currentPeriodEnd);
  document.querySelector('#cancel-subscription-copy').textContent = end
    ? `A renovação automática será encerrada agora. Seu acesso ao Plano Pro continuará normalmente até ${end}, que já está pago. Depois dessa data, não haverá uma nova cobrança automática.`
    : 'A renovação automática será encerrada. O período já pago continuará disponível até o vencimento.';
  cancelSubscriptionDialog.showModal();
}

async function cancelRenewal(token) {
  if (cancellationBusy || !subscriptionState?.canCancel) return;
  cancellationBusy = true;
  confirmCancelRenewalButton.disabled = true;
  cancelRenewalButton.disabled = true;
  try {
    const state = await workerApi('/api/asaas/subscription/cancel', token, { method: 'POST' });
    subscriptionState = state;
    paintSubscriptionManagement(state);
    paintAccess(currentAccess, currentPatientCount, state);
    cancelSubscriptionDialog.close();
    const end = formatPlanDate(state.currentPeriodEnd);
    setMessage(
      end
        ? `Renovação cancelada. Seu acesso Pro continua ativo até ${end}.`
        : 'Renovação cancelada. Seu período já pago continua ativo até o vencimento.',
      'success',
    );
  } catch (error) {
    setMessage(cancellationErrorMessage(error), 'error');
  } finally {
    cancellationBusy = false;
    confirmCancelRenewalButton.disabled = false;
    cancelRenewalButton.disabled = !subscriptionState?.canCancel;
  }
}

async function init() {
  if (!apiBaseUrl || !clientRuntimeKey) {
    setMessage('Configuração comercial indisponível.', 'error');
    showSignedOut();
    return;
  }

  const session = readSession();
  const token = session?.access_token;
  if (!token) { showSignedOut(); return; }

  try {
    const { payload: user } = await api('/auth/v1/user', token);
    if (!user?.id) throw httpError({ message: 'Sessão inválida.' }, 401);
    const [profilesRes, patientCount, access, billing] = await Promise.all([
      api(`/rest/v1/professional_profiles?owner_id=eq.${encodeURIComponent(user.id)}&select=professional_name,business_name,phone,settings&limit=1`, token),
      loadPatientCount(user.id, token),
      workerApi('/api/license/me', token),
      workerApi('/api/asaas/subscription', token).catch(() => null),
    ]);
    const profile = profilesRes.payload?.[0] || {};
    currentAccess = access;
    currentPatientCount = patientCount;
    subscriptionState = billing;

    showSignedIn();
    paintAccess(access, patientCount, billing);
    paintSubscriptionManagement(billing);
    ensurePartnerCodeField();
    document.querySelector('#account-email').textContent = user.email || 'Conta autenticada';
    document.querySelector('#account-name').textContent = profile.professional_name || profile.business_name || 'Perfil profissional';

    const returned = checkoutReturnMessage();
    if (returned) setMessage(returned[0], returned[1]);
    if (pageUrl.searchParams.get('asaas') === 'success') {
      activationPending = true;
      setCheckoutDisabled(true);
      await refreshPurchaseStatus(token, patientCount);
    }

    document.querySelectorAll('[data-checkout]').forEach((button) => {
      button.addEventListener('click', async () => {
        try { await requestCheckout(button.dataset.checkout, token); }
        catch (error) { setMessage(error?.message || 'Não foi possível preparar o checkout.', 'error'); }
      });
    });

    cancelRenewalButton.addEventListener('click', openCancellationDialog);
    confirmCancelRenewalButton.addEventListener('click', () => cancelRenewal(token));
  } catch (error) {
    if (error?.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      showSignedOut();
    } else {
      document.querySelector('#upgrade-section').hidden = true;
    }
    setMessage(error?.message || 'Sua sessão expirou. Entre novamente.', 'error');
  }
}

logoutButton.addEventListener('click', () => {
  sessionStorage.removeItem(SESSION_KEY);
  window.location.assign('./index.html');
});

init();
