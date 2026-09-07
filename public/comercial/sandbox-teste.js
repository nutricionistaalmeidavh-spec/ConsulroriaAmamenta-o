const runtime = window.SAAS_RUNTIME_CONFIG || {};
const supabaseUrl = String(runtime.supabaseUrl || '').replace(/\/$/, '');
const publishableKey = String(runtime.supabasePublishableKey || '');
const SESSION_KEY = 'commercial.saas.session.v1';
const PLAN_KEY = 'commercial.saas.plan-intent.v1';

const statusEl = document.querySelector('#sandbox-status');
const authEl = document.querySelector('#sandbox-auth');
const readyEl = document.querySelector('#sandbox-ready');
const accountEl = document.querySelector('#sandbox-account');

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function setStatus(text, tone = '') {
  statusEl.textContent = text;
  statusEl.className = `plan-message${tone ? ` ${tone}` : ''}`;
}

async function supabase(path, token) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.msg || payload?.error || `Erro HTTP ${response.status}`);
  return payload;
}

async function createSandboxCheckout(planCode, token) {
  setStatus('Criando checkout no Asaas Sandbox…');
  const response = await fetch('/api/sandbox/asaas/checkout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ planCode }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.details?.[0]?.description;
    throw new Error(detail || payload?.message || payload?.error || 'Falha ao criar checkout Sandbox.');
  }
  if (!payload.checkoutUrl || payload.environment !== 'sandbox') {
    throw new Error('Resposta Sandbox inválida.');
  }
  window.location.assign(payload.checkoutUrl);
}

async function init() {
  if (!supabaseUrl || !publishableKey) {
    setStatus('Configuração comercial indisponível.', 'error');
    return;
  }

  const session = readSession();
  const token = session?.access_token;
  if (!token) {
    authEl.hidden = false;
    setStatus('É necessário entrar em uma conta comercial para o teste.', 'error');
    return;
  }

  try {
    const user = await supabase('/auth/v1/user', token);
    if (!user?.id) throw new Error('Sessão comercial inválida.');

    const accounts = await supabase(`/rest/v1/saas_accounts?owner_id=eq.${encodeURIComponent(user.id)}&select=id,status&limit=1`, token);
    if (!Array.isArray(accounts) || !accounts[0]) {
      authEl.hidden = false;
      setStatus('Finalize o onboarding comercial antes do teste.', 'error');
      return;
    }

    const metadataPlan = user?.user_metadata?.plan_intent;
    if (['pro_monthly', 'pro_annual'].includes(metadataPlan)) {
      sessionStorage.setItem(PLAN_KEY, metadataPlan);
    }

    accountEl.textContent = user.email || user.id;
    readyEl.hidden = false;
    setStatus('Sandbox pronto. Escolha um plano para gerar a cobrança de teste.', 'success');

    document.querySelectorAll('[data-sandbox-checkout]').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await createSandboxCheckout(button.dataset.sandboxCheckout, token);
        } catch (error) {
          setStatus(error?.message || 'Falha ao iniciar o Sandbox.', 'error');
          button.disabled = false;
        }
      });
    });

    const shouldAutoStart = new URL(window.location.href).searchParams.get('auto') === '1';
    if (shouldAutoStart) {
      const storedPlan = sessionStorage.getItem(PLAN_KEY);
      const planCode = ['pro_monthly', 'pro_annual'].includes(storedPlan) ? storedPlan : 'pro_monthly';
      await createSandboxCheckout(planCode, token);
    }
  } catch (error) {
    sessionStorage.removeItem(SESSION_KEY);
    authEl.hidden = false;
    setStatus(error?.message || 'Sua sessão expirou.', 'error');
  }
}

init();
