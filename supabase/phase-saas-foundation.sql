-- SaaS commercial foundation — phases 0–4
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
