-- Phase 1-2: additive document infrastructure + term snapshots.
-- No existing table/column is renamed, dropped, or repurposed.

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_type text not null check (document_type in ('term','referral','care_plan','export')),
  name text not null,
  specialty text not null default '',
  content jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, document_type, name)
);

create table if not exists public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mother_id uuid not null references public.mothers(id) on delete cascade,
  baby_id uuid null references public.babies(id) on delete set null,
  appointment_id uuid null references public.appointments(id) on delete set null,
  encounter_id uuid null references public.clinical_encounters(id) on delete set null,
  document_type text not null check (document_type in ('term','referral','care_plan','export')),
  title text not null,
  status text not null default 'draft' check (status in ('draft','finalized','void')),
  template_id uuid null references public.document_templates(id) on delete set null,
  source_consent_id uuid null references public.consents(id) on delete set null,
  content jsonb not null default '{}'::jsonb,
  pdf_storage_path text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finalized_at timestamptz null,
  constraint clinical_documents_finalized_at_check check (status <> 'finalized' or finalized_at is not null)
);

create index if not exists clinical_documents_owner_mother_created_idx on public.clinical_documents(owner_id,mother_id,created_at desc);
create index if not exists clinical_documents_encounter_idx on public.clinical_documents(encounter_id) where encounter_id is not null;
create index if not exists clinical_documents_type_idx on public.clinical_documents(owner_id,document_type,created_at desc);
create unique index if not exists clinical_documents_consent_snapshot_unique on public.clinical_documents(owner_id,source_consent_id,document_type,finalized_at) where source_consent_id is not null and document_type='term';

alter table public.document_templates enable row level security;
alter table public.clinical_documents enable row level security;

drop policy if exists document_templates_owner_all on public.document_templates;
create policy document_templates_owner_all on public.document_templates for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());

drop policy if exists clinical_documents_owner_all on public.clinical_documents;
create policy clinical_documents_owner_all on public.clinical_documents for all using (owner_id=auth.uid()) with check (owner_id=auth.uid());

create or replace function public.validate_clinical_document_links()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.owner_id is distinct from auth.uid() then
    raise exception 'owner_id inválido para documento clínico';
  end if;
  if not exists(select 1 from public.mothers m where m.id=new.mother_id and m.owner_id=new.owner_id) then
    raise exception 'mother_id inválido para documento clínico';
  end if;
  if new.baby_id is not null and not exists(select 1 from public.babies b where b.id=new.baby_id and b.mother_id=new.mother_id and b.owner_id=new.owner_id) then
    raise exception 'baby_id inválido para documento clínico';
  end if;
  if new.appointment_id is not null and not exists(select 1 from public.appointments a where a.id=new.appointment_id and a.mother_id=new.mother_id and a.owner_id=new.owner_id) then
    raise exception 'appointment_id inválido para documento clínico';
  end if;
  if new.encounter_id is not null and not exists(select 1 from public.clinical_encounters e where e.id=new.encounter_id and e.mother_id=new.mother_id and e.owner_id=new.owner_id) then
    raise exception 'encounter_id inválido para documento clínico';
  end if;
  if new.source_consent_id is not null and not exists(select 1 from public.consents c where c.id=new.source_consent_id and c.mother_id=new.mother_id and c.owner_id=new.owner_id) then
    raise exception 'source_consent_id inválido para documento clínico';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists clinical_documents_validate_links on public.clinical_documents;
create trigger clinical_documents_validate_links before insert or update on public.clinical_documents for each row execute function public.validate_clinical_document_links();

create or replace function public.touch_document_template_updated_at()
returns trigger language plpgsql security invoker set search_path=public as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists document_templates_touch_updated_at on public.document_templates;
create trigger document_templates_touch_updated_at before update on public.document_templates for each row execute function public.touch_document_template_updated_at();

grant select,insert,update,delete on public.document_templates to authenticated;
grant select,insert,update,delete on public.clinical_documents to authenticated;
