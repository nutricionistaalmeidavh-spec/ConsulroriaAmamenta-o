-- Provider-neutral SaaS billing scaffold.
-- No payment provider is trusted until its adapter verifies a webhook and calls apply_billing_state.

create table if not exists public.billing_plan_catalog (
  plan_code text primary key,
  display_name text not null,
  billing_interval text not null check (billing_interval in ('free', 'monthly', 'annual')),
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'BRL',
  installment_max integer not null default 1 check (installment_max >= 1),
  active boolean not null default true,
  features jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_plan_catalog (
  plan_code, display_name, billing_interval, price_cents, currency, installment_max, active, features
) values
(
  'freemium', 'Freemium', 'free', 0, 'BRL', 1, true,
  jsonb_build_object('patient_limit', 3, 'media_upload', false)
),
(
  'pro_monthly', 'Pro mensal', 'monthly', 4990, 'BRL', 1, true,
  jsonb_build_object('patient_limit', null, 'media_upload', true)
),
(
  'pro_annual', 'Pro anual', 'annual', 49900, 'BRL', 12, true,
  jsonb_build_object('patient_limit', null, 'media_upload', true)
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

create table if not exists public.billing_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_id uuid not null,
  plan_code text not null references public.billing_plan_catalog(plan_code),
  provider text not null default '',
  status text not null default 'pending_provider'
    check (status in ('pending_provider', 'checkout_created', 'paid', 'expired', 'cancelled', 'failed')),
  external_checkout_id text,
  checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_checkout_account_owner_fk
    foreign key (account_id, owner_id)
    references public.saas_accounts(id, owner_id)
    on delete cascade
);

create index if not exists billing_checkout_owner_idx
  on public.billing_checkout_requests(owner_id, created_at desc);
create index if not exists billing_checkout_account_owner_idx
  on public.billing_checkout_requests(account_id, owner_id);
create index if not exists billing_checkout_plan_code_idx
  on public.billing_checkout_requests(plan_code);
create index if not exists professional_profiles_account_owner_idx
  on public.professional_profiles(account_id, owner_id);
create index if not exists subscriptions_account_owner_idx
  on public.subscriptions(account_id, owner_id);
create index if not exists entitlements_account_owner_idx
  on public.entitlements(account_id, owner_id);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null default '',
  status text not null default 'received'
    check (status in ('received', 'processed', 'ignored', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint billing_webhook_provider_event_unique unique (provider, external_event_id)
);

create unique index if not exists subscriptions_owner_unique
  on public.subscriptions(owner_id);

alter table public.billing_plan_catalog enable row level security;
alter table public.billing_checkout_requests enable row level security;
alter table public.billing_webhook_events enable row level security;

revoke all on table public.billing_plan_catalog from anon, authenticated;
revoke all on table public.billing_checkout_requests from anon, authenticated;
revoke all on table public.billing_webhook_events from anon, authenticated;

grant select on table public.billing_plan_catalog to anon, authenticated;
grant select on table public.billing_checkout_requests to authenticated;

grant all on table public.billing_plan_catalog to service_role;
grant all on table public.billing_checkout_requests to service_role;
grant all on table public.billing_webhook_events to service_role;

drop policy if exists billing_plan_catalog_public_select on public.billing_plan_catalog;
create policy billing_plan_catalog_public_select
on public.billing_plan_catalog
for select
to anon, authenticated
using (active = true);

drop policy if exists billing_checkout_requests_select_own on public.billing_checkout_requests;
create policy billing_checkout_requests_select_own
on public.billing_checkout_requests
for select
to authenticated
using ((select auth.uid()) = owner_id);

-- Explicit client deny policy. The table is service-role-only; this policy documents and
-- preserves that boundary if client table grants are ever changed accidentally.
drop policy if exists billing_webhook_events_client_deny on public.billing_webhook_events;
create policy billing_webhook_events_client_deny
on public.billing_webhook_events
for select
to anon, authenticated
using (false);

create or replace function public.apply_freemium_entitlements(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select a.id into strict v_account_id
  from public.saas_accounts a
  where a.owner_id = p_owner_id;

  insert into public.entitlements (
    account_id, owner_id, feature_key, enabled, limit_value, metadata
  ) values
  (v_account_id, p_owner_id, 'clinical_core', true, null, jsonb_build_object('plan', 'freemium')),
  (v_account_id, p_owner_id, 'patient_limit', true, 3, jsonb_build_object('plan', 'freemium', 'unit', 'mothers_patients')),
  (v_account_id, p_owner_id, 'media_upload', false, null, jsonb_build_object('plan', 'freemium', 'covers', jsonb_build_array('photo', 'video')))
  on conflict (owner_id, feature_key)
  do update set
    account_id = excluded.account_id,
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    metadata = excluded.metadata,
    updated_at = now();
end;
$$;

revoke all on function public.apply_freemium_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.apply_freemium_entitlements(uuid) to service_role;

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

  if p_plan_code in ('pro_monthly', 'pro_annual') and p_status in ('active', 'trialing') then
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
