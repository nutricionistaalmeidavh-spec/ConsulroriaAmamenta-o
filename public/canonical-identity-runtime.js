const context = globalThis.CANONICAL_APP_CONTEXT || {};
const config = globalThis.CANONICAL_APP_CONFIG || globalThis.DEBORA_APP_CONFIG || {};
const productName = context.productName || config.APP_NAME || 'Gestão de Amamentação';

function professionalFallback(user) {
  const metadataName = String(user?.user_metadata?.display_name || user?.user_metadata?.name || '').trim();
  if (metadataName) return metadataName;
  const emailName = String(user?.email || '').split('@')[0].trim();
  return emailName || 'Profissional';
}

function applyProductIdentity() {
  document.title = productName;
  document.querySelectorAll('[data-product-name]').forEach((node) => { node.textContent = productName; });
}

function applyProfessionalIdentity(name) {
  const professionalName = String(name || 'Profissional').trim() || 'Profissional';
  globalThis.CANONICAL_PROFESSIONAL_NAME = professionalName;
  document.querySelectorAll('[data-professional-name]').forEach((node) => { node.textContent = professionalName; });

  const date = document.querySelector('[data-home-date]');
  if (date) {
    const current = String(date.textContent || '').replace(/,\s*[^♥]+(?=\s*♥?$)/, '').trim();
    const greeting = current.replace(/\s*♥$/, '') || 'Olá';
    date.textContent = `${greeting}, ${professionalName} ♥`;
  }
}

async function resolveProfessionalIdentity(session) {
  const user = session?.user || null;
  const accessToken = session?.access_token || '';
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

window.addEventListener('canonical-auth-session', (event) => {
  resolveProfessionalIdentity(event.detail).catch(() => {});
});

if (globalThis.__canonicalAuthSession) {
  resolveProfessionalIdentity(globalThis.__canonicalAuthSession).catch(() => {});
}

const observer = new MutationObserver(() => {
  applyProductIdentity();
  if (globalThis.CANONICAL_PROFESSIONAL_NAME) applyProfessionalIdentity(globalThis.CANONICAL_PROFESSIONAL_NAME);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
