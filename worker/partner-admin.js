export const PARTNER_ADMIN_EMAILS_CONFIG = 'PARTNER_ADMIN_EMAILS';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Z0-9_-]{2,64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SALE_STATUSES = new Set(['captured', 'checkout_created', 'paid', 'cancelled', 'refunded', 'chargeback']);
const COMMISSION_STATUSES = new Set(['none', 'pending', 'approved', 'cancelled', 'reversed']);
const PLAN_CODES = new Set(['pro_monthly', 'pro_annual']);

function allowedAdminEmails(env) {
  return new Set(String(env[PARTNER_ADMIN_EMAILS_CONFIG] || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean));
}

async function requireAdmin(request, env, authenticateUser) {
  const user = await authenticateUser(request);
  if (!user?.email) return null;
  if (user?.app_metadata?.partner_admin === true) return user;
  return allowedAdminEmails(env).has(String(user.email).trim().toLowerCase()) ? user : null;
}

function normalizePartner(input) {
  const name = String(input?.name || '').trim();
  const code = String(input?.code || '').trim().toUpperCase();
  const partnerType = String(input?.partnerType || 'partner');
  const commissionType = String(input?.commissionType || 'none');
  const discountType = String(input?.discountType || 'none');
  const commissionValue = Number(input?.commissionValue || 0);
  const discountValue = Number(input?.discountValue || 0);
  const active = input?.active !== false;

  if (name.length < 2 || name.length > 160) return { error: 'invalid_partner_name' };
  if (!CODE_RE.test(code)) return { error: 'invalid_partner_code' };
  if (!['partner', 'influencer', 'campaign'].includes(partnerType)) return { error: 'invalid_partner_type' };
  if (!['none', 'percent', 'fixed'].includes(commissionType)) return { error: 'invalid_commission_type' };
  if (!['none', 'percent', 'fixed'].includes(discountType)) return { error: 'invalid_discount_type' };
  if (!Number.isFinite(commissionValue) || commissionValue < 0 || (commissionType === 'percent' && commissionValue > 100)) {
    return { error: 'invalid_commission_value' };
  }
  if (!Number.isFinite(discountValue) || discountValue < 0 || (discountType === 'percent' && discountValue > 100)) {
    return { error: 'invalid_discount_value' };
  }

  return {
    value: {
      name,
      code,
      partner_type: partnerType,
      active,
      commission_type: commissionType,
      commission_value: commissionValue,
      discount_type: discountType,
      discount_value: discountValue,
      updated_at: new Date().toISOString(),
    },
  };
}

function dateBoundary(value, endOfDay = false) {
  const raw = String(value || '');
  if (!raw) return '';
  if (!ISO_DATE_RE.test(raw)) return null;
  return `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
}

export async function handlePartnerAdminRequest(request, env, url, helpers) {
  const { authenticateUser, serviceFetch, json } = helpers;
  const admin = await requireAdmin(request, env, authenticateUser);
  if (!admin) return json(403, { error: 'partner_admin_forbidden' });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: 'partner_admin_not_configured' });

  if (url.pathname === '/api/admin/partners' && request.method === 'GET') {
    const { response, payload } = await serviceFetch(env,
      '/rest/v1/partners?select=id,name,code,partner_type,active,commission_type,commission_value,discount_type,discount_value,created_at,updated_at&order=created_at.desc');
    if (!response?.ok) return json(response?.status || 502, { error: 'partner_list_failed' });
    return json(200, { partners: Array.isArray(payload) ? payload : [] });
  }

  if (url.pathname === '/api/admin/partners' && request.method === 'POST') {
    const input = await request.json().catch(() => null);
    const normalized = normalizePartner(input);
    if (normalized.error) return json(400, { error: normalized.error });
    const id = String(input?.id || '');
    const isUpdate = Boolean(id);
    if (isUpdate && !UUID_RE.test(id)) return json(400, { error: 'invalid_partner_id' });

    const path = isUpdate
      ? `/rest/v1/partners?id=eq.${encodeURIComponent(id)}&select=*`
      : '/rest/v1/partners?select=*';
    const { response, payload } = await serviceFetch(env, path, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(normalized.value),
    });
    if (!response?.ok) {
      return json(response?.status || 502, {
        error: response?.status === 409 ? 'partner_code_conflict' : 'partner_save_failed',
      });
    }
    const row = Array.isArray(payload) ? payload[0] || null : payload;
    return json(isUpdate ? 200 : 201, { partner: row });
  }

  if (url.pathname === '/api/admin/partner-sales' && request.method === 'GET') {
    const partnerId = String(url.searchParams.get('partnerId') || '');
    const planCode = String(url.searchParams.get('planCode') || '');
    const status = String(url.searchParams.get('status') || '');
    const commissionStatus = String(url.searchParams.get('commissionStatus') || '');
    const from = dateBoundary(url.searchParams.get('from'), false);
    const to = dateBoundary(url.searchParams.get('to'), true);
    if (partnerId && !UUID_RE.test(partnerId)) return json(400, { error: 'invalid_partner_id' });
    if (planCode && !PLAN_CODES.has(planCode)) return json(400, { error: 'invalid_plan_filter' });
    if (status && !SALE_STATUSES.has(status)) return json(400, { error: 'invalid_status_filter' });
    if (commissionStatus && !COMMISSION_STATUSES.has(commissionStatus)) return json(400, { error: 'invalid_commission_status_filter' });
    if (from === null || to === null) return json(400, { error: 'invalid_date_filter' });

    let path = '/rest/v1/partner_attributions?select=id,partner_id,checkout_request_id,owner_id,plan_code,partner_code_snapshot,attribution_source,status,subtotal_cents,discount_cents,total_cents,commission_cents,commission_status,provider_status,paid_at,commission_approved_at,created_at,partners(name,code)&order=created_at.desc&limit=500';
    if (partnerId) path += `&partner_id=eq.${encodeURIComponent(partnerId)}`;
    if (planCode) path += `&plan_code=eq.${encodeURIComponent(planCode)}`;
    if (status) path += `&status=eq.${encodeURIComponent(status)}`;
    if (commissionStatus) path += `&commission_status=eq.${encodeURIComponent(commissionStatus)}`;
    if (from) path += `&created_at=gte.${encodeURIComponent(from)}`;
    if (to) path += `&created_at=lte.${encodeURIComponent(to)}`;

    const { response, payload } = await serviceFetch(env, path);
    if (!response?.ok) return json(response?.status || 502, { error: 'partner_sales_failed' });
    const sales = Array.isArray(payload) ? payload : [];
    const summary = sales.reduce((acc, sale) => {
      acc.attributions += 1;
      if (sale.status === 'paid') {
        acc.paidSales += 1;
        acc.revenueCents += Number(sale.total_cents || 0);
      }
      acc.discountCents += Number(sale.discount_cents || 0);
      if (sale.commission_status === 'pending') acc.pendingCommissionCents += Number(sale.commission_cents || 0);
      if (sale.commission_status === 'approved') acc.approvedCommissionCents += Number(sale.commission_cents || 0);
      if (sale.commission_status === 'reversed') acc.reversedCommissionCents += Number(sale.commission_cents || 0);
      return acc;
    }, {
      attributions: 0,
      paidSales: 0,
      revenueCents: 0,
      discountCents: 0,
      pendingCommissionCents: 0,
      approvedCommissionCents: 0,
      reversedCommissionCents: 0,
    });
    return json(200, { summary, sales });
  }

  if (url.pathname === '/api/admin/partner-commission' && request.method === 'POST') {
    const input = await request.json().catch(() => null);
    const attributionId = String(input?.attributionId || '');
    if (!UUID_RE.test(attributionId)) return json(400, { error: 'invalid_attribution_id' });
    const { response, payload } = await serviceFetch(env, '/rest/v1/rpc/approve_partner_commission', {
      method: 'POST',
      body: JSON.stringify({ p_attribution_id: attributionId, p_actor: admin.email }),
    });
    if (!response?.ok) return json(response?.status || 409, { error: 'commission_approval_failed', details: payload || undefined });
    return json(200, { status: 'approved', attributionId });
  }

  return json(404, { error: 'not_found' });
}
