import './app-entry-bridge.js';

const apiBaseUrl = window.location.origin;
const recoveryToken = new URLSearchParams(window.location.hash.slice(1)).get('recovery_token') || '';
if (recoveryToken) history.replaceState(null, '', window.location.pathname + window.location.search);

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

async function requestRecovery(email) {
  const response = await fetch(`${apiBaseUrl}/api/auth/recovery`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ email }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || 'Não foi possível enviar a recuperação agora.');
  }
  return payload;
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
  setMessage('Solicitando recuperação de senha…');
  try {
    const result = await requestRecovery(email);
    setMessage(result.message, 'success');
  } catch (error) {
    setMessage(error?.message || 'Não foi possível enviar a recuperação agora.', 'error');
  } finally {
    recoverButton.disabled = false;
  }
});

function showResetPasswordView() {
  if (!modal || !message) return;
  const token = recoveryToken;

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
      const response = await fetch(`${apiBaseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.msg || payload?.message || 'Não foi possível atualizar a senha.');

      for (const key of [SESSION_KEY, 'debora-lactacao-session', 'amamentacao-session', 'debora-runtime-access-token']) {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      }
      setMessage('Senha atualizada. Entre com a nova senha para continuar.', 'success');
      const destination = new URL('./index.html', window.location.href);
      destination.searchParams.set('login', '1');
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

if (new URL(window.location.href).searchParams.get('login') === '1') {
  document.querySelector('[data-open=login]')?.click();
}
