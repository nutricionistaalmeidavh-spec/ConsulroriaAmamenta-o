-- Manual six-month Pro licensing for external marketplaces.
-- Additive to the existing SaaS billing model; existing checkout providers remain unchanged.

alter table public.billing_plan_catalog
  drop constraint if exists billing_plan_catalog_billing_interval_check;

alter table public.billing_plan_catalog
  add constraint billing_plan_catalog_billing_interval_check
  check (billing_interval in ('free', 'monthly', 'semiannual', 'annual'));

insert into public.billing_plan_catalog (
  plan_code, display_name, billing_interval, price_cents, currency, installment_max, active, features
) values (
  'pro_6m',
  'Pro 6 meses',
  'semiannual',
  0,
  'BRL',
  1,
  true,
  jsonb_build_object(
    'patient_limit', null,
    'media_upload', true,
    'manual_only', true,
    'external_marketplace', true
  )
)
on conflict (plan_code) do update set
  display_name = excluded.display_name,
  billing_interval = excluded.billing_interval,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  installment_max = excluded.installment_max,
  active = excluded.active,
  features = excluded.features,
  updated_at = now();

create table if not exists public.manual_license_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email)) and position('@' in email) > 1),
  plan_code text not null default 'pro_6m' check (plan_code = 'pro_6m'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  source text not null default 'mercado_livre_manual',
  granted_by text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index if not exists manual_license_grants_status_expiry_idx
  on public.manual_license_grants(status, expires_at);

alter table public.manual_license_grants enable row level security;
revoke all on table public.manual_license_grants from public, anon, authenticated;
grant all on table public.manual_license_grants to service_role;

-- Existing billing state remains the source of truth for the client application.
-- The manual plan is deliberately not accepted by saas-checkout; only trusted code can apply it.
create or replace function public.apply_billing_state(
  p_owner_id uuid,
  p_plan_code text,
  p_status text,
  p_provider text default '',
  p_external_subscription_id text default null,
  p_current_period_end timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
  v_plan_active boolean;
begin
  select a.id into strict v_account_id
  from public.saas_accounts a
  where a.owner_id = p_owner_id;

  select c.active into strict v_plan_active
  from public.billing_plan_catalog c
  where c.plan_code = p_plan_code;

  if v_plan_active is not true then
    raise exception 'billing plan is inactive';
  end if;

  if p_plan_code = 'pro_6m'
     and p_status in ('active', 'trialing')
     and (p_current_period_end is null or p_current_period_end <= now()) then
    raise exception 'manual six-month plan requires a future current_period_end';
  end if;

  insert into public.subscriptions (
    account_id,
    owner_id,
    provider,
    external_subscription_id,
    plan_code,
    status,
    current_period_end,
    metadata
  ) values (
    v_account_id,
    p_owner_id,
    coalesce(p_provider, ''),
    p_external_subscription_id,
    p_plan_code,
    p_status,
    p_current_period_end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (owner_id)
  do update set
    account_id = excluded.account_id,
    provider = excluded.provider,
    external_subscription_id = excluded.external_subscription_id,
    plan_code = excluded.plan_code,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    metadata = excluded.metadata,
    updated_at = now();

  if p_plan_code in ('pro_monthly', 'pro_annual', 'pro_6m')
     and p_status in ('active', 'trialing') then
    perform public.apply_pro_entitlements(p_owner_id);
  else
    perform public.apply_freemium_entitlements(p_owner_id);
  end if;
end;
$$;

revoke all on function public.apply_billing_state(uuid, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_billing_state(uuid, text, text, text, text, timestamptz, jsonb)
  to service_role;

create or replace function saas_private.has_active_pro(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.owner_id = p_owner_id
      and s.plan_code in ('pro_monthly', 'pro_annual', 'pro_6m')
      and s.status in ('active', 'trialing')
      and (
        (s.plan_code = 'pro_6m' and s.current_period_end is not null and s.current_period_end > now())
        or
        (s.plan_code in ('pro_monthly', 'pro_annual') and (s.current_period_end is null or s.current_period_end > now()))
      )
  );
$$;

revoke all on function saas_private.has_active_pro(uuid) from public, anon, authenticated;
grant execute on function saas_private.has_active_pro(uuid) to authenticated, service_role;

-- Reconcile a pending/manual grant when the licensed user is authenticated.
-- Authorization is bound to auth.uid(); callers can never claim an arbitrary email.
create or replace function public.claim_manual_license()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
  v_email text;
  v_grant public.manual_license_grants%rowtype;
  v_subscription public.subscriptions%rowtype;
begin
  if v_owner_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = v_owner_id;

  if v_email is null or v_email = '' then
    return jsonb_build_object('status', 'no_email');
  end if;

  select * into v_grant
  from public.manual_license_grants g
  where g.email = v_email
  limit 1;

  if not found then
    return jsonb_build_object('status', 'no_grant');
  end if;

  if not exists (select 1 from public.saas_accounts a where a.owner_id = v_owner_id) then
    return jsonb_build_object(
      'status', case when v_grant.status = 'active' and v_grant.expires_at > now() then 'pending_account' else 'inactive' end,
      'expires_at', v_grant.expires_at
    );
  end if;

  if v_grant.status = 'active' and v_grant.expires_at > now() then
    perform public.apply_billing_state(
      v_owner_id,
      'pro_6m',
      'active',
      'manual_marketplace',
      v_grant.id::text,
      v_grant.expires_at,
      jsonb_build_object('source', v_grant.source, 'grant_id', v_grant.id)
    );
    return jsonb_build_object('status', 'active', 'plan_code', 'pro_6m', 'expires_at', v_grant.expires_at);
  end if;

  select * into v_subscription
  from public.subscriptions s
  where s.owner_id = v_owner_id
  limit 1;

  if found and v_subscription.plan_code = 'pro_6m' and v_subscription.provider = 'manual_marketplace' then
    perform public.apply_billing_state(
      v_owner_id,
      'freemium',
      'inactive',
      'manual_marketplace',
      v_grant.id::text,
      null,
      jsonb_build_object('source', v_grant.source, 'manual_grant_status', v_grant.status)
    );
  end if;

  return jsonb_build_object(
    'status', case when v_grant.status = 'revoked' then 'revoked' else 'expired' end,
    'expires_at', v_grant.expires_at
  );
end;
$$;

revoke all on function public.claim_manual_license() from public, anon;
grant execute on function public.claim_manual_license() to authenticated, service_role;

-- Expiration enforcement: an old Pro entitlement alone is never enough.
-- Legacy users outside saas_accounts remain unaffected.
create or replace function saas_private.can_upload_clinical_object(p_name text, p_mime text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := (select auth.uid());
begin
  if v_owner_id is null then
    return false;
  end if;

  if not saas_private.is_photo_or_video(p_name, p_mime) then
    return true;
  end if;

  if not exists (select 1 from public.saas_accounts a where a.owner_id = v_owner_id) then
    return true;
  end if;

  return saas_private.has_active_pro(v_owner_id);
end;
$$;

revoke all on function saas_private.can_upload_clinical_object(text, text) from public, anon, authenticated;
grant execute on function saas_private.can_upload_clinical_object(text, text) to authenticated, service_role;

create or replace function saas_private.enforce_patient_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_owner uuid := (select auth.uid());
  v_current integer;
begin
  if v_auth_owner is null or new.owner_id <> v_auth_owner then
    return new;
  end if;

  if not exists (select 1 from public.saas_accounts a where a.owner_id = new.owner_id) then
    return new;
  end if;

  if saas_private.has_active_pro(new.owner_id) then
    return new;
  end if;

  select count(*)::integer into v_current
  from public.mothers m
  where m.owner_id = new.owner_id;

  if v_current >= 3 then
    raise exception 'SAAS_PATIENT_LIMIT_REACHED: plan allows 3 mothers/patients'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function saas_private.enforce_patient_limit() from public, anon, authenticated;
grant execute on function saas_private.enforce_patient_limit() to authenticated, service_role;

create or replace function saas_private.enforce_media_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_owner uuid := (select auth.uid());
begin
  if v_auth_owner is null or new.owner_id <> v_auth_owner then
    return new;
  end if;

  if not saas_private.is_photo_or_video(new.file_name, new.mime_type) then
    return new;
  end if;

  if not exists (select 1 from public.saas_accounts a where a.owner_id = new.owner_id) then
    return new;
  end if;

  if not saas_private.has_active_pro(new.owner_id) then
    raise exception 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED: photo/video upload requires active Pro'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function saas_private.enforce_media_entitlement() from public, anon, authenticated;
grant execute on function saas_private.enforce_media_entitlement() to authenticated, service_role;
