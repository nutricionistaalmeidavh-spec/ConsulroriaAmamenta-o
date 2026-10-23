// Apple-only calendar settings. Google OAuth is intentionally not part of this release.
const container = document.querySelector('[data-screen="settings"]');
if (container && !container.querySelector('[data-apple-calendar-integration]')) {
  const card = document.createElement('article');
  card.className = 'detail-card';
  card.dataset.appleCalendarIntegration = 'true';
  card.innerHTML = [
    '<div class="section-heading"><div><span class="section-kicker">AGENDA</span>',
    '<h2>Apple Calendário</h2>',
    '<p>Receba automaticamente seus compromissos no Calendário do iPhone ou Mac.</p></div></div>',
    '<div style="display:grid;gap:12px;margin-top:14px">',
    '<p style="font-size:.9rem;margin:0">A conexão é feita uma única vez, por assinatura privada. As atualizações aparecem periodicamente conforme o Apple Calendário — não são instantâneas.</p>',
    '<div data-apple-status role="status" aria-live="polite">Verificando sua assinatura…</div>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">',
    '<button type="button" class="ui-button ui-button-primary" data-apple-create>Conectar Apple Calendário</button>',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-revoke hidden>Revogar assinatura</button>',
    '</div>',
    '<div data-apple-subscription hidden style="display:grid;gap:8px">',
    '<label class="field" style="display:grid;gap:6px"><span>Link de assinatura privado</span>',
    '<input type="text" data-apple-url readonly spellcheck="false" autocomplete="off" aria-label="Link de assinatura Apple Calendário"></label>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">',
    '<a class="ui-button ui-button-primary" data-apple-open href="#">Abrir no Apple Calendário</a>',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-copy>Copiar link</button></div>',
    '</div>',
    '<p style="font-size:.84rem;opacity:.8;margin:0">O link permite consultar somente horários e duração de atendimentos, sem nomes ou dados clínicos. Trate-o como uma senha. Calendários assinados são somente leitura.</p>',
    '</div>',
  ].join('');
  const list = container.querySelector('.settings-list');
  if (list) list.before(card); else container.append(card);

  const find = selector => card.querySelector(selector);
  function notice(message, failed = false) {
    const node = find('[data-apple-status]');
    node.textContent = message;
    node.style.color = failed ? '#a02449' : '';
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
      : 'Falha ao consultar o Apple Calendário. Tente novamente.');
    return data;
  }
  function action(selector, handler) {
    find(selector).addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try { await handler(); } catch (error) { notice(error.message || 'Não foi possível concluir.', true); }
      finally { button.disabled = false; }
    });
  }
  let loading = false;
  async function refresh() {
    if (loading || !token()) return;
    loading = true;
    try {
      const status = await api('/api/calendar/apple/status');
      find('[data-apple-revoke]').hidden = !status.active;
      find('[data-apple-create]').textContent = status.active
        ? 'Gerar novo link (revoga o anterior)' : 'Conectar Apple Calendário';
      notice(status.active
        ? 'Assinatura ativa. Seus agendamentos são atualizados periodicamente no Apple Calendário.'
        : 'Sua agenda ainda não foi conectada ao Apple Calendário.');
    } catch (error) {
      notice(error.message || 'Não foi possível consultar a assinatura.', true);
    } finally { loading = false; }
  }
  action('[data-apple-create]', async () => {
    const status = await api('/api/calendar/apple/status');
    if (status.active && !window.confirm('Gerar outro link invalida imediatamente a assinatura anterior. Continuar?')) return;
    const result = await api('/api/calendar/apple/create', 'POST');
    const url = new URL(result.subscription_url);
    if (url.protocol !== 'https:' || url.hostname !== 'deboralactacao.com'
        || !/^\/api\/calendar\/apple\/feed\/[a-f0-9]{64}\.ics$/.test(url.pathname)) {
      throw new Error('Link de assinatura inválido.');
    }
    find('[data-apple-url]').value = url.href;
    find('[data-apple-open]').href = result.webcal_url;
    find('[data-apple-subscription]').hidden = false;
    await refresh();
    notice('Link criado. Toque em "Abrir no Apple Calendário" para confirmar a assinatura uma única vez.');
  });
  action('[data-apple-copy]', async () => {
    const url = find('[data-apple-url]').value;
    if (!url) throw new Error('Gere seu link primeiro.');
    await navigator.clipboard.writeText(url);
    notice('Link copiado. Não o compartilhe.');
  });
  action('[data-apple-revoke]', async () => {
    if (!window.confirm('Revogar acesso da assinatura? O link anterior deixará de atualizar.')) return;
    await api('/api/calendar/apple/revoke', 'POST');
    find('[data-apple-url]').value = '';
    find('[data-apple-open]').removeAttribute('href');
    find('[data-apple-subscription]').hidden = true;
    await refresh();
    notice('Assinatura revogada. Remova também o calendário assinado do seu dispositivo.');
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-nav-target="settings"],[data-mobile-target="more"]')) void refresh();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/settings') void refresh();
  });
  if (location.hash === '#/settings') void refresh();
}
