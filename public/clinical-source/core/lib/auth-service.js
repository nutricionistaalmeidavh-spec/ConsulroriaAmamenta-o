export function createAuthService(client) {
  if (!client) throw new Error('Cliente Supabase é obrigatório.');
  return {
    getSession: () => client.getSession(),
    signIn: (email, password) => client.signInWithPassword(String(email || '').trim(), String(password || '')),
    signUp: (email, password) => client.signUp(String(email || '').trim(), String(password || ''), { display_name: 'Débora' }),
    refresh: () => client.refreshSession(),
    signOut: () => client.signOut()
  };
}
