-- SaaS foundation — phases 0–2
-- Additive only: existing clinical tables are read for legacy-owner detection but never mutated.

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

create table if not exists public.public_profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  owner_id uuid not null unique,
  slug text not null unique,
  professional_name text not null default '',
  business_name text not null default '',
  bio text not null default '',
  phone text not null default '',
  instagram text not null default '',
  logo_url text,
  services jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_profiles_account_owner_fk
    foreign key (account_id, owner_id)
    references public.saas_accounts (id, owner_id)
    on delete cascade,
  constraint public_profiles_slug_format_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
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
create index if not exists public_profiles_published_slug_idx on public.public_profiles (published, slug);

alter table public.saas_accounts enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.public_profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entitlements enable row level security;

revoke all on table public.saas_accounts from anon, authenticated;
revoke all on table public.professional_profiles from anon, authenticated;
revoke all on table public.public_profiles from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.entitlements from anon, authenticated;

grant select on table public.saas_accounts to authenticated;
grant select, insert, update on table public.professional_profiles to authenticated;
grant select on table public.public_profiles to anon;
grant select, insert, update on table public.public_profiles to authenticated;
grant select on table public.subscriptions to authenticated;
grant select on table public.entitlements to authenticated;

grant all on table public.saas_accounts to service_role;
grant all on table public.professional_profiles to service_role;
grant all on table public.public_profiles to service_role;
grant all on table public.subscriptions to service_role;
grant all on table public.entitlements to service_role;

drop policy if exists saas_accounts_select_own on public.saas_accounts;
create policy saas_accounts_select_own
on public.saas_accounts
for select
to authenticated
using ((select auth.uid()) = owner_id);

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

drop policy if exists public_profiles_public_select on public.public_profiles;
create policy public_profiles_public_select
on public.public_profiles
for select
to anon
using (published = true);

drop policy if exists public_profiles_authenticated_select on public.public_profiles;
create policy public_profiles_authenticated_select
on public.public_profiles
for select
to authenticated
using (published = true or (select auth.uid()) = owner_id);

drop policy if exists public_profiles_insert_own on public.public_profiles;
create policy public_profiles_insert_own
on public.public_profiles
for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists public_profiles_update_own on public.public_profiles;
create policy public_profiles_update_own
on public.public_profiles
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

-- Promote the single real legacy clinical owner without storing a personal e-mail or generated UUID.
-- The demo owner has no persisted clinical encounter + financial history and therefore is not eligible.
do $$
declare
  v_candidates uuid[];
  v_owner_id uuid;
  v_account_id uuid;
begin
  select array_agg(candidate.owner_id order by candidate.owner_id::text)
    into v_candidates
  from (
    select ce.owner_id
    from public.clinical_encounters ce
    where exists (
      select 1
      from public.financial_entries fe
      where fe.owner_id = ce.owner_id
    )
    group by ce.owner_id
  ) as candidate;

  if coalesce(cardinality(v_candidates), 0) <> 1 then
    raise exception 'Expected exactly one legacy clinical owner, found %', coalesce(cardinality(v_candidates), 0);
  end if;

  v_owner_id := v_candidates[1];

  insert into public.saas_accounts (owner_id, account_type, status)
  values (v_owner_id, 'individual', 'active')
  on conflict (owner_id) do nothing;

  select id
    into strict v_account_id
  from public.saas_accounts
  where owner_id = v_owner_id;

  insert into public.professional_profiles (
    account_id,
    owner_id,
    professional_name,
    business_name
  )
  values (
    v_account_id,
    v_owner_id,
    'Débora',
    'Débora Lactação'
  )
  on conflict (owner_id) do nothing;

  insert into public.public_profiles (
    account_id,
    owner_id,
    slug,
    professional_name,
    business_name,
    published
  )
  values (
    v_account_id,
    v_owner_id,
    'debora-lactacao',
    'Débora',
    'Débora Lactação',
    true
  )
  on conflict (owner_id) do nothing;

  insert into public.entitlements (
    account_id,
    owner_id,
    feature_key,
    enabled,
    metadata
  )
  values (
    v_account_id,
    v_owner_id,
    'legacy_full_access',
    true,
    jsonb_build_object('source', 'pre_saas_clinical_account')
  )
  on conflict (owner_id, feature_key)
  do update set
    enabled = excluded.enabled,
    account_id = excluded.account_id,
    metadata = excluded.metadata,
    updated_at = now();
end
$$;
