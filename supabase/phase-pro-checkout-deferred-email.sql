-- Apply before deploying the deferred-email Edge Functions and commercial Worker.
-- Lookup is server-only; the Edge Function must first verify the password through Auth.
create or replace function public.commercial_pending_user_id(p_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email))
    and email_confirmed_at is null and deleted_at is null
    and (banned_until is null or banned_until < now())
    and raw_user_meta_data->>'signup_source' = 'commercial_saas'
  limit 1;
$$;
revoke all on function public.commercial_pending_user_id(text) from public, anon, authenticated;
grant execute on function public.commercial_pending_user_id(text) to service_role;

-- Only the new flow is indexed, so existing checkout history is preserved.
-- A request with an uncertain provider outcome remains pending and cannot be duplicated.
create unique index if not exists billing_deferred_email_active_owner
on public.billing_checkout_requests(owner_id, provider)
where metadata->>'signup_flow' = 'deferred_email_v2'
  and status in ('pending_provider', 'checkout_created', 'paid');
