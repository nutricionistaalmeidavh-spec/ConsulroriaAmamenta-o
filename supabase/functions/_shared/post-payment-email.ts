// This helper never trusts a checkout redirect or a browser-supplied payment status.
export async function sendPaidConfirmation(url: string, key: string, ownerId: string) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const paidResponse = await fetch(`${url}/rest/v1/billing_checkout_requests?owner_id=eq.${encodeURIComponent(ownerId)}&provider=eq.asaas&status=eq.paid&select=plan_code&limit=1`, { headers });
  const paid = await paidResponse.json().catch(() => []);
  if (!paidResponse.ok) return { ok: false, status: 'payment_lookup_failed' };
  if (!Array.isArray(paid) || !paid.length) return { ok: true, status: 'awaiting_payment' };
  const userResponse = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`, { headers });
  const user = await userResponse.json().catch(() => null);
  if (!userResponse.ok || !user?.email) return { ok: false, status: 'user_lookup_failed' };
  if (user.email_confirmed_at) return { ok: true, status: 'email_confirmed' };
  if (!user.app_metadata?.checkout_email_after_payment) return { ok: true, status: 'legacy_confirmation' };
  if (user.app_metadata?.checkout_confirmation_sent_at) return { ok: true, status: 'email_sent' };
  const redirect = 'https://consulroriaamamenta-o.nutricionistaalmeidavh.workers.dev/comercial/index.html?confirmed=1&plan=' + encodeURIComponent(paid[0].plan_code);
  const sent = await fetch(`${url}/auth/v1/resend?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST', headers, body: JSON.stringify({ type: 'signup', email: user.email }),
  });
  if (!sent.ok) return { ok: false, status: 'email_delivery_pending' };
  const saved = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ app_metadata: { ...user.app_metadata, checkout_confirmation_sent_at: new Date().toISOString() } }),
  });
  return { ok: saved.ok, status: saved.ok ? 'email_sent' : 'email_delivery_pending' };
}
