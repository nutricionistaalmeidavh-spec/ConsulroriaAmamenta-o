-- Partner attribution, commissions and optional coupon discounts for the commercial SaaS.
-- Apply after phase-saas-billing.sql and before deploying the checkout/webhook functions in this branch.

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  code text not null check (length(trim(code)) between 2 and 64),
  partner_type text not null default 'partner'
    check (partner_type in ('partner', 'influencer', 'campaign')),
  active boolean not null default true,
  commission_type text not null default 'none'
    check (commission_type in ('none', 'percent', 'fixed')),
  commission_value numeric(12,2) not null default 0 check (commission_value >= 0),
  discount_type text not null default 'none'
    check (discount_type in ('none', 'percent', 'fixed')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partners_commission_percent_check
    check (commission_type <> 'percent' or commission_value <= 100),
  constraint partners_discount_percent_check
    check (discount_type <> 'percent' or discount_value <= 100)
);

create unique index if not exists partners_code_unique
  on public.partners ((upper(trim(code))));
create index if not exists partners_active_idx
  on public.partners(active, created_at desc);

alter table public.billing_checkout_requests
  add column if not exists partner_id uuid references public.partners(id) on delete set null,
  add column if not exists partner_code_snapshot text,
  add column if not exists attribution_source text,
  add column if not exists subtotal_cents integer,
  add column if not exists discount_cents integer,
  add column if not exists total_cents integer,
  add column if not exists commission_cents integer;

create index if not exists billing_checkout_partner_idx
  on public.billing_checkout_requests(partner_id, created_at desc)
  where partner_id is not null;

