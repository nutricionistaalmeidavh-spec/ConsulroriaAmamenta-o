-- Flexible care-package items (schema reference; applied to Supabase project zxowxdfhtksevhnjmeyu)
alter table public.financial_entries
  add column if not exists package_id uuid references public.care_packages(id) on delete set null,
  add column if not exists package_item_id uuid;

create table if not exists public.care_package_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  package_id uuid not null references public.care_packages(id) on delete cascade,
  mother_id uuid not null references public.mothers(id) on delete restrict,
  label text not null,
  category text not null default 'service' check (category in ('service','consultation','other')),
  quantity_total integer not null default 1 check (quantity_total > 0),
  quantity_used integer not null default 0 check (quantity_used >= 0 and quantity_used <= quantity_total),
  pricing_mode text not null default 'included' check (pricing_mode in ('included','additional')),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  notes text not null default '',
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='financial_entries_package_item_id_fkey'
      and conrelid='public.financial_entries'::regclass
  ) then
    alter table public.financial_entries
      add constraint financial_entries_package_item_id_fkey
      foreign key (package_item_id) references public.care_package_items(id) on delete set null;
  end if;
end $$;

create table if not exists public.care_package_item_usages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  package_id uuid not null references public.care_packages(id) on delete cascade,
  package_item_id uuid not null references public.care_package_items(id) on delete cascade,
  mother_id uuid not null references public.mothers(id) on delete restrict,
  appointment_id uuid references public.appointments(id) on delete set null,
  encounter_id uuid references public.clinical_encounters(id) on delete set null,
  notes text not null default '',
  used_at timestamptz not null default now()
);

create unique index if not exists care_package_item_usage_encounter_unique
on public.care_package_item_usages(package_item_id, encounter_id)
where encounter_id is not null;

create index if not exists care_package_items_package_idx
on public.care_package_items(owner_id,package_id,status,created_at);

create index if not exists care_package_item_usages_package_idx
on public.care_package_item_usages(owner_id,package_id,used_at desc);

alter table public.care_package_items enable row level security;
alter table public.care_package_item_usages enable row level security;

drop policy if exists care_package_items_owner_all on public.care_package_items;
create policy care_package_items_owner_all on public.care_package_items
for all to authenticated
using (owner_id=(select auth.uid()))
with check (owner_id=(select auth.uid()));

drop policy if exists care_package_item_usages_owner_all on public.care_package_item_usages;
create policy care_package_item_usages_owner_all on public.care_package_item_usages
for all to authenticated
using (owner_id=(select auth.uid()))
with check (owner_id=(select auth.uid()));

grant select,insert,update,delete on public.care_package_items to authenticated;
grant select,insert,update,delete on public.care_package_item_usages to authenticated;

drop trigger if exists care_package_items_set_updated_at on public.care_package_items;
create trigger care_package_items_set_updated_at
before update on public.care_package_items
for each row execute function public.set_updated_at();

create or replace function public.keep_package_open_for_pending_items()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.status='completed' and exists(
    select 1 from public.care_package_items i
    where i.package_id=new.id and i.owner_id=new.owner_id
      and i.status<>'cancelled' and i.quantity_used<i.quantity_total
  ) then new.status:='active'; end if;
  return new;
end $$;

drop trigger if exists care_packages_pending_items_guard on public.care_packages;
create trigger care_packages_pending_items_guard
before update of status,sessions_used on public.care_packages
for each row execute function public.keep_package_open_for_pending_items();

create or replace function public.add_care_package_item(
  p_package_id uuid,p_label text,p_quantity integer default 1,p_category text default 'service',
  p_pricing_mode text default 'included',p_amount_cents integer default 0,p_notes text default ''
) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_package public.care_packages%rowtype;
  v_item public.care_package_items%rowtype; v_fin public.financial_entries%rowtype;
