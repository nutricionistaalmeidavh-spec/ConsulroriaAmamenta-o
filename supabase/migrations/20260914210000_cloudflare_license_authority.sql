-- Commercial plan authorization moved to Cloudflare Worker + Central Artisys D1.
-- Supabase remains responsible for authentication, clinical data, storage and billing records.
-- Legacy clinical owners remain outside the commercial plan model.

-- Stop the old entitlement bootstrap/enforcement path.
drop trigger if exists mothers_saas_patient_limit on public.mothers;
drop trigger if exists clinical_media_saas_entitlement on public.clinical_media;
drop trigger if exists saas_accounts_bootstrap_freemium on public.saas_accounts;
drop trigger if exists saas_accounts_manual_license_activation on public.saas_accounts;

-- Patient creation must pass through the authenticated Cloudflare Worker.
-- Existing reads/updates/deletes remain owner-scoped and continue directly through Supabase.
drop policy if exists mothers_owner_all on public.mothers;
drop policy if exists mothers_owner_select on public.mothers;
drop policy if exists mothers_owner_update on public.mothers;
drop policy if exists mothers_owner_delete on public.mothers;

create policy mothers_owner_select
on public.mothers
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy mothers_owner_update
on public.mothers
for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy mothers_owner_delete
on public.mothers
for delete
to authenticated
using ((select auth.uid()) = owner_id);

-- Photo/video upload is authorized by Cloudflare and written with service_role.
-- PDFs and other non-photo/video clinical files were never a Pro-only feature and stay owner-uploadable.
drop policy if exists clinical_media_owner_insert on storage.objects;
drop policy if exists clinical_media_owner_update on storage.objects;

create policy clinical_media_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'clinical-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not (
    lower(coalesce(metadata ->> 'mimetype', '')) like 'image/%'
    or lower(coalesce(metadata ->> 'mimetype', '')) like 'video/%'
    or lower(name) ~ '\.(jpe?g|png|webp|heic|heif|mp4|mov|webm)$'
  )
);

create policy clinical_media_owner_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'clinical-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'clinical-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and not (
    lower(coalesce(metadata ->> 'mimetype', '')) like 'image/%'
    or lower(coalesce(metadata ->> 'mimetype', '')) like 'video/%'
    or lower(name) ~ '\.(jpe?g|png|webp|heic|heif|mp4|mov|webm)$'
  )
);

-- Billing state remains in Supabase as financial/audit history only.
-- It no longer grants application capabilities; D1 is the authorization authority.
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
end;
$$;

revoke all on function public.apply_billing_state(uuid, text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_billing_state(uuid, text, text, text, text, timestamptz, jsonb)
  to service_role;

-- Remove stale capability rows after the Worker/D1 path is live.
delete from public.entitlements;
