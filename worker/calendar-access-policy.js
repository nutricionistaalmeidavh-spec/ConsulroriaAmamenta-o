import { resolveProductAccess } from './product-access-runtime.js';

// This is a separate entitlement for external calendar subscriptions.
// Marketing referral codes and partner-admin permissions never grant it.
function isExplicitPartner(env, user) {
  if (!user?.id || !user?.email) return false;
  if (user.app_metadata?.calendar_partner === true) return true;
  const email = String(user.email).trim().toLowerCase();
  return String(env.CALENDAR_PARTNER_EMAILS || '')
    .split(',').some(value => value.trim().toLowerCase() === email);
}

export async function canUseExternalCalendar(env, user) {
  if (!user?.id || !user?.email) return false;
  if (isExplicitPartner(env, user)) return true;
  const access = await resolveProductAccess(env, user);
  // Trials, freemium and legacy_unmanaged are not paid subscriptions.
  // The licensing service validates expiration and manual Pro grants.
  return access.commercial === true && access.active === true
    && access.status === 'active'
    && /^pro_/.test(String(access.planCode || ''));
}
