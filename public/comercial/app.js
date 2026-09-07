const runtime = window.SAAS_RUNTIME_CONFIG || {};
const supabaseUrl = String(runtime.supabaseUrl || '').replace(/\/$/, '');
const publishableKey = String(runtime.supabasePublishableKey || '');

const API = Object.freeze({
  signup: '/auth/v1/signup',
  login: '/auth/v1/token?grant_type=password',
  user: '/auth/v1/user',
  accounts: '/rest/v1/saas_accounts',
  profiles: '/rest/v1/professional_profiles',
});

const SESSION_KEY = 'commercial.saas.session.v1';
const PLAN_KEY = 'commercial.saas.plan-intent.v1';
const RETURN_KEY = 'commercial.saas.return.v1';
const PENDING_SIGNUP_KEY = 'commercial.saas.pending-signup.v2';
const CHECKOUT_AFTER_LOGIN_KEY = 'commercial.saas.checkout-after-login.v1';
const modal = document.querySelector('#auth-modal');
const message = document.querySelector('#form-message');
const planIntent = document.querySelector('#plan-intent');
const signupSubmit = document.querySelector('#signup-form [type="submit"]');
const pageUrl = new URL(window.location.href);

const requestedReturn = pageUrl.searchParams.get('return');
const requestedPlan = pageUrl.searchParams.get('plan');
if (requestedReturn === 'sandbox') sessionStorage.setItem(RETURN_KEY, 'sandbox');
if (['freemium', 'pro_monthly', 'pro_annual'].includes(requestedPlan)) {
  sessionStorage.setItem(PLAN_KEY, requestedPlan);
}

let previousFocus = null;
let currentSession = readSession();
let currentUser = currentSession?.user || null;
let selectedPlan = sessionStorage.getItem(PLAN_KEY) || 'freemium';
let returnContext = sessionStorage.getItem(RETURN_KEY) || '';

