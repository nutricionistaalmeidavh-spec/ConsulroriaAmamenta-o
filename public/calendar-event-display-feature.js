// One optional preference shared by the existing Google, Apple and Outlook cards.
// This is a display-only enhancement: no new account linking, tokens or data model.
const calendarSettings = document.querySelector('[data-screen="settings"]');
if (calendarSettings) {
  const providers = [
    { selector: '[data-apple-calendar-integration]', after: '[data-apple-description]' },
    { selector: '[data-outlook-calendar-integration]', after: '[data-outlook-description]' },
    { selector: '[data-google-calendar-integrations]', after: '[data-calendar-status]' },
  ];

  if (!document.getElementById('calendar-display-inline-style')) {
    const style = document.createElement('style');
    style.id = 'calendar-display-inline-style';
    style.textContent = [
      '.calendar-display-inline{display:grid;gap:5px;margin:4px 0 2px}',
      '.calendar-display-inline-label{display:flex;align-items:center;gap:9px;font-size:.87rem;font-weight:600;line-height:1.35;cursor:pointer;color:var(--lac-ink,#453c44)}',
      '.calendar-display-inline-label input{width:17px;height:17px;flex:none;accent-color:var(--lac-rose,#a36582);cursor:pointer}',
      '.calendar-display-inline-label input:disabled{cursor:wait}',
      '.calendar-display-inline-hint{margin:0 0 0 26px;font-size:.77rem;line-height:1.45;color:var(--ui-text-secondary,#71666f)}',
      '.calendar-display-inline-status{margin:0 0 0 26px;font-size:.77rem;line-height:1.35;color:var(--lac-rose,#a36582)}',
      '.calendar-display-inline-status[hidden]{display:none}',
    ].join('');
    document.head.append(style);
  }

  function token() {
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
      for (const key of ['debora-lactacao-session', 'amamentacao-session']) {
        try {
          const session = JSON.parse(store?.getItem(key) || 'null');
          if (session?.access_token) return session.access_token;
        } catch { /* Browser storage unavailable. */ }
      }
    }
    return globalThis.__deboraAccessToken || '';
  }

  let activeToken = '';
  let loaded = false;
  let saving = false;
  let fetching = false;
  let showPatientName = false;
  let currentMessage = '';

  function allPanels() {
    return calendarSettings.querySelectorAll('[data-calendar-display-panel]');
  }

  function render() {
    for (const panel of allPanels()) {
      const checkbox = panel.querySelector('[data-calendar-display-inline]');
      checkbox.checked = showPatientName;
      checkbox.disabled = !loaded || saving || fetching;
      const notice = panel.querySelector('[data-calendar-display-status]');
      // Avoid MutationObserver loops: unchanged text must not mutate the DOM.
      if (notice.textContent !== currentMessage) notice.textContent = currentMessage;
      notice.hidden = !currentMessage;
    }
  }

  function mount() {
    for (const provider of providers) {
      const card = calendarSettings.querySelector(provider.selector);
      if (!card || card.querySelector('[data-calendar-display-panel]')) continue;
      const panel = document.createElement('div');
      panel.className = 'calendar-display-inline';
      panel.dataset.calendarDisplayPanel = 'true';
      panel.innerHTML = [
        '<label class="calendar-display-inline-label">',
        '<input type="checkbox" data-calendar-display-inline disabled>',
        '<span>Mostrar nome da mãe no evento</span>',
        '</label>',
        '<p class="calendar-display-inline-hint">Ex.: Consulta — Mariana. Vale para todas as agendas; use com autorização da mãe.</p>',
        '<p class="calendar-display-inline-status" data-calendar-display-status role="status" aria-live="polite" hidden></p>',
      ].join('');
      const anchor = card.querySelector(provider.after);
      if (anchor) anchor.after(panel);
      else card.append(panel);
    }
    render();
  }

  async function request(method = 'GET', body, bearer = token()) {
    if (!bearer) throw new Error('Entre em sua conta para ajustar a agenda.');
    const response = await fetch('/api/calendar/display-preferences', {
      method,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + bearer,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error('Não foi possível salvar. Tente novamente.');
    return response.json();
  }

  async function refresh() {
    mount();
    const bearer = token();
    if (!bearer) {
      activeToken = '';
      loaded = false;
      currentMessage = '';
      render();
      return;
    }
    if (fetching || saving) return;
    fetching = true;
    loaded = false;
    currentMessage = '';
    render();
    try {
      const result = await request('GET', undefined, bearer);
      if (token() !== bearer) return;
      activeToken = bearer;
      showPatientName = result.show_patient_name === true;
      loaded = true;
    } catch {
      currentMessage = 'Não foi possível carregar. Abra Configurações novamente.';
    } finally {
      fetching = false;
      render();
    }
  }

  async function syncGoogle(bearer) {
    // Only the already-connected Google pilot is affected; Apple and Outlook
    // read the updated ICS feed on their own periodic refresh.
    const google = calendarSettings.querySelector('[data-google-calendar-integrations]');
    if (!google || google.querySelector('[data-calendar-connected]')?.hidden !== false) return;
    try {
      const res = await fetch('/api/calendar/google/sync', {
        method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + bearer },
      });
      if (!res.ok && token() === bearer) {
        currentMessage = 'Salvo. Se necessário, use Sincronizar novamente no Google.';
        render();
      }
    } catch {
      if (token() === bearer) {
        currentMessage = 'Salvo. Se necessário, use Sincronizar novamente no Google.';
        render();
      }
    }
  }

  calendarSettings.addEventListener('change', async event => {
    const checkbox = event.target.closest('[data-calendar-display-inline]');
    if (!checkbox || !loaded || saving) return;
    const bearer = token();
    if (!bearer || activeToken !== bearer) {
      await refresh();
      return;
    }
    const before = showPatientName;
    const next = checkbox.checked;
    if (next === before) return;
    saving = true;
    showPatientName = next;
    currentMessage = '';
    render();
    try {
      // Ticking the clearly worded checkbox is the explicit authorization:
      // the name becomes visible in external calendar services.
      const response = await request('POST', {
        show_patient_name: next,
        acknowledged_external_visibility: next,
      }, bearer);
      if (token() !== bearer) return;
      showPatientName = response.show_patient_name === true;
      currentMessage = 'Salvo. As agendas serão atualizadas.';
      void syncGoogle(bearer);
    } catch {
      showPatientName = before;
      currentMessage = 'Não foi possível salvar. Tente novamente.';
    } finally {
      saving = false;
      render();
    }
  });

  // Google mounts asynchronously after the logged-in professional passes its
  // eligibility check. Attach the same checkbox without waiting for a reload.
  let mountQueued = false;
  const observer = new MutationObserver(() => {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(() => {
      mountQueued = false;
      mount();
    });
  });
  observer.observe(calendarSettings, { childList: true, subtree: true });
  mount();

  document.addEventListener('click', event => {
    if (event.target.closest('[data-nav-target="settings"],[data-mobile-target="more"]')) void refresh();
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/settings') void refresh();
  });
  if (location.hash === '#/settings') void refresh();
}
