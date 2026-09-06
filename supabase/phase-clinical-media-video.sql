-- Clinical media video support.
-- Keeps the existing private `clinical-media` bucket and ownership/RLS policies.
-- Video consent is versioned separately from the legacy photo/document wording.

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]::text[]
where id = 'clinical-media';

create or replace function public.version_clinical_media_consent()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.consent_type = 'clinical_media' and new.granted then
    new.version = '1.1';
    new.evidence = 'Consentimento v1.1: armazenamento privado de fotos, vídeos e documentos clínicos vinculados ao cuidado.';
  end if;
  return new;
end;
$$;

drop trigger if exists version_clinical_media_consent on public.consents;
create trigger version_clinical_media_consent
before insert or update on public.consents
for each row execute function public.version_clinical_media_consent();

-- Existing v1.0 acceptances used wording for photos/documents only. Revoke them instead of
-- silently broadening their scope; the professional can obtain a fresh v1.1 acceptance.
update public.consents
set
  granted = false,
  revoked_at = coalesce(revoked_at, now()),
  evidence = case
    when coalesce(evidence,'') = '' then 'Consentimento v1.0 encerrado após ampliação do escopo para vídeos; novo aceite v1.1 necessário.'
    else evidence || ' | Consentimento v1.0 encerrado após ampliação do escopo para vídeos; novo aceite v1.1 necessário.'
  end,
  updated_at = now()
where consent_type = 'clinical_media'
  and granted = true
  and revoked_at is null
  and version <> '1.1';