class ApiError extends Error {
  constructor(messageText, status, payload) {
    super(messageText);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
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

function saveSession(session) {
  currentSession = session;
  currentUser = session?.user || null;
  if (session?.access_token) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  currentSession = null;
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function captureAuthCallbackSession() {
  if (!window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = params.get('access_token');
  if (!accessToken) return false;

  saveSession({
    access_token: accessToken,
    refresh_token: params.get('refresh_token') || '',
    token_type: params.get('token_type') || 'bearer',
    expires_in: Number(params.get('expires_in') || 0),
    user: null,
  });

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  return true;
}

function generateSignupNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function isExistingSignupResult(result) {
  return Boolean(result?.user?.id)
    && Array.isArray(result?.user?.identities)
    && result.user.identities.length === 0;
}

function pendingCheckoutAfterLogin() {
  const plan = sessionStorage.getItem(CHECKOUT_AFTER_LOGIN_KEY) || '';
  return ['pro_monthly', 'pro_annual'].includes(plan) ? plan : '';
}

async function request(path, { method = 'GET', token = null, body = null, prefer = null } = {}) {
  if (!supabaseUrl || !publishableKey) throw new Error('Configuração comercial indisponível.');

  const headers = {
    apikey: publishableKey,
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }

  if (!response.ok) {
    const apiMessage = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Erro HTTP ${response.status}`;
    throw new ApiError(apiMessage, response.status, payload);
  }
  return payload;
}

function setMessage(text = '', tone = '') {
  message.textContent = text;
  message.className = `form-message${tone ? ` ${tone}` : ''}`;
}

function showView(viewName) {
  document.querySelectorAll('.auth-view').forEach((view) => {
    view.hidden = view.dataset.view !== viewName;
  });
  setMessage();

  const target = document.querySelector(`.auth-view[data-view="${viewName}"]`);
  window.requestAnimationFrame(() => {
    target?.querySelector('input, select, button')?.focus({ preventScroll: true });
  });
}

function updateSignupSubmitLabel() {
  if (!signupSubmit) return;
  signupSubmit.textContent = ['pro_monthly', 'pro_annual'].includes(selectedPlan)
    ? 'Criar conta e continuar para pagamento'
    : 'Criar conta grátis';
}

function openModal(viewName = 'signup', plan = null) {
  if (plan) {
    selectedPlan = plan;
    sessionStorage.setItem(PLAN_KEY, selectedPlan);
  }
  if (planIntent) planIntent.value = selectedPlan;
  updateSignupSubmitLabel();

  previousFocus = document.activeElement;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  showView(viewName);
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
  setMessage();
  if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
}

function setBusy(form, busy) {
  const controls = [...form.elements];
  controls.forEach((control) => { control.disabled = busy; });
  const submit = form.querySelector('[type="submit"]');
  if (submit) {
    if (busy) {
      submit.dataset.label = submit.textContent;
      submit.textContent = 'Processando…';
    } else if (submit.dataset.label) {
      submit.textContent = submit.dataset.label;
      delete submit.dataset.label;
    }
  }
}

function friendlyError(error) {
  const raw = String(error?.message || '').toLowerCase();
  const messages = {
    signup_credentials_invalid: 'Confira seu e-mail e senha. Se já tem conta, use a senha cadastrada ou recupere o acesso.',
    invalid_signup_fields: 'Informe um e-mail válido e uma senha com pelo menos 8 caracteres.',
    signup_rate_limited: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.',
    checkout_in_progress: 'Seu pagamento está sendo preparado. Aguarde alguns instantes antes de tentar novamente.',
    pending_checkout_other_plan: 'Já existe uma compra pendente em outro plano. Selecione o plano dessa compra para continuar.',
    signup_lookup_unavailable: 'O cadastro está temporariamente indisponível. Tente novamente em instantes.',
    signup_auth_unavailable: 'Não foi possível validar o cadastro agora. Tente novamente em instantes.',
  };
  if (messages[raw]) return messages[raw];
  if (error?.status === 429 || raw.includes('only request this after')) return 'Aguarde um minuto antes de tentar novamente.';

  if (error?.status === 400 && (raw.includes('invalid login') || raw.includes('invalid credentials'))) return 'E-mail ou senha inválidos.';
  if (raw.includes('already registered') || raw.includes('already been registered')) return 'Este e-mail já possui uma conta. Use a opção Entrar.';
  if (raw.includes('password')) return 'Revise a senha. Ela precisa atender aos requisitos de segurança.';
  if (error?.status === 404 || raw.includes('could not find the table') || raw.includes('schema cache')) {
    return 'Seu acesso foi autenticado, mas a estrutura comercial ainda não foi publicada no banco. O onboarding ficará disponível após a ativação da migration SaaS.';
  }
  return error?.message || 'Não foi possível concluir a operação. Tente novamente.';
}

async function getAuthenticatedUser() {
  const token = currentSession?.access_token;
  if (!token) return null;
  try {
    const user = await request(API.user, { token });
    currentUser = user;
    const metadataPlan = user?.user_metadata?.plan_intent;
    if (!sessionStorage.getItem(PLAN_KEY) && ['freemium', 'pro_monthly', 'pro_annual'].includes(metadataPlan)) {
      selectedPlan = metadataPlan;
      sessionStorage.setItem(PLAN_KEY, selectedPlan);
    }
    return user;
  } catch (error) {
    if (error?.status === 401) clearSession();
    throw error;
  }
}

async function getProfile(ownerId) {
  const token = currentSession?.access_token;
  const query = `?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,account_id,owner_id,professional_name,business_name,phone,settings&limit=1`;
  const rows = await request(`${API.profiles}${query}`, { token });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function ensureAccount(ownerId, accountType) {
  const token = currentSession?.access_token;
  const select = '?select=id,owner_id,account_type,status&limit=1';
  const ownQuery = `?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,owner_id,account_type,status&limit=1`;
  const existing = await request(`${API.accounts}${ownQuery}`, { token });
  if (Array.isArray(existing) && existing[0]) return existing[0];

  try {
    const created = await request(`${API.accounts}${select}`, {
      method: 'POST',
      token,
      prefer: 'return=representation',
      body: {
        owner_id: ownerId,
        account_type: accountType,
        status: 'active',
      },
    });
    return Array.isArray(created) ? created[0] : created;
  } catch (error) {
    if (error?.status !== 409) throw error;
    const raced = await request(`${API.accounts}${ownQuery}`, { token });
    if (Array.isArray(raced) && raced[0]) return raced[0];
    throw error;
  }
}

async function saveProfessionalProfile(account, values) {
  const token = currentSession?.access_token;
  const endpoint = `${API.profiles}?on_conflict=owner_id&select=id,account_id,owner_id,professional_name,business_name,phone,settings`;
  const rows = await request(endpoint, {
    method: 'POST',
    token,
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      account_id: account.id,
      owner_id: account.owner_id,
      professional_name: values.professionalName,
      business_name: values.businessName,
      phone: values.phone,
      settings: {
        onboarding_version: 1,
        city: values.city,
        plan_intent: selectedPlan,
        onboarding_completed_at: new Date().toISOString(),
      },
    },
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

function confirmationRedirectUrl() {
  const redirect = new URL('./index.html', window.location.href);
  redirect.searchParams.set('confirmed', '1');
  redirect.searchParams.set('plan', selectedPlan);
  if (returnContext === 'sandbox') {
    redirect.searchParams.set('return', 'sandbox');
    redirect.searchParams.set('auto', '1');
  }
  return redirect.href;
}

async function startCheckout(planCode, environment = 'production') {
  const token = currentSession?.access_token;
  if (!token) throw new ApiError('Sua sessão expirou. Entre novamente.', 401, null);

  const endpoint = environment === 'sandbox'
    ? '/api/sandbox/asaas/checkout'
    : '/api/asaas/checkout';

  setMessage(environment === 'sandbox'
    ? 'Abrindo checkout de teste no Asaas Sandbox…'
    : 'Abrindo checkout seguro no Asaas…');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ planCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstDetail = payload?.details?.[0]?.description;
    throw new ApiError(firstDetail || payload?.message || payload?.error || 'Não foi possível preparar o checkout.', response.status, payload);
  }
  if (!payload.checkoutUrl) throw new Error('O Asaas não retornou o link do checkout.');
  window.location.assign(payload.checkoutUrl);
}

async function startPreconfirmCheckout(userId, signupNonce, planCode) {
  setMessage('Conta criada. Abrindo pagamento seguro no Asaas…');
  const response = await fetch('/api/asaas/preauth-checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, signupNonce, planCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstDetail = payload?.details?.[0]?.description;
    throw new ApiError(firstDetail || payload?.message || payload?.error || 'Não foi possível preparar o pagamento.', response.status, payload);
  }
  if (payload.status === 'paid') { window.location.assign('./compra-concluida.html'); return; }
  if (!payload.checkoutUrl) throw new Error('O Asaas não retornou o link do checkout.');
  window.location.assign(payload.checkoutUrl);
}

async function continueAfterOnboarding() {
  returnContext = sessionStorage.getItem(RETURN_KEY) || returnContext;
  selectedPlan = sessionStorage.getItem(PLAN_KEY) || selectedPlan;

  if (returnContext === 'sandbox') {
    window.location.assign('./sandbox-teste.html?auto=1');
    return;
  }

  if (pageUrl.searchParams.get('confirmed') === '1') {
    showView('complete');
    setMessage(
      ['pro_monthly', 'pro_annual'].includes(selectedPlan)
        ? 'E-mail confirmado e perfil salvo. O acesso Pro será liberado assim que o pagamento for confirmado.'
        : 'E-mail confirmado e perfil salvo. Seu acesso Freemium está pronto.',
      'success',
    );
    return;
  }

  if (['pro_monthly', 'pro_annual'].includes(selectedPlan)) {
    sessionStorage.removeItem(CHECKOUT_AFTER_LOGIN_KEY);
    await startCheckout(selectedPlan, 'production');
    return;
  }

  showView('complete');
  setMessage('Perfil profissional salvo com isolamento por conta.', 'success');
}

async function routeAuthenticatedSession() {
  const user = await getAuthenticatedUser();
  if (!user?.id) {
    showView('login');
    return;
  }

  const profile = await getProfile(user.id);
  const pendingPlan = pendingCheckoutAfterLogin();
  if (pendingPlan) {
    selectedPlan = pendingPlan;
    sessionStorage.setItem(PLAN_KEY, pendingPlan);
  }

  if (profile) {
    if (pendingPlan) {
      sessionStorage.removeItem(CHECKOUT_AFTER_LOGIN_KEY);
      await startCheckout(pendingPlan, 'production');
      return;
    }

    const shouldContinue = pageUrl.searchParams.get('auto') === '1' || pageUrl.searchParams.get('checkout') === '1';
    if (shouldContinue) {
      await continueAfterOnboarding();
      return;
    }
    showView('complete');
    setMessage(`Conta configurada para ${profile.professional_name || user.email || 'seu acesso'}.`, 'success');
    return;
  }

  showView('onboarding');
}

document.querySelectorAll('[data-open]').forEach((trigger) => {
  trigger.addEventListener('click', () => openModal(trigger.dataset.open, trigger.dataset.plan || null));
});

document.querySelectorAll('[data-close]').forEach((trigger) => trigger.addEventListener('click', closeModal));
document.querySelectorAll('[data-switch]').forEach((trigger) => {
  trigger.addEventListener('click', () => showView(trigger.dataset.switch));
});

modal.addEventListener('click', (event) => {
  if (event.target === modal) closeModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeModal();
});

planIntent?.addEventListener('change', () => {
  selectedPlan = planIntent.value;
  sessionStorage.setItem(PLAN_KEY, selectedPlan);
  updateSignupSubmitLabel();
});

document.querySelector('#signup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '');
  const confirmPassword = String(data.get('confirmPassword') || '');
  selectedPlan = String(data.get('planIntent') || selectedPlan || 'freemium');
  sessionStorage.setItem(PLAN_KEY, selectedPlan);

  if (password !== confirmPassword) {
    setMessage('As senhas precisam ser iguais.', 'error');
    return;
  }

  const signupNonce = generateSignupNonce();
  setBusy(form, true);
  setMessage('Criando seu acesso…');
  try {
    if (['pro_monthly', 'pro_annual'].includes(selectedPlan)) {
      const response = await fetch('/api/asaas/signup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, planCode: selectedPlan }),
      });
      const pending = await response.json().catch(() => ({}));
      if (!response.ok) throw new ApiError(pending.error || 'Falha ao preparar cadastro.', response.status, pending);
      if (pending.session?.access_token) saveSession(pending.session);
      if (pending.session?.access_token && !pending.userId) {
        sessionStorage.setItem(CHECKOUT_AFTER_LOGIN_KEY, selectedPlan);
        await routeAuthenticatedSession();
        return;
      }
      if (!pending.userId || !pending.signupNonce) throw new Error('Não foi possível preparar o cadastro.');
      // A limited purchase proof, never the password or an authenticated clinical session.
      sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify({ userId: pending.userId, signupNonce: pending.signupNonce }));
      await startPreconfirmCheckout(pending.userId, pending.signupNonce, selectedPlan);
      return;
    }
    const signupPath = `${API.signup}?redirect_to=${encodeURIComponent(confirmationRedirectUrl())}`;
    const result = await request(signupPath, {
      method: 'POST',
      body: {
        email,
        password,
        data: {
          signup_source: 'commercial_saas',
          plan_intent: selectedPlan,
          signup_nonce: signupNonce,
        },
      },
    });

    if (isExistingSignupResult(result)) {
      if (['pro_monthly', 'pro_annual'].includes(selectedPlan)) {
        sessionStorage.setItem(CHECKOUT_AFTER_LOGIN_KEY, selectedPlan);
      } else {
        sessionStorage.removeItem(CHECKOUT_AFTER_LOGIN_KEY);
      }
      const loginEmail = document.querySelector('#login-form input[name="email"]');
      if (loginEmail) loginEmail.value = email;
      showView('login');
      setMessage('Este e-mail já possui uma conta. Entre com sua senha para continuar para o pagamento.', 'error');
      return;
    }

    if (result?.access_token) saveSession(result);

    if (['pro_monthly', 'pro_annual'].includes(selectedPlan) && result?.user?.id) {
      await startPreconfirmCheckout(result.user.id, signupNonce, selectedPlan);
      return;
    }

    if (result?.access_token) {
      setMessage('Acesso criado. Vamos configurar seu perfil.', 'success');
      await routeAuthenticatedSession();
    } else {
      setMessage('Conta criada. Confira seu e-mail para confirmar o cadastro. O link retornará para este ambiente comercial.', 'success');
    }
  } catch (error) {
    setMessage(friendlyError(error), 'error');
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);

  setBusy(form, true);
  setMessage('Validando acesso…');
  try {
    const result = await request(API.login, {
      method: 'POST',
      body: {
        email: String(data.get('email') || '').trim(),
        password: String(data.get('password') || ''),
      },
    });
    saveSession(result);
    setMessage('Acesso confirmado.', 'success');
    await routeAuthenticatedSession();
  } catch (error) {
    setMessage(friendlyError(error), 'error');
  } finally {
    setBusy(form, false);
  }
});

document.querySelector('#onboarding-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);

  setBusy(form, true);
  setMessage('Salvando sua configuração…');
  try {
    const user = currentUser || await getAuthenticatedUser();
    if (!user?.id) throw new ApiError('Sua sessão expirou. Entre novamente.', 401, null);

    const values = {
      professionalName: String(data.get('professionalName') || '').trim(),
      businessName: String(data.get('businessName') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      accountType: String(data.get('accountType') || 'individual'),
      city: String(data.get('city') || '').trim(),
    };

    const account = await ensureAccount(user.id, values.accountType);
    await saveProfessionalProfile(account, values);
    await continueAfterOnboarding();
  } catch (error) {
    if (error?.status === 401) {
      clearSession();
      showView('login');
    }
    setMessage(friendlyError(error), 'error');
  } finally {
    setBusy(form, false);
  }
});

updateSignupSubmitLabel();
const capturedAuthCallback = captureAuthCallbackSession();
if (capturedAuthCallback || currentSession?.access_token) {
  routeAuthenticatedSession().catch(() => clearSession());
}
