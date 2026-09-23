const SESSION_KEY = 'debora-lactacao-session';

function assertConfig(config) {
  if (!config?.API_BASE_URL || !config?.CLIENT_RUNTIME_KEY) {
    throw new Error('Configuração do backend incompleta.');
  }
}

function jsonHeaders(config, session, extra = {}) {
  const headers = {
    apikey: config.CLIENT_RUNTIME_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function parseResponse(res) {
  if (res.status === 204) return null;
  if (typeof res.text !== 'function') return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function expiredSessionError() {
  return new Error('Sessão expirada. Entre novamente.');
}

export function createMemorySessionStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); }
  };
}

export function createSupabaseClient(config, {
  fetchImpl = globalThis.fetch?.bind(globalThis),
  sessionStorage = globalThis.localStorage
} = {}) {
  assertConfig(config);
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponível.');
  const storage = sessionStorage || createMemorySessionStorage();
  const base = String(config.API_BASE_URL).replace(/\/$/, '');
  let refreshInFlight = null;

  function getSession() {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { storage.removeItem(SESSION_KEY); return null; }
  }

  function setSession(session) {
    if (!session) storage.removeItem(SESSION_KEY);
    else storage.setItem(SESSION_KEY, JSON.stringify(session));
    // Feature modules still read these aliases. Keep them consistent on refresh/logout.
    for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
      if (!store) continue;
      try {
        for (const key of [SESSION_KEY, 'amamentacao-session', 'commercial.saas.session.v1']) {
          if (session) store.setItem(key, JSON.stringify(session));
          else store.removeItem(key);
        }
        if (session) store.setItem('debora-runtime-access-token', session.access_token);
        else store.removeItem('debora-runtime-access-token');
      } catch { /* Storage restrictions must not turn a successful request into failure. */ }
    }
    globalThis.__deboraAccessToken = session?.access_token || null;
    return session;
  }

  async function authRequest(path, { method = 'POST', body, token = null } = {}) {
    const headers = jsonHeaders(config, token ? { access_token: token } : null);
    const res = await fetchImpl(`${base}/api/auth/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await parseResponse(res);
    if (!res.ok) {
      const error = new Error(data?.msg || data?.message || data?.error || `Falha de autenticação (${res.status}).`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  async function performRefresh() {
    const current = getSession();
    if (!current?.refresh_token) throw new Error('Sessão indisponível para atualização.');
    const session = await authRequest('token?grant_type=refresh_token', {
      body: { refresh_token: current.refresh_token }
    });
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error('Sessão atualizada inválida.');
    }
    if (getSession()?.refresh_token !== current.refresh_token) {
      // A late refresh must not resurrect a session after logout/account change.
      throw new Error('A sessão mudou durante a atualização. Tente novamente.');
    }
    return setSession(session);
  }

  async function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = performRefresh()
      .catch((error) => {
        if ([400, 401, 403].includes(error.status)) setSession(null);
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  }

  async function authenticatedFetch(send) {
    const initial = getSession();
    if (!initial?.access_token) throw expiredSessionError();

    const attemptedAccessToken = initial.access_token;
    let res = await send(initial);
    if (res.status !== 401) return res;

    let current = getSession();
    try {
      // Another request may already have refreshed the session while this request was in flight.
      if (!current?.access_token || current.access_token === attemptedAccessToken) {
        current = await refreshSession();
      }
    } catch (error) {
      if (!getSession()) throw expiredSessionError();
      throw error;
    }

    res = await send(current);
    if (res.status === 401) {
      setSession(null);
      throw expiredSessionError();
    }
    return res;
  }

  async function workerRequest(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const res = await authenticatedFetch((session) => {
      const finalHeaders = { Authorization: `Bearer ${session.access_token}`, ...headers };
      if (!raw && body !== undefined && !finalHeaders['Content-Type']) finalHeaders['Content-Type'] = 'application/json';
      return fetchImpl(path, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
      });
    });
    const data = await parseResponse(res);
    if (!res.ok) {
      const code = data?.error || data?.message || `Falha no serviço (${res.status}).`;
      if (code === 'SAAS_PATIENT_LIMIT_REACHED') throw new Error('Seu plano Freemium permite até 3 mães/pacientes.');
      if (code === 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED') throw new Error('Upload de fotos e vídeos está disponível no plano Pro.');
      throw new Error(code);
    }
    return data;
  }

  async function signInWithPassword(email, password) {
    const session = await authRequest('token?grant_type=password', { body: { email, password } });
    return setSession(session);
  }

  async function signUp(email, password, metadata = { display_name: 'Débora' }) {
    const result = await authRequest('signup', { body: { email, password, data: metadata } });
    if (result?.access_token) setSession(result);
    return result;
  }

  async function signOut() {
    const current = getSession();
    try {
      if (current?.access_token) {
        await authRequest('logout', { method: 'POST', token: current.access_token });
      }
    } finally {
      setSession(null);
    }
  }

  async function rest(table, { method = 'GET', query = '', body, headers = {} } = {}) {
    const suffix = query ? `?${query}` : '';
    const res = await authenticatedFetch((session) => fetchImpl(`${base}/api/clinical/records/${encodeURIComponent(table)}${suffix}`, {
      method,
      headers: jsonHeaders(config, session, headers),
      body: body === undefined ? undefined : JSON.stringify(body)
    }));
    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data?.message || data?.hint || data?.error || `Falha no banco (${res.status}).`);
    return data;
  }

  async function rpc(name, body = {}) {
    const res = await authenticatedFetch((session) => fetchImpl(`${base}/api/clinical/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: jsonHeaders(config, session),
      body: JSON.stringify(body || {})
    }));
    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data?.message || data?.hint || data?.error || `Falha no banco (${res.status}).`);
    return data;
  }

  async function storageRequest(path, { method = 'GET', body, headers = {} } = {}) {
    const normalized = path.replace(/^\//, '');
    const contentType = String(headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
    const proGatedMedia = contentType.startsWith('image/') || contentType.startsWith('video/');
    if (method === 'POST' && normalized.startsWith('object/clinical-media/') && proGatedMedia) {
      const storagePath = normalized.slice('object/clinical-media/'.length);
      return workerRequest(`/api/clinical/media/upload?path=${encodeURIComponent(storagePath).replace(/%2F/g, '/')}`, {
        method: 'POST', body, headers, raw: true
      });
    }
    const res = await authenticatedFetch((session) => fetchImpl(`${base}/api/files/${normalized}`, {
      method,
      headers: {
        apikey: config.CLIENT_RUNTIME_KEY,
        Authorization: `Bearer ${session.access_token}`,
        ...headers
      },
      body
    }));
    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data?.message || data?.error || `Falha no armazenamento (${res.status}).`);
    return data;
  }

  return {
    config,
    getSession,
    setSession,
    signInWithPassword,
    signUp,
    refreshSession,
    signOut,
    rest,
    rpc,
    storageRequest,
    workerRequest
  };
}
