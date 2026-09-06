-- SaaS entitlement enforcement — commercial accounts only.
-- Legacy owners that do not exist in public.saas_accounts remain unaffected.
-- Freemium: up to 3 mothers/patients; photo/video upload blocked.
-- Non-media uploads such as application/pdf remain allowed.

create schema if not exists saas_private;
revoke all on schema saas_private from public;
grant usage on schema saas_private to authenticated, service_role;

create or replace function saas_private.is_photo_or_video(p_name text, p_mime text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    lower(coalesce(p_mime, '')) like 'image/%'
    or lower(coalesce(p_mime, '')) like 'video/%'
    or lower(coalesce(p_name, '')) ~ '\.(jpe?g|png|webp|heic|heif|mp4|mov|webm)$';
$$;

revoke all on function saas_private.is_photo_or_video(text, text) from public, anon, authenticated;

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

  return exists (
    select 1
    from public.entitlements e
    where e.owner_id = v_owner_id
      and e.feature_key = 'media_upload'
      and e.enabled = true
  );
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
  v_enabled boolean;
  v_limit integer;
  v_current integer;
begin
  if v_auth_owner is null or new.owner_id <> v_auth_owner then
    return new;
  end if;

  if not exists (select 1 from public.saas_accounts a where a.owner_id = new.owner_id) then
    return new;
  end if;

  select e.enabled, e.limit_value
    into v_enabled, v_limit
  from public.entitlements e
  where e.owner_id = new.owner_id
    and e.feature_key = 'patient_limit';

  if not found or v_enabled is not true then
    raise exception 'SAAS_PATIENT_LIMIT_REACHED: patient entitlement unavailable'
      using errcode = 'P0001';
  end if;

  if v_limit is null then
    return new;
  end if;

  select count(*)::integer
    into v_current
  from public.mothers m
  where m.owner_id = new.owner_id;

  if v_current >= v_limit then
    raise exception 'SAAS_PATIENT_LIMIT_REACHED: plan allows % mothers/patients', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function saas_private.enforce_patient_limit() from public, anon, authenticated;
grant execute on function saas_private.enforce_patient_limit() to authenticated, service_role;

drop trigger if exists mothers_saas_patient_limit on public.mothers;
create trigger mothers_saas_patient_limit
before insert on public.mothers
for each row
execute function saas_private.enforce_patient_limit();

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

  if not exists (
    select 1
    from public.entitlements e
    where e.owner_id = new.owner_id
      and e.feature_key = 'media_upload'
      and e.enabled = true
  ) then
    raise exception 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED: photo/video upload requires Pro'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function saas_private.enforce_media_entitlement() from public, anon, authenticated;
grant execute on function saas_private.enforce_media_entitlement() to authenticated, service_role;

drop trigger if exists clinical_media_saas_entitlement on public.clinical_media;
create trigger clinical_media_saas_entitlement
before insert or update of owner_id, file_name, mime_type on public.clinical_media
for each row
execute function saas_private.enforce_media_entitlement();

-- Storage is enforced as well so a Freemium client cannot bypass the UI and leave
-- photo/video blobs orphaned in the clinical-media bucket. PDFs/non-media remain allowed.
drop policy if exists clinical_media_owner_insert on storage.objects;
create policy clinical_media_owner_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'clinical-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and saas_private.can_upload_clinical_object(name, metadata ->> 'mimetype')
);

drop policy if exists clinical_media_owner_update on storage.objects;
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
  and saas_private.can_upload_clinical_object(name, metadata ->> 'mimetype')
);
