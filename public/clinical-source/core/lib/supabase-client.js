const SESSION_KEY = 'debora-lactacao-session';

function assertConfig(config) {
  if (!config?.SUPABASE_URL || !config?.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Configuração do Supabase incompleta.');
  }
}

function jsonHeaders(config, session, extra = {}) {
  const headers = {
    apikey: config.SUPABASE_PUBLISHABLE_KEY,
    'Content-Type': 'application/json',
    ...extra
  };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function parseResponse(res) {
  if (res.status === 204) return null;
  const type = res.headers?.get?.('content-type') || '';
  if (type.includes('application/json') && typeof res.json === 'function') return res.json();
  if (typeof res.json === 'function') {
    try { return await res.json(); } catch {}
  }
  if (typeof res.text === 'function') {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  }
  return null;
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
  sessionStorage = globalThis.sessionStorage
} = {}) {
  assertConfig(config);
  if (typeof fetchImpl !== 'function') throw new Error('Fetch indisponível.');
  const storage = sessionStorage || createMemorySessionStorage();
  const base = String(config.SUPABASE_URL).replace(/\/$/, '');

  function getSession() {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { storage.removeItem(SESSION_KEY); return null; }
  }

  function setSession(session) {
    if (!session) storage.removeItem(SESSION_KEY);
    else storage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async function authRequest(path, { method = 'POST', body, token = null } = {}) {
    const headers = jsonHeaders(config, token ? { access_token: token } : null);
    const res = await fetchImpl(`${base}/auth/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data?.msg || data?.message || `Falha de autenticação (${res.status}).`);
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

  async function refreshSession() {
    const current = getSession();
    if (!current?.refresh_token) throw new Error('Sessão indisponível para atualização.');
    const session = await authRequest('token?grant_type=refresh_token', { body: { refresh_token: current.refresh_token } });
    return setSession(session);
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
    const session = getSession();
    const suffix = query ? `?${query}` : '';
    const res = await fetchImpl(`${base}/rest/v1/${encodeURIComponent(table)}${suffix}`, {
      method,
      headers: jsonHeaders(config, session, headers),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await parseResponse(res);
    if (res.status === 401) {
      setSession(null);
      throw new Error('Sessão expirada. Entre novamente.');
    }
    if (!res.ok) throw new Error(data?.message || data?.hint || `Falha no banco (${res.status}).`);
    return data;
  }

  async function rpc(name, body = {}) {
    const session = getSession();
    const res = await fetchImpl(`${base}/rest/v1/rpc/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: jsonHeaders(config, session),
      body: JSON.stringify(body || {})
    });
    const data = await parseResponse(res);
    if (res.status === 401) {
      setSession(null);
      throw new Error('Sessão expirada. Entre novamente.');
    }
    if (!res.ok) throw new Error(data?.message || data?.hint || `Falha no banco (${res.status}).`);
    return data;
  }

  async function storageRequest(path, { method = 'GET', body, headers = {} } = {}) {
    const session = getSession();
    const finalHeaders = {
      apikey: config.SUPABASE_PUBLISHABLE_KEY,
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...headers
    };
    const res = await fetchImpl(`${base}/storage/v1/${path.replace(/^\//, '')}`, { method, headers: finalHeaders, body });
    const data = await parseResponse(res);
    if (res.status === 401) {
      setSession(null);
      throw new Error('Sessão expirada. Entre novamente.');
    }
    if (!res.ok) throw new Error(data?.message || `Falha no armazenamento (${res.status}).`);
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
    storageRequest
  };
}
