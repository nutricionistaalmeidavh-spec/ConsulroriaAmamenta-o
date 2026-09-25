const SESSION_KEYS = ['amamentacao-session', 'debora-lactacao-session', 'commercial.saas.session.v1'];
let token = '';

function parse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function readToken() {
  for (const store of [localStorage, sessionStorage]) {
    for (const key of SESSION_KEYS) {
      const session = parse(store.getItem(key));
      if (session?.access_token) return session.access_token;
    }
  }
  return '';
}

async function heartbeat() {
  if (document.visibilityState === 'hidden') return;
  const current = token || readToken();
  if (!current) return;
  try {
    await fetch('/api/presence/heartbeat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${current}` },
      cache: 'no-store',
    });
  } catch {
    // Telemetry is best-effort and must never affect the application UX.
  }
}

function refreshToken(session) {
  token = session?.access_token || readToken();
  void heartbeat();
}

token = readToken();
void heartbeat();
setInterval(() => { void heartbeat(); }, 60000);
window.addEventListener('canonical-auth-session', (event) => refreshToken(event.detail));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void heartbeat();
});
