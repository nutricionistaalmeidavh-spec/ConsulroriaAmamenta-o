function rememberSession(session) {
  globalThis.__canonicalAuthSession = session || null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('canonical-auth-session', { detail: session || null }));
  }
  return session;
}

export function createAuthService(client) {
  if (!client) throw new Error('Cliente Supabase é obrigatório.');
  return {
    getSession: () => rememberSession(client.getSession()),
    signIn: async (email, password) => rememberSession(await client.signInWithPassword(String(email || '').trim(), String(password || ''))),
    signUp: async (email, password, metadata = {}) => rememberSession(await client.signUp(String(email || '').trim(), String(password || ''), metadata)),
    refresh: async () => rememberSession(await client.refreshSession()),
    signOut: async () => {
      const result = await client.signOut();
      rememberSession(null);
      return result;
    }
  };
}
