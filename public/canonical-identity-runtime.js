const context = globalThis.CANONICAL_APP_CONTEXT || {};
const config = globalThis.CANONICAL_APP_CONFIG || globalThis.DEBORA_APP_CONFIG || {};
const productName = context.productName || 'Gestão de Amamentação';
const SESSION_KEYS = ['amamentacao-session', 'debora-lactacao-session', 'commercial.saas.session.v1'];

function parseSession(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function readCompatibleSession() {
  for (const key of SESSION_KEYS) {
    const session = parseSession(sessionStorage.getItem(key));
    if (session?.access_token) return session;
  }
  return null;
}

function professionalFallback(user) {
  const metadataName = String(user?.user_metadata?.display_name || user?.user_metadata?.name || '').trim();
  if (metadataName) return metadataName;
  const emailName = String(user?.email || '').split('@')[0].trim();
  return emailName || 'Profissional';
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function applyProductIdentity() {
  if (document.title !== productName) document.title = productName;
  document.querySelectorAll('[data-product-name]').forEach((node) => setText(node, productName));
}

function applyProfessionalIdentity(name) {
  const professionalName = String(name || 'Profissional').trim() || 'Profissional';
  globalThis.CANONICAL_PROFESSIONAL_NAME = professionalName;
  document.querySelectorAll('[data-professional-name]').forEach((node) => setText(node, professionalName));

  const date = document.querySelector('[data-home-date]');
  if (date) {
    const source = String(date.textContent || '').trim();
    const greetingMatch = source.match(/^(Bom dia|Boa tarde|Boa noite|Olá)/i);
    const greeting = greetingMatch?.[1] || 'Olá';
    setText(date, `${greeting}, ${professionalName} ♥`);
  }
}

async function fetchAuthenticatedUser(accessToken) {
  if (!accessToken || !config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) return null;
  try {
    const response = await fetch(`${String(config.SUPABASE_URL).replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        apikey: config.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) return null;
    const user = await response.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function resolveProfessionalIdentity(session) {
  const accessToken = session?.access_token || '';
  let user = session?.user || null;
  if (!user?.id && accessToken) user = await fetchAuthenticatedUser(accessToken);

  const ownerId = user?.id || '';
  const fallback = professionalFallback(user);

  if (!ownerId || !accessToken || !config.SUPABASE_URL || !config.SUPABASE_PUBLISHABLE_KEY) {
    applyProfessionalIdentity(fallback);
    return;
  }

  try {
    const url = `${String(config.SUPABASE_URL).replace(/\/$/, '')}/rest/v1/professional_profiles?select=professional_name,business_name&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`;
    const response = await fetch(url, {
      headers: {
        apikey: config.SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw new Error(`profile ${response.status}`);
    const rows = await response.json();
    const profile = Array.isArray(rows) ? rows[0] : null;
    applyProfessionalIdentity(profile?.professional_name || profile?.business_name || fallback);
  } catch {
    applyProfessionalIdentity(fallback);
  }
}

applyProductIdentity();
applyProfessionalIdentity('Profissional');

const initialSession = globalThis.__canonicalAuthSession || readCompatibleSession();
if (initialSession) resolveProfessionalIdentity(initialSession).catch(() => {});

window.addEventListener('canonical-auth-session', (event) => {
  resolveProfessionalIdentity(event.detail).catch(() => {});
});

const observer = new MutationObserver(() => {
  applyProductIdentity();
  if (globalThis.CANONICAL_PROFESSIONAL_NAME) {
    applyProfessionalIdentity(globalThis.CANONICAL_PROFESSIONAL_NAME);
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
