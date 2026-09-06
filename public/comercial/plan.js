const runtime = window.SAAS_RUNTIME_CONFIG || {};
const supabaseUrl = String(runtime.supabaseUrl || '').replace(/\/$/, '');
const publishableKey = String(runtime.supabasePublishableKey || '');
const SESSION_KEY = 'commercial.saas.session.v1';

const authRequired = document.querySelector('#auth-required');
const content = document.querySelector('#plan-content');
const message = document.querySelector('#plan-message');
const logoutButton = document.querySelector('#logout-button');

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
  if (!response.ok) {
    throw new Error(payload?.message || payload?.msg || payload?.error || `Erro HTTP ${response.status}`);
  }
  return { payload, response };
}

async function loadPatientCount(ownerId, token) {
  const response = await fetch(`${supabaseUrl}/rest/v1/mothers?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      Prefer: 'count=exact',
    },
  });
  if (!response.ok) return null;
  const range = response.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total && total !== '*' ? Number(total) : null;
}

function entitlementMap(rows) {
  return Object.fromEntries((rows || []).map((item) => [item.feature_key, item]));
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

async function requestCheckout(planCode, token) {
  setMessage('Preparando solicitação de checkout…');
  const response = await fetch(`${supabaseUrl}/functions/v1/saas-checkout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: publishableKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ planCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Não foi possível preparar o checkout.');
  if (payload.checkoutUrl) {
    window.location.assign(payload.checkoutUrl);
    return;
  }
  setMessage('Solicitação registrada. O gateway de pagamento ainda não está conectado; sua conta continua no plano atual.', 'success');
}

async function init() {
  if (!supabaseUrl || !publishableKey) {
    setMessage('Configuração comercial indisponível.', 'error');
    showSignedOut();
    return;
  }

  const session = readSession();
  const token = session?.access_token;
  if (!token) {
    showSignedOut();
    return;
  }

  try {
    const { payload: user } = await api('/auth/v1/user', token);
    if (!user?.id) throw new Error('Sessão inválida.');

    const ownerId = user.id;
    const [accountsRes, profilesRes, entitlementsRes, subscriptionsRes, patientCount] = await Promise.all([
      api(`/rest/v1/saas_accounts?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,owner_id,account_type,status&limit=1`, token),
      api(`/rest/v1/professional_profiles?owner_id=eq.${encodeURIComponent(ownerId)}&select=professional_name,business_name,phone,settings&limit=1`, token),
      api(`/rest/v1/entitlements?owner_id=eq.${encodeURIComponent(ownerId)}&select=feature_key,enabled,limit_value,metadata`, token),
      api(`/rest/v1/subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&select=plan_code,status,current_period_end,provider&order=updated_at.desc&limit=1`, token),
      loadPatientCount(ownerId, token),
    ]);

    const account = accountsRes.payload?.[0] || null;
    if (!account) {
      showSignedOut();
      setMessage('Finalize o onboarding antes de consultar o plano.', 'error');
      return;
    }

    const profile = profilesRes.payload?.[0] || {};
    const entitlements = entitlementMap(entitlementsRes.payload);
    const subscription = subscriptionsRes.payload?.[0] || null;
    const mediaEnabled = entitlements.media_upload?.enabled === true;
    const patientLimit = entitlements.patient_limit?.limit_value;
    const isPro = mediaEnabled && patientLimit == null;

    showSignedIn();
    document.querySelector('#current-plan-badge').textContent = isPro ? 'Pro' : 'Freemium';
    document.querySelector('#current-plan-name').textContent = isPro ? 'Plano Pro' : 'Plano Freemium';
    document.querySelector('#current-plan-copy').textContent = isPro
      ? 'Uso ilimitado e upload de fotos e vídeos habilitado.'
      : 'Fluxo completo, até 3 mães/pacientes e sem upload de fotos e vídeos.';
    document.querySelector('#patient-usage').textContent = isPro
      ? `${patientCount ?? '—'} / ilimitado`
      : `${patientCount ?? '—'} / ${patientLimit ?? 3}`;
    document.querySelector('#media-access').textContent = mediaEnabled ? 'Habilitado' : 'Bloqueado';
    document.querySelector('#subscription-status').textContent = subscription?.status || (isPro ? 'Ativa' : 'Sem cobrança');
    document.querySelector('#account-email').textContent = user.email || 'Conta autenticada';
    document.querySelector('#account-name').textContent = profile.professional_name || profile.business_name || 'Perfil profissional';
    document.querySelector('#upgrade-section').hidden = isPro;

    document.querySelectorAll('[data-checkout]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await requestCheckout(button.dataset.checkout, token);
        } catch (error) {
          setMessage(error?.message || 'Não foi possível preparar o checkout.', 'error');
        } finally {
          button.disabled = false;
        }
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