begin
  if v_uid is null then raise exception 'Sessão autenticada obrigatória' using errcode='42501'; end if;
  if coalesce(nullif(btrim(p_label),''),'')='' then raise exception 'Informe o serviço'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'Quantidade inválida'; end if;
  if p_category not in ('service','consultation','other') then raise exception 'Categoria inválida'; end if;
  if p_pricing_mode not in ('included','additional') then raise exception 'Forma de cobrança inválida'; end if;

  select * into v_package from public.care_packages
  where id=p_package_id and owner_id=v_uid for update;
  if not found or v_package.status='cancelled' then raise exception 'Plano não encontrado ou cancelado' using errcode='42501'; end if;

  insert into public.care_package_items(owner_id,package_id,mother_id,label,category,quantity_total,quantity_used,pricing_mode,amount_cents,notes,status)
  values(v_uid,v_package.id,v_package.mother_id,btrim(p_label),p_category,p_quantity,0,p_pricing_mode,greatest(coalesce(p_amount_cents,0),0),coalesce(p_notes,''),'active')
  returning * into v_item;

  if p_pricing_mode='additional' and coalesce(p_amount_cents,0)>0 then
    update public.care_packages set total_cents=total_cents+p_amount_cents,status='active',updated_at=now()
    where id=v_package.id and owner_id=v_uid returning * into v_package;
    if v_package.financial_entry_id is not null then
      select * into v_fin from public.financial_entries where id=v_package.financial_entry_id and owner_id=v_uid for update;
    end if;
    if v_fin.id is not null and v_fin.status='Pendente' then
      update public.financial_entries set amount_cents=v_package.total_cents,description='Plano/Pacote · '||v_package.service_label,package_id=v_package.id,updated_at=now()
      where id=v_fin.id and owner_id=v_uid;
    else
      insert into public.financial_entries(owner_id,mother_id,package_id,package_item_id,description,amount_cents,status,due_at)
      values(v_uid,v_package.mother_id,v_package.id,v_item.id,'Adicional do plano · '||v_item.label,p_amount_cents,'Pendente',current_date);
    end if;
  else
    update public.care_packages set status='active',updated_at=now() where id=v_package.id and owner_id=v_uid;
  end if;
  return jsonb_build_object('item',to_jsonb(v_item),'package_id',v_package.id,'package_total_cents',(select total_cents from public.care_packages where id=v_package.id),'pricing_mode',p_pricing_mode);
end $$;

create or replace function public.consume_care_package_item(
  p_item_id uuid,p_appointment_id uuid default null,p_encounter_id uuid default null,p_notes text default ''
) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_item public.care_package_items%rowtype;
  v_package public.care_packages%rowtype; v_usage public.care_package_item_usages%rowtype; v_open_items integer;
begin
  if v_uid is null then raise exception 'Sessão autenticada obrigatória' using errcode='42501'; end if;
  select * into v_item from public.care_package_items where id=p_item_id and owner_id=v_uid for update;
  if not found or v_item.status='cancelled' then raise exception 'Item não encontrado ou cancelado'; end if;
  if v_item.quantity_used>=v_item.quantity_total then raise exception 'Todas as utilizações deste serviço já foram consumidas'; end if;
  if p_appointment_id is not null and not exists(select 1 from public.appointments a where a.id=p_appointment_id and a.owner_id=v_uid and a.mother_id=v_item.mother_id) then raise exception 'Agendamento incompatível com este plano'; end if;
  if p_encounter_id is not null and not exists(select 1 from public.clinical_encounters e where e.id=p_encounter_id and e.owner_id=v_uid and e.mother_id=v_item.mother_id) then raise exception 'Prontuário incompatível com este plano'; end if;

  insert into public.care_package_item_usages(owner_id,package_id,package_item_id,mother_id,appointment_id,encounter_id,notes)
  values(v_uid,v_item.package_id,v_item.id,v_item.mother_id,p_appointment_id,p_encounter_id,coalesce(p_notes,''))
  on conflict(package_item_id,encounter_id) where encounter_id is not null do nothing returning * into v_usage;

  if v_usage.id is not null then
    update public.care_package_items set quantity_used=quantity_used+1,status=case when quantity_used+1>=quantity_total then 'completed' else 'active' end,updated_at=now()
    where id=v_item.id and owner_id=v_uid returning * into v_item;
  end if;

  select * into v_package from public.care_packages where id=v_item.package_id and owner_id=v_uid for update;
  select count(*) into v_open_items from public.care_package_items
  where package_id=v_package.id and owner_id=v_uid and status<>'cancelled' and quantity_used<quantity_total;
  update public.care_packages set status=case when sessions_used>=sessions_total and v_open_items=0 then 'completed' else 'active' end,updated_at=now()
  where id=v_package.id and owner_id=v_uid;

  return jsonb_build_object('item',to_jsonb(v_item),'usage_id',v_usage.id,'package_id',v_package.id);
end $$;

revoke all on function public.add_care_package_item(uuid,text,integer,text,text,integer,text) from public;
grant execute on function public.add_care_package_item(uuid,text,integer,text,text,integer,text) to authenticated;
revoke all on function public.consume_care_package_item(uuid,uuid,uuid,text) from public;
grant execute on function public.consume_care_package_item(uuid,uuid,uuid,text) to authenticated;
