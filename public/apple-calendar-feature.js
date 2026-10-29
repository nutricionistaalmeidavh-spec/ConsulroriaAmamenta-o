// Apple-only calendar settings. Google OAuth is intentionally not part of this release.
// The subscription token is returned only when created; it is never re-read from D1 or persisted here.
const container = document.querySelector('[data-screen="settings"]');
if (container && !container.querySelector('[data-apple-calendar-integration]')) {
  if (!document.getElementById('apple-calendar-card-style')) {
    const style = document.createElement('style');
    style.id = 'apple-calendar-card-style';
    style.textContent = [
      '.apple-calendar-card{display:grid;gap:12px;padding:16px!important}',
      '.apple-calendar-card [hidden]{display:none!important}',
      '.apple-calendar-main{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:10px}',
      '.apple-calendar-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:var(--lac-rose-soft,#f4e8ed);color:var(--lac-rose,#a36582)}',
      '.apple-calendar-title{min-width:0;display:grid;gap:4px}',
      '.apple-calendar-title h2{font-size:1.05rem;line-height:1.25;margin:0!important;color:var(--lac-ink,#3b303a)}',
      '.apple-calendar-state{display:flex;gap:6px;align-items:center;font-size:.78rem;line-height:1.3;color:var(--ui-text-secondary,#6a6268)}',
      '.apple-calendar-state::before{content:"";width:7px;height:7px;flex:none;border-radius:100%;background:#a29aa5}',
      '.apple-calendar-state[data-state="active"]::before{background:#36875e}',
      '.apple-calendar-state[data-state="error"]::before{background:#b04050}',
      '.apple-calendar-manage{font-size:.8rem!important;padding:8px 10px!important;min-height:40px!important;white-space:nowrap}',
      '.apple-calendar-description{font-size:.85rem;line-height:1.45;color:var(--ui-text-secondary,#6a6268);margin:0}',
      '.apple-calendar-panel{display:grid;gap:12px;padding-top:12px;border-top:1px solid var(--ui-border,#e8e0e3)}',
      '.apple-calendar-actions{display:flex;flex-wrap:wrap;gap:8px}',
      '.apple-calendar-actions .ui-button{white-space:normal;text-align:center;min-height:42px}',
      '.apple-calendar-danger{color:#a02449!important}',
      '.apple-calendar-notice{font-size:.83rem;line-height:1.4;margin:0;padding:10px 12px;border-radius:10px;background:var(--lac-rose-soft,#f7ecef)}',
      '.apple-calendar-notice[data-error="true"]{color:#a02449;background:#fff1f2}',
      '.apple-calendar-help{font-size:.8rem;line-height:1.45;color:var(--ui-text-secondary,#6a6268)}',
      '.apple-calendar-help summary{cursor:pointer;font-weight:650;color:var(--lac-rose,#9d647b);padding:6px 0}',
      '.apple-calendar-help p{margin:6px 0}',
      '.apple-calendar-created{display:grid;gap:10px;border:1px solid var(--ui-border,#e8e0e3);border-radius:13px;padding:12px}',
      '.apple-calendar-created strong{font-size:.87rem}',
      '.apple-calendar-created .field{min-width:0}',
      '.apple-calendar-created input{font-size:12px}',
      '@media(max-width:385px){.apple-calendar-main{grid-template-columns:42px minmax(0,1fr)}.apple-calendar-manage{grid-column:2;justify-self:start}}',
    ].join('');
    document.head.append(style);
  }

  const card = document.createElement('article');
  card.className = 'detail-card apple-calendar-card';
  card.dataset.appleCalendarIntegration = 'true';
  // Keep the integration invisible until the backend confirms Pro/partner access.
  card.style.display = 'none';
  card.innerHTML = [
    '<div class="apple-calendar-main">',
    '<span class="apple-calendar-icon" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15h3"/></svg></span>',
    '<div class="apple-calendar-title"><h2>Apple Calendário</h2>',
    '<div class="apple-calendar-state" data-apple-state data-state="loading" role="status" aria-live="polite">Verificando…</div></div>',
    '<button type="button" class="ui-button ui-button-ghost apple-calendar-manage" data-apple-manage aria-controls="apple-calendar-manage-panel" aria-expanded="false" hidden>Gerenciar</button>',
    '</div>',
    '<p class="apple-calendar-description" data-apple-description>Consulte seus compromissos no iPhone ou Mac.</p>',
    '<p class="apple-calendar-notice" data-apple-status role="status" aria-live="polite" hidden></p>',
    '<div class="apple-calendar-actions">',
    '<button type="button" class="ui-button ui-button-primary" data-apple-create hidden>Conectar Apple Calendário</button>',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-retry hidden>Tentar novamente</button>',
    '</div>',
    '<div class="apple-calendar-created" data-apple-subscription hidden>',
    '<strong>Link pronto para adicionar ao Calendário</strong>',
    '<div class="apple-calendar-actions">',
    '<a class="ui-button ui-button-primary" data-apple-open>Adicionar ao Apple Calendário</a>',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-copy>Copiar link</button>',
    '</div>',
    '<details class="apple-calendar-help"><summary>Ver link privado</summary>',
    '<label class="field"><span>Link de assinatura privado</span>',
    '<input type="text" data-apple-url readonly spellcheck="false" autocomplete="off" aria-label="Link de assinatura Apple Calendário"></label>',
    '</details>',
    '<p class="apple-calendar-description">Confirme a assinatura no aplicativo. Depois, as atualizações serão periódicas.</p>',
    '</div>',
    '<div class="apple-calendar-panel" id="apple-calendar-manage-panel" data-apple-manage-panel hidden>',
    '<div class="apple-calendar-actions">',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-rotate>Substituir link</button>',
    '<button type="button" class="ui-button ui-button-ghost apple-calendar-danger" data-apple-revoke>Desativar compartilhamento</button>',
    '</div>',
    '<p class="apple-calendar-description">O link original não pode ser recuperado. Para adicionar em outro dispositivo, substitua-o.</p>',
    '<details class="apple-calendar-help" data-apple-privacy><summary>Como funciona e privacidade</summary>',
    '<p>O Apple Calendário busca atualizações periodicamente, sem sincronização instantânea.</p>',
    '<p>O link mostra somente horários e duração, sem nomes ou dados clínicos. Trate-o como uma senha. A agenda assinada é somente leitura.</p>',
    '</details>',
    '</div>',
  ].join('');
  const list = container.querySelector('.settings-list');
  if (list) list.before(card); else container.append(card);

  const find = selector => card.querySelector(selector);
  const controls = ['[data-apple-manage]', '[data-apple-create]', '[data-apple-retry]',
    '[data-apple-rotate]', '[data-apple-copy]', '[data-apple-revoke]'];
  let active = null;
  let failed = false;
  let busy = false;
  let expanded = false;
  let freshUrl = '';

  function notice(message, isError = false) {
    const node = find('[data-apple-status]');
    node.textContent = message;
    node.hidden = !message;
    node.dataset.error = String(isError);
  }

  function clearFreshLink() {
    freshUrl = '';
    find('[data-apple-url]').value = '';
    find('[data-apple-open]').removeAttribute('href');
    find('[data-apple-subscription]').hidden = true;
  }

  function render() {
    const state = find('[data-apple-state]');
    state.dataset.state = failed ? 'error' : active === true ? 'active' : active === false ? 'inactive' : 'loading';
    state.textContent = failed ? 'Não foi possível verificar' : active === true ? 'Link ativo' :
      active === false ? 'Não conectado' : 'Verificando…';
    find('[data-apple-description]').textContent = active === true && !failed
      ? 'Seus agendamentos são atualizados periodicamente no Calendário.'
      : 'Consulte seus compromissos no iPhone ou Mac.';
    find('[data-apple-create]').hidden = active !== false || failed;
    find('[data-apple-manage]').hidden = active !== true || failed;
    find('[data-apple-retry]').hidden = !failed;
    find('[data-apple-manage-panel]').hidden = active !== true || failed || !expanded;
    find('[data-apple-manage]').setAttribute('aria-expanded', String(active === true && !failed && expanded));
    find('[data-apple-subscription]').hidden = !freshUrl;
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
    if (!res.ok) {
      const error = new Error(res.status === 401 ? 'Sessão expirada. Entre novamente.'
        : res.status === 403 ? 'Disponível somente no plano Pro ou para parceiras autorizadas.'
        : 'Não foi possível acessar o Apple Calendário. Tente novamente.');
      error.status = res.status;
      throw error;
    }
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
      const status = await api('/api/calendar/apple/status');
      if (typeof status.active !== 'boolean') throw new Error('Resposta inválida do calendário.');
      card.style.display = '';
      active = status.active;
      failed = false;
      if (!active) { expanded = false; clearFreshLink(); }
      notice('');
    } catch (error) {
      if (error.status === 403) {
        card.style.display = 'none';
        active = null;
        expanded = false;
        clearFreshLink();
        return;
      }
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
    const status = await api('/api/calendar/apple/status');
    if (typeof status.active !== 'boolean') throw new Error('Não foi possível confirmar o estado atual do link.');
    if (status.active && !window.confirm(
      'Substituir link? O anterior deixará de atualizar. Você precisará adicionar o novo link ao Apple Calendário.'
    )) return;
    const result = await api('/api/calendar/apple/create', 'POST');
    const url = new URL(result.subscription_url);
    if (!result.active || url.protocol !== 'https:' || url.hostname !== 'deboralactacao.com'
        || !/^\/api\/calendar\/apple\/feed\/[a-f0-9]{64}\.ics$/.test(url.pathname)
        || result.webcal_url !== url.href.replace(/^https:/, 'webcal:')) {
      throw new Error('Link de assinatura inválido.');
    }
    freshUrl = url.href;
    find('[data-apple-url]').value = url.href;
    find('[data-apple-open]').href = result.webcal_url;
    active = true;
    failed = false;
    expanded = false;
    notice('Link criado. Abra no Apple Calendário e confirme a assinatura.');
  }

  find('[data-apple-manage]').addEventListener('click', () => {
    if (busy || active !== true || failed) return;
    expanded = !expanded;
    render();
  });
  bind('[data-apple-create]', createLink);
  bind('[data-apple-rotate]', createLink);
  bind('[data-apple-copy]', async () => {
    if (!freshUrl) throw new Error('O link só é exibido quando é criado. Substitua-o para gerar outro.');
    if (!navigator.clipboard?.writeText) throw new Error('Não foi possível copiar automaticamente. Use o campo Ver link privado.');
    await navigator.clipboard.writeText(freshUrl);
    notice('Link copiado. Não o compartilhe.');
  });
  bind('[data-apple-revoke]', async () => {
    if (!window.confirm(
      'Desativar compartilhamento? O link deixará de atualizar. Remova o calendário assinado também do dispositivo.'
    )) return;
    const result = await api('/api/calendar/apple/revoke', 'POST');
    if (result.active !== false) throw new Error('Não foi possível confirmar a desativação. Verifique novamente.');
    active = false;
    failed = false;
    expanded = false;
    clearFreshLink();
    notice('Link desativado. Remova também o calendário assinado do dispositivo.');
  });
  find('[data-apple-retry]').addEventListener('click', () => { void checkStatus(); });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-nav-target="settings"],[data-mobile-target="more"]')) void checkStatus();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/settings') void checkStatus();
  });
  render();
  if (location.hash === '#/settings') void checkStatus();
}
