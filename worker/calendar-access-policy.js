import { resolveProductAccess } from './product-access-runtime.js';

// Calendar eligibility is decided by the Central Artisys license authority.
// It derives the exception for partners from the existing manual_license_sales
// acquisition_channel='partnership', linked to an active professional license.
// Referral coupons, metadata and local email allowlists cannot grant access.
export async function canUseExternalCalendar(env, user) {
  if (!user?.id || !user?.email) return false;
  const access = await resolveProductAccess(env, user);
  return access.commercial === true && access.active === true
    && access.status === 'active'
    && /^pro_/.test(String(access.planCode || ''))
    && access.calendarAccess === true;
}