create table if not exists public.partner_attributions (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  checkout_request_id uuid not null unique
    references public.billing_checkout_requests(id) on delete cascade,
  owner_id uuid not null,
  plan_code text not null references public.billing_plan_catalog(plan_code),
  partner_code_snapshot text not null,
  attribution_source text not null default 'manual_code'
    check (attribution_source in ('manual_code', 'ref_link')),
  commission_type_snapshot text not null default 'none'
    check (commission_type_snapshot in ('none', 'percent', 'fixed')),
  commission_value_snapshot numeric(12,2) not null default 0,
  discount_type_snapshot text not null default 'none'
    check (discount_type_snapshot in ('none', 'percent', 'fixed')),
  discount_value_snapshot numeric(12,2) not null default 0,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  commission_cents integer not null default 0 check (commission_cents >= 0),
  status text not null default 'captured'
    check (status in ('captured', 'checkout_created', 'paid', 'cancelled', 'refunded', 'chargeback')),
  commission_status text not null default 'none'
    check (commission_status in ('none', 'pending', 'approved', 'cancelled', 'reversed')),
  provider_status text,
  paid_at timestamptz,
  commission_approved_at timestamptz,
  commission_approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists partner_attributions_partner_idx
  on public.partner_attributions(partner_id, created_at desc);
create index if not exists partner_attributions_owner_idx
  on public.partner_attributions(owner_id, created_at desc);
create index if not exists partner_attributions_commission_idx
  on public.partner_attributions(commission_status, created_at desc);

alter table public.partners enable row level security;
alter table public.partner_attributions enable row level security;

revoke all on table public.partners from public, anon, authenticated;
revoke all on table public.partner_attributions from public, anon, authenticated;
grant all on table public.partners to service_role;
grant all on table public.partner_attributions to service_role;

-- A code never sends pricing from the browser. This RPC resolves the active code and computes
-- immutable checkout snapshots from the canonical plan catalog and partner configuration.
create or replace function public.resolve_partner_offer(p_code text, p_plan_code text)
returns table (
  partner_id uuid,
  partner_name text,
  partner_code text,
  partner_type text,
  subtotal_cents integer,
  discount_cents integer,
  total_cents integer,
  commission_cents integer,
  commission_type text,
  commission_value numeric,
  discount_type text,
  discount_value numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner public.partners%rowtype;
  v_subtotal integer;
  v_discount integer := 0;
  v_total integer;
  v_commission integer := 0;
begin
  if nullif(trim(coalesce(p_code, '')), '') is null then
    return;
  end if;

  select p.* into v_partner
  from public.partners p
  where p.active is true
    and upper(trim(p.code)) = upper(trim(p_code))
  limit 1;
  if not found then return; end if;

  select c.price_cents into v_subtotal
  from public.billing_plan_catalog c
  where c.plan_code = p_plan_code and c.active is true
  limit 1;
  if not found then return; end if;

  if v_partner.discount_type = 'percent' then
    v_discount := round(v_subtotal::numeric * v_partner.discount_value / 100)::integer;
  elsif v_partner.discount_type = 'fixed' then
    v_discount := round(v_partner.discount_value * 100)::integer;
  end if;
  v_discount := greatest(0, least(v_subtotal, v_discount));
  v_total := greatest(0, v_subtotal - v_discount);

  if v_partner.commission_type = 'percent' then
    v_commission := round(v_total::numeric * v_partner.commission_value / 100)::integer;
  elsif v_partner.commission_type = 'fixed' then
    v_commission := round(v_partner.commission_value * 100)::integer;
  end if;
  v_commission := greatest(0, least(v_total, v_commission));

  return query select
    v_partner.id,
    v_partner.name,
    upper(trim(v_partner.code)),
    v_partner.partner_type,
    v_subtotal,
    v_discount,
    v_total,
    v_commission,
    v_partner.commission_type,
    v_partner.commission_value,
    v_partner.discount_type,
    v_partner.discount_value;
end;
$$;

revoke all on function public.resolve_partner_offer(text, text) from public, anon, authenticated;
grant execute on function public.resolve_partner_offer(text, text) to service_role;

-- Keep the attribution row synchronized with checkout lifecycle changes while preserving snapshots.
create or replace function public.sync_partner_attribution_from_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partner public.partners%rowtype;
  v_status text;
  v_commission_status text;
begin
  if new.partner_id is null then return new; end if;

  select p.* into strict v_partner from public.partners p where p.id = new.partner_id;
  v_status := case new.status
    when 'checkout_created' then 'checkout_created'
    when 'paid' then 'paid'
    when 'cancelled' then 'cancelled'
    when 'expired' then 'cancelled'
    when 'failed' then 'cancelled'
    else 'captured'
  end;
  v_commission_status := case
    when v_status = 'paid' and coalesce(new.commission_cents, 0) > 0 then 'pending'
    when v_status = 'paid' then 'none'
    when v_status = 'cancelled' then 'cancelled'
    else 'none'
  end;

  insert into public.partner_attributions (
    partner_id, checkout_request_id, owner_id, plan_code, partner_code_snapshot,
    attribution_source, commission_type_snapshot, commission_value_snapshot,
    discount_type_snapshot, discount_value_snapshot, subtotal_cents, discount_cents,
    total_cents, commission_cents, status, commission_status, paid_at, updated_at
  ) values (
    new.partner_id, new.id, new.owner_id, new.plan_code,
    coalesce(new.partner_code_snapshot, upper(trim(v_partner.code))),
    coalesce(nullif(new.attribution_source, ''), 'manual_code'),
    v_partner.commission_type, v_partner.commission_value,
    v_partner.discount_type, v_partner.discount_value,
    coalesce(new.subtotal_cents, new.total_cents, 0), coalesce(new.discount_cents, 0),
    coalesce(new.total_cents, new.subtotal_cents, 0), coalesce(new.commission_cents, 0),
    v_status, v_commission_status,
    case when v_status = 'paid' then coalesce(now(), now()) else null end,
    now()
  )
  on conflict (checkout_request_id) do update set
    status = excluded.status,
    commission_status = case
      when public.partner_attributions.commission_status = 'approved' and excluded.status = 'paid'
        then public.partner_attributions.commission_status
      else excluded.commission_status
    end,
    paid_at = case
      when excluded.status = 'paid' then coalesce(public.partner_attributions.paid_at, now())
      else public.partner_attributions.paid_at
    end,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_partner_attribution_from_checkout() from public, anon, authenticated;
grant execute on function public.sync_partner_attribution_from_checkout() to service_role;

drop trigger if exists billing_checkout_partner_attribution_sync on public.billing_checkout_requests;
create trigger billing_checkout_partner_attribution_sync
after insert or update of status, partner_id on public.billing_checkout_requests
for each row
execute function public.sync_partner_attribution_from_checkout();

-- Verified Asaas status is the final authority for whether a commission is due or reversed.
create or replace function public.apply_partner_attribution_state(
  p_checkout_request_id uuid,
  p_provider_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_provider text := upper(trim(coalesce(p_provider_status, '')));
begin
  v_status := case
    when v_provider in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then 'paid'
    when v_provider in ('REFUNDED', 'REFUND_REQUESTED') then 'refunded'
    when v_provider in ('CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL') then 'chargeback'
    when v_provider = 'DELETED' then 'cancelled'
    else null
  end;
  if v_status is null then return; end if;

  update public.partner_attributions a
  set
    status = v_status,
    provider_status = v_provider,
    commission_status = case
      when v_status = 'paid' and a.commission_cents > 0 and a.commission_status <> 'approved' then 'pending'
      when v_status = 'paid' and a.commission_cents = 0 then 'none'
      when v_status in ('refunded', 'chargeback', 'cancelled') and a.commission_status = 'approved' then 'reversed'
      when v_status in ('refunded', 'chargeback', 'cancelled') then 'cancelled'
      else a.commission_status
    end,
    paid_at = case when v_status = 'paid' then coalesce(a.paid_at, now()) else a.paid_at end,
    updated_at = now()
  where a.checkout_request_id = p_checkout_request_id;
end;
$$;

revoke all on function public.apply_partner_attribution_state(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_partner_attribution_state(uuid, text) to service_role;

create or replace function public.approve_partner_commission(
  p_attribution_id uuid,
  p_actor text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.partner_attributions
  set commission_status = 'approved',
      commission_approved_at = now(),
      commission_approved_by = nullif(trim(coalesce(p_actor, '')), ''),
      updated_at = now()
  where id = p_attribution_id
    and status = 'paid'
    and commission_status = 'pending';

  if not found then
    raise exception 'commission is not pending for a paid attribution';
  end if;
end;
$$;

revoke all on function public.approve_partner_commission(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_partner_commission(uuid, text) to service_role;
