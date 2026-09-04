-- Phases 3-5: album clinical index + referral/editor support.
-- Additive only. Files remain in the existing private `clinical-media` storage bucket.

create table if not exists public.clinical_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mother_id uuid not null references public.mothers(id) on delete cascade,
  baby_id uuid null references public.babies(id) on delete set null,
  appointment_id uuid null references public.appointments(id) on delete set null,
  encounter_id uuid null references public.clinical_encounters(id) on delete set null,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  storage_path text not null,
  mime_type text not null default 'application/octet-stream',
  file_name text not null default '',
  file_size bigint null check (file_size is null or file_size >= 0),
  category text not null default 'Outro' check (category in ('Mama','Pega','Posição','Bebê','Língua/oral','Lesão','Evolução','Documento','Outro')),
  caption text not null default '',
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, storage_path)
);

create index if not exists clinical_media_owner_mother_taken_idx on public.clinical_media(owner_id,mother_id,taken_at desc);
create index if not exists clinical_media_baby_taken_idx on public.clinical_media(baby_id,taken_at desc) where baby_id is not null;
create index if not exists clinical_media_encounter_idx on public.clinical_media(encounter_id) where encounter_id is not null;

alter table public.clinical_media enable row level security;

drop policy if exists clinical_media_owner_all on public.clinical_media;
create policy clinical_media_owner_all on public.clinical_media for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());

create or replace function public.validate_clinical_media_links()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.owner_id is distinct from auth.uid() then
    raise exception 'owner_id inválido para mídia clínica';
  end if;
  if new.uploaded_by is distinct from new.owner_id then
    raise exception 'uploaded_by inválido para mídia clínica';
  end if;
  if new.storage_path = '' or position(new.owner_id::text || '/' in new.storage_path) <> 1 then
    raise exception 'storage_path inválido para mídia clínica';
  end if;
  if not exists(select 1 from public.mothers m where m.id=new.mother_id and m.owner_id=new.owner_id) then
    raise exception 'mother_id inválido para mídia clínica';
  end if;
  if new.baby_id is not null and not exists(select 1 from public.babies b where b.id=new.baby_id and b.mother_id=new.mother_id and b.owner_id=new.owner_id) then
    raise exception 'baby_id inválido para mídia clínica';
  end if;
  if new.appointment_id is not null and not exists(select 1 from public.appointments a where a.id=new.appointment_id and a.mother_id=new.mother_id and a.owner_id=new.owner_id) then
    raise exception 'appointment_id inválido para mídia clínica';
  end if;
  if new.encounter_id is not null and not exists(select 1 from public.clinical_encounters e where e.id=new.encounter_id and e.mother_id=new.mother_id and e.owner_id=new.owner_id) then
    raise exception 'encounter_id inválido para mídia clínica';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists clinical_media_validate_links on public.clinical_media;
create trigger clinical_media_validate_links before insert or update on public.clinical_media for each row execute function public.validate_clinical_media_links();

grant select,insert,update,delete on public.clinical_media to authenticated;
