-- SaaS commercial foundation — phases 0–5
-- Additive only. This migration is intentionally isolated from the existing legacy landing/app.
-- It creates generic commercial account structures and does not read or mutate clinical tables.

create table if not exists public.saas_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  account_type text not null default 'individual' check (account_type in ('individual', 'clinic')),
  status text not null default 'active' check (status in ('active', 'trialing', 'suspended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_id uuid not null unique,
  professional_name text not null default '',
  business_name text not null default '',
  phone text not null default '',
  logo_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_profiles_account_owner_fk
    foreign key (account_id, owner_id)
    references public.saas_accounts (id, owner_id)
    on delete cascade
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_id uuid not null,
  provider text not null default '',
  external_customer_id text,
  external_subscription_id text,
  plan_code text not null default '',
  status text not null default 'inactive',
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_account_owner_fk
    foreign key (account_id, owner_id)
    references public.saas_accounts (id, owner_id)
    on delete cascade
);

create table if not exists public.entitlements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_id uuid not null,
  feature_key text not null,
  enabled boolean not null default false,
  limit_value integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_account_owner_fk
    foreign key (account_id, owner_id)
    references public.saas_accounts (id, owner_id)
    on delete cascade,
  constraint entitlements_owner_feature_unique unique (owner_id, feature_key)
);

create index if not exists subscriptions_owner_id_idx on public.subscriptions (owner_id);
create index if not exists subscriptions_account_id_idx on public.subscriptions (account_id);
create index if not exists entitlements_owner_id_idx on public.entitlements (owner_id);
create index if not exists entitlements_account_id_idx on public.entitlements (account_id);

alter table public.saas_accounts enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entitlements enable row level security;

revoke all on table public.saas_accounts from anon, authenticated;
revoke all on table public.professional_profiles from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.entitlements from anon, authenticated;

grant select, insert on table public.saas_accounts to authenticated;
grant select, insert, update on table public.professional_profiles to authenticated;
grant select on table public.subscriptions to authenticated;
grant select on table public.entitlements to authenticated;

grant all on table public.saas_accounts to service_role;
grant all on table public.professional_profiles to service_role;
grant all on table public.subscriptions to service_role;
grant all on table public.entitlements to service_role;

-- Every commercial account starts on Freemium. Selecting Pro on the landing records
-- purchase intent only; Pro entitlements are applied later by a trusted billing webhook.
create or replace function public.bootstrap_freemium_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.entitlements (
    account_id,
    owner_id,
    feature_key,
    enabled,
    limit_value,
    metadata
  )
  values
  (
    new.id,
    new.owner_id,
    'clinical_core',
    true,
    null,
    jsonb_build_object('plan', 'freemium')
  ),
  (
    new.id,
    new.owner_id,
    'patient_limit',
    true,
    3,
    jsonb_build_object('plan', 'freemium', 'unit', 'mothers_patients')
  ),
  (
    new.id,
    new.owner_id,
    'media_upload',
    false,
    null,
    jsonb_build_object('plan', 'freemium', 'covers', jsonb_build_array('photo', 'video'))
  )
  on conflict (owner_id, feature_key) do nothing;

  return new;
end;
$$;

revoke all on function public.bootstrap_freemium_entitlements() from public, anon, authenticated;

drop trigger if exists saas_accounts_bootstrap_freemium on public.saas_accounts;
create trigger saas_accounts_bootstrap_freemium
after insert on public.saas_accounts
for each row
execute function public.bootstrap_freemium_entitlements();

-- Trusted billing code can use this helper after confirmed Pro payment.
-- It is intentionally unavailable to browser/authenticated clients.
create or replace function public.apply_pro_entitlements(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  select id into strict v_account_id
  from public.saas_accounts
  where owner_id = p_owner_id;

  insert into public.entitlements (
    account_id,
    owner_id,
    feature_key,
    enabled,
    limit_value,
    metadata
  )
  values
  (v_account_id, p_owner_id, 'clinical_core', true, null, jsonb_build_object('plan', 'pro')),
  (v_account_id, p_owner_id, 'patient_limit', true, null, jsonb_build_object('plan', 'pro', 'unlimited', true)),
  (v_account_id, p_owner_id, 'media_upload', true, null, jsonb_build_object('plan', 'pro', 'covers', jsonb_build_array('photo', 'video')))
  on conflict (owner_id, feature_key)
  do update set
    account_id = excluded.account_id,
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    metadata = excluded.metadata,
    updated_at = now();
end;
$$;

revoke all on function public.apply_pro_entitlements(uuid) from public, anon, authenticated;
grant execute on function public.apply_pro_entitlements(uuid) to service_role;

drop policy if exists saas_accounts_select_own on public.saas_accounts;
create policy saas_accounts_select_own
on public.saas_accounts
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists saas_accounts_insert_own on public.saas_accounts;
create policy saas_accounts_insert_own
on public.saas_accounts
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists professional_profiles_select_own on public.professional_profiles;
create policy professional_profiles_select_own
on public.professional_profiles
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists professional_profiles_insert_own on public.professional_profiles;
create policy professional_profiles_insert_own
on public.professional_profiles
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists professional_profiles_update_own on public.professional_profiles;
create policy professional_profiles_update_own
on public.professional_profiles
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
on public.subscriptions
for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists entitlements_select_own on public.entitlements;
create policy entitlements_select_own
on public.entitlements
for select
to authenticated
using ((select auth.uid()) = owner_id);
