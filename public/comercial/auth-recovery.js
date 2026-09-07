const runtime = window.SAAS_RUNTIME_CONFIG || {};
const supabaseUrl = String(runtime.supabaseUrl || '').replace(/\/$/, '');
const publishableKey = String(runtime.supabasePublishableKey || '');

const SESSION_KEY = 'commercial.saas.session.v1';
const PLAN_KEY = 'commercial.saas.plan-intent.v1';
const CHECKOUT_AFTER_LOGIN_KEY = 'commercial.saas.checkout-after-login.v1';

const modal = document.querySelector('#auth-modal');
const message = document.querySelector('#form-message');
const loginForm = document.querySelector('#login-form');
const recoverButton = document.querySelector('[data-recover-password]');

function setMessage(text = '', tone = '') {
  if (!message) return;
  message.textContent = text;
  message.className = `form-message${tone ? ` ${tone}` : ''}`;
}

function recoveryRedirectUrl() {
  const url = new URL('./index.html', window.location.href);
  url.searchParams.set('recovery', '1');
  return url.href;
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

async function requestRecovery(email) {
  const response = await fetch(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(recoveryRedirectUrl())}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.msg || payload?.message || 'Não foi possível enviar a recuperação agora.');
  }
}

recoverButton?.addEventListener('click', async () => {
  const emailInput = loginForm?.querySelector('input[name="email"]');
  const email = String(emailInput?.value || '').trim();
  if (!email) {
    setMessage('Informe seu e-mail para recuperar a senha.', 'error');
    emailInput?.focus();
    return;
  }

  const plan = sessionStorage.getItem(PLAN_KEY) || '';
  if (['pro_monthly', 'pro_annual'].includes(plan)) {
    sessionStorage.setItem(CHECKOUT_AFTER_LOGIN_KEY, plan);
  }

  recoverButton.disabled = true;
  setMessage('Enviando link para redefinir sua senha…');
  try {
    await requestRecovery(email);
    setMessage('Se este e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Depois disso, o fluxo continua para o pagamento.', 'success');
  } catch (error) {
    setMessage(error?.message || 'Não foi possível enviar a recuperação agora.', 'error');
  } finally {
    recoverButton.disabled = false;
  }
});

function showResetPasswordView() {
  if (!modal || !message) return;
  const session = readSession();
  const token = String(session?.access_token || '');

  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  document.querySelectorAll('.auth-view').forEach((view) => { view.hidden = true; });

  let view = document.querySelector('[data-view="reset-password"]');
  if (!view) {
    view = document.createElement('div');
    view.className = 'auth-view';
    view.dataset.view = 'reset-password';
    view.innerHTML = `
      <span class="eyebrow">Recuperar acesso</span>
      <h2>Nova senha</h2>
      <p class="muted">Defina uma nova senha para continuar sua compra.</p>
      <form id="reset-password-form" class="form-stack">
        <label>Nova senha<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
        <label>Confirmar nova senha<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required></label>
        <button class="button full" type="submit">Salvar nova senha e continuar</button>
      </form>`;
    message.parentElement?.insertBefore(view, message);
  }
  view.hidden = false;

  if (!token) {
    setMessage('Este link de recuperação não contém uma sessão válida. Solicite um novo link.', 'error');
    return;
  }

  const form = view.querySelector('#reset-password-form');
  if (form?.dataset.bound === '1') return;
  if (form) form.dataset.bound = '1';

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    const confirmPassword = String(data.get('confirmPassword') || '');
    if (password !== confirmPassword) {
      setMessage('As senhas precisam ser iguais.', 'error');
      return;
    }

    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    setMessage('Atualizando sua senha…');
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.msg || payload?.message || 'Não foi possível atualizar a senha.');

      setMessage('Senha atualizada. Retomando sua compra…', 'success');
      const destination = new URL('./index.html', window.location.href);
      destination.searchParams.set('auto', '1');
      window.setTimeout(() => window.location.assign(destination.href), 250);
    } catch (error) {
      setMessage(error?.message || 'Não foi possível atualizar a senha.', 'error');
      submit.disabled = false;
    }
  });
}

if (new URL(window.location.href).searchParams.get('recovery') === '1') {
  window.setTimeout(showResetPasswordView, 0);
}
