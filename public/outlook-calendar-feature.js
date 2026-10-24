// Outlook ICS subscription has its own token and does not use Microsoft OAuth or Google/Apple credentials.
// The subscription token is returned only when created; it is never re-read from D1 or persisted here.
const container = document.querySelector('[data-screen="settings"]');
if (container && !container.querySelector('[data-outlook-calendar-integration]')) {
  if (!document.getElementById('outlook-calendar-card-style')) {
    const style = document.createElement('style');
    style.id = 'outlook-calendar-card-style';
    style.textContent = [
      '.outlook-calendar-card{display:grid;gap:12px;padding:16px!important}',
      '.outlook-calendar-card [hidden]{display:none!important}',
      '.outlook-calendar-main{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:10px}',
      '.outlook-calendar-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--lac-rose-soft,#f4e8ed);color:var(--lac-rose,#a36582)}',
      '.outlook-calendar-title{min-width:0;display:grid;gap:4px}',
      '.outlook-calendar-title h2{font-size:1.05rem;line-height:1.25;margin:0!important;color:var(--lac-ink,#3b303a)}',
      '.outlook-calendar-state{display:flex;gap:6px;align-items:center;font-size:.78rem;line-height:1.3;color:var(--ui-text-secondary,#6a6268)}',
      '.outlook-calendar-state::before{content:"";width:7px;height:7px;flex:none;border-radius:100%;background:#a29aa5}',
      '.outlook-calendar-state[data-state="active"]::before{background:#36875e}',
      '.outlook-calendar-state[data-state="error"]::before{background:#b04050}',
      '.outlook-calendar-manage{font-size:.8rem!important;padding:8px 10px!important;min-height:40px!important;white-space:nowrap}',
      '.outlook-calendar-description{font-size:.85rem;line-height:1.45;color:var(--ui-text-secondary,#6a6268);margin:0}',
      '.outlook-calendar-panel{display:grid;gap:12px;padding-top:12px;border-top:1px solid var(--ui-border,#e8e0e3)}',
      '.outlook-calendar-actions{display:flex;flex-wrap:wrap;gap:8px}',
      '.outlook-calendar-actions .ui-button{white-space:normal;text-align:center;min-height:42px}',
      '.outlook-calendar-danger{color:#a02449!important}',
      '.outlook-calendar-notice{font-size:.83rem;line-height:1.4;margin:0;padding:10px 12px;border-radius:10px;background:var(--lac-rose-soft,#f7ecef)}',
      '.outlook-calendar-notice[data-error="true"]{color:#a02449;background:#fff1f2}',
      '.outlook-calendar-help{font-size:.8rem;line-height:1.45;color:var(--ui-text-secondary,#6a6268)}',
      '.outlook-calendar-help summary{cursor:pointer;font-weight:650;color:var(--lac-rose,#9d647b);padding:6px 0}',
      '.outlook-calendar-help p{margin:6px 0}',
      '.outlook-calendar-created{display:grid;gap:10px;border:1px solid var(--ui-border,#e8e0e3);border-radius:13px;padding:12px}',
      '.outlook-calendar-created strong{font-size:.87rem}',
      '.outlook-calendar-created .field{min-width:0}',
      '.outlook-calendar-created input{font-size:12px}',
      '@media(max-width:385px){.outlook-calendar-main{grid-template-columns:42px minmax(0,1fr)}.outlook-calendar-manage{grid-column:2;justify-self:start}}',
    ].join('');
    document.head.append(style);
  }

  const card = document.createElement('article');
  card.className = 'detail-card outlook-calendar-card';
  card.dataset.outlookCalendarIntegration = 'true';
  card.setAttribute('data-outlook-calendar-integration', 'true');
  card.innerHTML = [
    '<div class="outlook-calendar-main">',
    '<span class="outlook-calendar-icon" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15h3"/></svg></span>',
    '<div class="outlook-calendar-title"><h2>Outlook Calendário</h2>',
    '<div class="outlook-calendar-state" data-outlook-state data-state="loading" role="status" aria-live="polite">Verificando…</div></div>',
    '<button type="button" class="ui-button ui-button-ghost outlook-calendar-manage" data-outlook-manage aria-controls="outlook-calendar-manage-panel" aria-expanded="false" hidden>Gerenciar</button>',
    '</div>',
    '<p class="outlook-calendar-description" data-outlook-description>Acompanhe seus horários no Outlook por assinatura automática.</p>',
    '<p class="outlook-calendar-notice" data-outlook-status role="status" aria-live="polite" hidden></p>',
    '<div class="outlook-calendar-actions">',
    '<button type="button" class="ui-button ui-button-primary" data-outlook-create hidden>Gerar link Outlook</button>',
    '<button type="button" class="ui-button ui-button-ghost" data-outlook-retry hidden>Tentar novamente</button>',
    '</div>',
    '<div class="outlook-calendar-created" data-outlook-subscription hidden>',
    '<strong>Seu link privado está pronto</strong>',
    '<div class="outlook-calendar-actions">',
    '<a class="ui-button ui-button-primary" data-outlook-open>Abrir Outlook</a>',
    '<button type="button" class="ui-button ui-button-ghost" data-outlook-copy>Copiar link</button>',
    '</div>',
    '<details class="outlook-calendar-help"><summary>Ver link privado</summary>',
    '<label class="field"><span>Link de assinatura privado</span>',
    '<input type="text" data-outlook-url readonly spellcheck="false" autocomplete="off" aria-label="Link de assinatura Outlook Calendário"></label>',
    '</details>',
    '<p class="outlook-calendar-description"><strong>Como adicionar:</strong> no Outlook, abra Calendário → Adicionar calendário → Assinar da Web → cole o link → Importar.</p>',
    '<p class="outlook-calendar-description">Após a primeira assinatura, os agendamentos serão atualizados automaticamente, conforme a frequência do Outlook (pode superar 24 horas).</p>',
    '</div>',
    '<div class="outlook-calendar-panel" id="outlook-calendar-manage-panel" data-outlook-manage-panel hidden>',
    '<div class="outlook-calendar-actions">',
    '<button type="button" class="ui-button ui-button-ghost" data-outlook-rotate>Substituir link</button>',
    '<button type="button" class="ui-button ui-button-ghost outlook-calendar-danger" data-outlook-revoke>Desativar compartilhamento</button>',
    '</div>',
    '<p class="outlook-calendar-description">Por segurança, o link privado é exibido apenas ao gerar. Para recuperá-lo, gere outro e atualize a assinatura no Outlook.</p>',
    '<details class="outlook-calendar-help" data-outlook-privacy><summary>Como funciona e privacidade</summary>',
    '<p>O Outlook busca atualizações periodicamente, podendo levar mais de 24 horas. Não é sincronização instantânea.</p>',
    '<p>O link mostra somente horários e duração, sem nomes ou dados clínicos. Trate-o como uma senha. A agenda assinada é somente leitura; editar eventos no Outlook não altera o sistema.</p>',
    '</details>',
    '</div>',
  ].join('');
  const outlookLink = card.querySelector('[data-outlook-open]');
  outlookLink.setAttribute('target', '_blank');
  outlookLink.setAttribute('rel', 'noopener noreferrer');
  const list = container.querySelector('.settings-list');
  if (list) list.before(card); else container.append(card);

  const find = selector => card.querySelector(selector);
  const controls = ['[data-outlook-manage]', '[data-outlook-create]', '[data-outlook-retry]',
    '[data-outlook-rotate]', '[data-outlook-copy]', '[data-outlook-revoke]'];
  let active = null;
  let failed = false;
  let busy = false;
  let expanded = false;
  let freshUrl = '';

  function notice(message, isError = false) {
    const node = find('[data-outlook-status]');
    node.textContent = message;
    node.hidden = !message;
    node.dataset.error = String(isError);
  }

  function clearFreshLink() {
    freshUrl = '';
    find('[data-outlook-url]').value = '';
    find('[data-outlook-open]').removeAttribute('href');
    find('[data-outlook-subscription]').hidden = true;
  }

  function render() {
    const state = find('[data-outlook-state]');
    state.dataset.state = failed ? 'error' : active === true ? 'active' : active === false ? 'inactive' : 'loading';
    state.textContent = failed ? 'Não foi possível verificar' : active === true ? 'Link ativo' :
      active === false ? 'Link não criado' : 'Verificando…';
    find('[data-outlook-description]').textContent = active === true && !failed
      ? 'Link gerado. Assine da Web no Outlook para acompanhar alterações.'
      : 'Acompanhe seus atendimentos no Outlook Calendário.';
    find('[data-outlook-create]').hidden = active !== false || failed;
    find('[data-outlook-manage]').hidden = active !== true || failed;
    find('[data-outlook-retry]').hidden = !failed;
    find('[data-outlook-manage-panel]').hidden = active !== true || failed || !expanded;
    find('[data-outlook-manage]').setAttribute('aria-expanded', String(active === true && !failed && expanded));
    find('[data-outlook-subscription]').hidden = !freshUrl;
    card.setAttribute('aria-busy', String(busy));
    controls.forEach(selector => { find(selector).disabled = busy; });
  }

  function token() {
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
      for (const key of ['debora-lactacao-session', 'amamentacao-session']) {
        try {
          const value = JSON.parse(store?.getItem(key) || 'null');
          if (value?.access_token) return value.access_token;
        } catch { /* unavailable or malformed storage */ }
      }
    }
    return globalThis.__deboraAccessToken || '';
  }

  async function api(path, method = 'GET') {
    const bearer = token();
    if (!bearer) throw new Error('Entre em sua conta antes de conectar a agenda.');
    const res = await fetch(path, {
      method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + bearer },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401
      ? 'Sessão expirada. Entre novamente.'
      : 'Não foi possível acessar o Outlook Calendário. Tente novamente.');
    return data;
  }

  async function run(operation) {
    if (busy) return;
    busy = true;
    render();
    try {
      await operation();
    } catch (error) {
      notice(error.message || 'Não foi possível concluir. Tente novamente.', true);
    } finally {
      busy = false;
      render();
    }
  }

  // A failed initial load does not grant a choice to create/rotate an unknown active link.
  async function checkStatus() {
    if (busy) return;
    busy = true;
    render();
    try {
      const status = await api('/api/calendar/outlook/status');
      if (typeof status.active !== 'boolean') throw new Error('Resposta inválida do calendário.');
      active = status.active;
      failed = false;
      if (!active) { expanded = false; clearFreshLink(); }
      notice('');
    } catch (error) {
      failed = true;
      expanded = false;
      notice(error.message || 'Não foi possível verificar a assinatura.', true);
    } finally {
      busy = false;
      render();
    }
  }

  function bind(selector, operation) {
    find(selector).addEventListener('click', () => { void run(operation); });
  }

  async function createLink() {
    const status = await api('/api/calendar/outlook/status');
    if (typeof status.active !== 'boolean') throw new Error('Não foi possível confirmar o estado atual do link.');
    if (status.active && !window.confirm(
      'Substituir link? O anterior deixará de atualizar. Você precisará substituir a assinatura do Outlook pelo novo link.'
    )) return;
    const result = await api('/api/calendar/outlook/create', 'POST');
    const url = new URL(result.subscription_url);
    if (!result.active || url.protocol !== 'https:' || url.hostname !== 'deboralactacao.com'
        || !/^\/api\/calendar\/outlook\/feed\/[a-f0-9]{64}\.ics$/.test(url.pathname)) {
      throw new Error('Link de assinatura inválido.');
    }
    freshUrl = url.href;
    find('[data-outlook-url]').value = url.href;
    find('[data-outlook-open]').href = 'https://outlook.live.com/calendar/0/';
    active = true;
    failed = false;
    expanded = false;
    notice('Link criado. Copie e no Outlook use Adicionar calendário → Assinar da Web → Importar.');
  }

  find('[data-outlook-manage]').addEventListener('click', () => {
    if (busy || active !== true || failed) return;
    expanded = !expanded;
    render();
  });
  bind('[data-outlook-create]', createLink);
  bind('[data-outlook-rotate]', createLink);
  bind('[data-outlook-copy]', async () => {
    if (!freshUrl) throw new Error('O link só é exibido na geração. Substitua-o para obter outro.');
    if (!navigator.clipboard?.writeText) throw new Error('Não foi possível copiar automaticamente. Use o campo Ver link privado.');
    await navigator.clipboard.writeText(freshUrl);
    notice('Link copiado. Não o compartilhe.');
  });
  bind('[data-outlook-revoke]', async () => {
    if (!window.confirm(
      'Desativar compartilhamento? O link deixará de atualizar. Remova o calendário assinado também do dispositivo.'
    )) return;
    const result = await api('/api/calendar/outlook/revoke', 'POST');
    if (result.active !== false) throw new Error('Não foi possível confirmar a desativação. Verifique novamente.');
    active = false;
    failed = false;
    expanded = false;
    clearFreshLink();
    notice('Link desativado. Remova também o calendário assinado do dispositivo.');
  });
  find('[data-outlook-retry]').addEventListener('click', () => { void checkStatus(); });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-nav-target="settings"],[data-mobile-target="more"]')) void checkStatus();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/settings') void checkStatus();
  });
  render();
  if (location.hash === '#/settings') void checkStatus();
}
