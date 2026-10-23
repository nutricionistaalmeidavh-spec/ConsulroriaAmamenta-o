// Additive integration panel; does not modify the canonical agenda.
const container = document.querySelector('[data-screen="settings"]');
if (container && !container.querySelector('[data-calendar-integrations]')) {
  const card = document.createElement('article');
  card.className = 'detail-card';
  card.dataset.calendarIntegrations = 'true';
  card.innerHTML = [
    '<div class="section-heading"><div><span class="section-kicker">AGENDA</span>',
    '<h2>Integrações de calendário</h2><p>Sincronize seus horários sem compartilhar prontuários ou informações das pacientes.</p></div></div>',
    '<div style="display:grid;gap:12px;margin-top:14px">',
    '<label class="field" style="display:grid;gap:6px"><span>Calendário de destino</span>',
    '<select data-calendar-provider><option value="google">Google Agenda</option><option value="apple">Apple Calendário</option></select></label>',
    '<div data-calendar-status role="status" aria-live="polite">Consultando sua conexão…</div>',
    '<div data-calendar-google>',
    '<div data-calendar-connected hidden>',
    '<label class="field" style="display:grid;gap:6px"><span>Agenda do Google</span>',
    '<select data-calendar-list><option value="">Selecione uma agenda</option></select></label>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">',
    '<button type="button" class="ui-button ui-button-primary" data-calendar-select>Salvar agenda e sincronizar</button>',
    '<button type="button" class="ui-button ui-button-ghost" data-calendar-sync>Sincronizar novamente</button>',
    '<button type="button" class="ui-button ui-button-ghost" data-calendar-disconnect>Desconectar</button>',
    '</div></div>',
    '<div data-calendar-connect-wrapper hidden>',
    '<button type="button" class="ui-button ui-button-primary" data-calendar-connect>Conectar Google Agenda</button>',
    '</div>',
    '</div>',
    '<div data-calendar-apple hidden>',
    '<p>Assine seus horários no Apple Calendário sem usar sua senha do iCloud. Atualizações aparecem periodicamente, conforme o aplicativo da Apple.</p>',
    '<p style="font-size:.86rem;opacity:.8">A agenda assinada é somente leitura. Qualquer pessoa com o link poderá ver os horários genéricos, sem nomes nem prontuários. Guarde o link em segurança.</p>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">',
    '<button type="button" class="ui-button ui-button-primary" data-apple-create>Gerar link de assinatura</button>',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-revoke hidden>Revogar link</button>',
    '</div>',
    '<div data-apple-subscription hidden style="display:grid;gap:9px;margin-top:12px">',
    '<label class="field" style="display:grid;gap:5px"><span>Seu link privado de assinatura</span>',
    '<input type="text" data-apple-url readonly autocomplete="off" spellcheck="false" aria-label="Link privado da assinatura Apple"></label>',
    '<div style="display:flex;gap:8px;flex-wrap:wrap">',
    '<a class="ui-button ui-button-primary" data-apple-open href="#">Abrir no Apple Calendário</a>',
    '<button type="button" class="ui-button ui-button-ghost" data-apple-copy>Copiar link</button>',
    '</div>',
    '</div>',
    '</div>',
    '<div style="border-top:1px solid #eee;padding-top:12px">',
    '<button type="button" class="ui-button ui-button-ghost" data-calendar-ics>Exportar agenda (.ics)</button>',
    '<p style="font-size:.86rem;opacity:.78;margin:5px 0 0">Compatível com Google Agenda, Outlook e Apple Calendário. O arquivo é uma cópia, não sincronização contínua.</p>',
    '</div></div>'
  ].join('');
  const settingsList = container.querySelector('.settings-list');
  if (settingsList) settingsList.before(card); else container.append(card);

  const find = selector => card.querySelector(selector);
  const notice = (message, error = false) => {
    const box = find('[data-calendar-status]');
    box.textContent = message;
    box.style.color = error ? '#a02449' : '';
  };
  const action = (selector, handler) => card.querySelector(selector)?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await handler(); } catch (err) { notice(err.message || 'Não foi possível concluir.', true); }
    finally { button.disabled = false; }
  });
  function sessionToken() {
    // The canonical clinical client prioritizes localStorage, then mirrors the
    // refreshed access token into sessionStorage and the global runtime.
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of ['debora-lactacao-session', 'amamentacao-session']) {
        try {
          const session = JSON.parse(storage.getItem(key) || 'null');
          if (session?.access_token) return session.access_token;
        } catch { /* Invalid or disabled browser storage ignored. */ }
      }
    }
    return globalThis.__deboraAccessToken || '';
  }
  async function request(path, { method = 'GET', body, binary = false } = {}) {
    const token = sessionToken();
    if (!token) throw new Error('Entre na sua conta antes de utilizar as integrações.');
    const response = await fetch(path, {
      method, cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (binary && response.ok) return response.blob();
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        cloudflare_auth_required: 'Sessão expirada. Entre novamente.',
        google_calendar_not_configured: 'Integração Google ainda não configurada pelo administrador.',
        google_calendar_reconnect_required: 'O Google solicitou nova autorização. Reconecte sua conta.',
        calendar_integration_unavailable: 'O serviço de calendário está indisponível. Tente novamente.',
      };
      throw new Error(messages[data.error] || data.error || 'Não foi possível comunicar com o calendário.');
    }
    return data;
  }
  const providerSelect = find('[data-calendar-provider]');
  try {
    const saved = localStorage.getItem('gestao-calendar-provider-v1');
    if (saved === 'apple') providerSelect.value = 'apple';
  } catch { /* no persistence needed */ }
  providerSelect.addEventListener('change', () => {
    try { localStorage.setItem('gestao-calendar-provider-v1', providerSelect.value); } catch {}
    refresh();
  });
  let busy = false;
  async function refresh() {
    if (!sessionToken() || busy) return;
    busy = true;
    try {
      const apple = providerSelect.value === 'apple';
      find('[data-calendar-google]').hidden = apple;
      find('[data-calendar-apple]').hidden = !apple;
      if (apple) {
        const status = await request('/api/calendar/apple/status');
        find('[data-apple-revoke]').hidden = !status.active;
        find('[data-apple-create]').textContent = status.active
          ? 'Gerar novo link (revoga o anterior)' : 'Gerar link de assinatura';
        notice(status.active
          ? 'Assinatura Apple ativa. As mudanças são consultadas periodicamente pelo Apple Calendário.'
          : 'Apple Calendário ainda não vinculado. Gere um link privado para começar.');
        return;
      }
      const status = await request('/api/calendar/google/status');
      find('[data-calendar-connected]').hidden = !status.connected;
      find('[data-calendar-connect-wrapper]').hidden = status.connected || !status.configured;
      if (!status.configured) {
        notice('Google Agenda aguarda configuração do administrador. A exportação .ics está disponível.');
        return;
      }
      if (!status.connected) {
        notice('Nenhuma conta Google conectada.');
        return;
      }
      notice(status.calendar_id ? 'Google Agenda conectado. Os agendamentos são sincronizados automaticamente.' :
        'Google conectado. Selecione a agenda que receberá os atendimentos.');
      const calendars = await request('/api/calendar/google/calendars');
      const select = find('[data-calendar-list]');
      select.replaceChildren(new Option('Selecione uma agenda', ''));
      for (const item of calendars.calendars || []) {
        const option = new Option(item.summary || item.id, item.id);
        select.add(option);
      }
      select.value = status.calendar_id || '';
    } catch (err) {
      notice(err.message || 'Não foi possível carregar a integração.', true);
    } finally { busy = false; }
  }
  action('[data-apple-create]', async () => {
    const existing = await request('/api/calendar/apple/status');
    if (existing.active && !window.confirm('Gerar um novo link? A assinatura anterior deixará de atualizar.')) return;
    const result = await request('/api/calendar/apple/create', { method: 'POST' });
    const url = new URL(result.subscription_url);
    if (url.protocol !== 'https:' || url.hostname !== 'deboralactacao.com' ||
        !/^\/api\/calendar\/apple\/feed\/[a-f0-9]{64}\.ics$/.test(url.pathname)) {
      throw new Error('O link privado retornado é inválido.');
    }
    find('[data-apple-url]').value = result.subscription_url;
    find('[data-apple-open]').href = result.webcal_url;
    find('[data-apple-subscription]').hidden = false;
    await refresh();
    notice('Link de assinatura Apple criado. Abra ou copie para adicionar no Calendário do iPhone/Mac.');
  });
  action('[data-apple-copy]', async () => {
    const link = find('[data-apple-url]').value;
    if (!link) throw new Error('Gere primeiro seu link de assinatura.');
    if (!navigator.clipboard?.writeText) throw new Error('Selecione e copie manualmente o link exibido acima.');
    await navigator.clipboard.writeText(link);
    notice('Link privado copiado. Não compartilhe com outras pessoas.');
  });
  action('[data-apple-revoke]', async () => {
    if (!window.confirm('Revogar a assinatura Apple? O link antigo deixará de funcionar.')) return;
    await request('/api/calendar/apple/revoke', { method: 'POST' });
    find('[data-apple-url]').value = '';
    find('[data-apple-open]').removeAttribute('href');
    find('[data-apple-subscription]').hidden = true;
    await refresh();
    notice('Assinatura Apple revogada. Se necessário, remova também o calendário assinado no iPhone.');
  });
  action('[data-calendar-connect]', async () => {
    const response = await request('/api/calendar/google/connect', { method: 'POST' });
    if (!response.authorization_url?.startsWith('https://accounts.google.com/')) {
      throw new Error('URL de autorização inválida.');
    }
    location.assign(response.authorization_url);
  });
  action('[data-calendar-select]', async () => {
    const id = find('[data-calendar-list]').value;
    if (!id) throw new Error('Selecione uma agenda.');
    await request('/api/calendar/google/select', { method: 'POST', body: { calendar_id: id } });
    const result = await request('/api/calendar/google/sync', { method: 'POST' });
    notice('Agenda vinculada. ' + result.synced + ' agendamento(s) processado(s).');
  });
  action('[data-calendar-sync]', async () => {
    const result = await request('/api/calendar/google/sync', { method: 'POST' });
    notice('Sincronização concluída: ' + result.synced + ' agendamento(s).');
  });
  action('[data-calendar-disconnect]', async () => {
    if (!window.confirm('Desconectar Google Agenda e remover do Google os compromissos sincronizados pelo sistema?')) return;
    await request('/api/calendar/google/disconnect', { method: 'POST' });
    await refresh();
    notice('Google Agenda desconectado.');
  });
  action('[data-calendar-ics]', async () => {
    const blob = await request('/api/calendar/appointments.ics', { binary: true });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'agenda-gestao-amamentacao.ics';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 500);
    notice('Arquivo .ics exportado. Não contém dados clínicos das pacientes.');
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-nav-target="settings"],[data-mobile-target="more"]')) {
      setTimeout(refresh, 80);
    }
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/settings') refresh();
  });
  if (location.hash === '#/settings') refresh();
}
