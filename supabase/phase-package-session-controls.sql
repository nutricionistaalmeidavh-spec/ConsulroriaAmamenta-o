-- Package session controls: manual completion + provenance/idempotency.

alter table public.care_package_sessions
  alter column encounter_id drop not null;

alter table public.care_package_sessions
  add column if not exists source text,
  add column if not exists request_key uuid,
  add column if not exists notes text not null default '';

update public.care_package_sessions
set source='appointment'
where source is null or btrim(source)='';

alter table public.care_package_sessions
  alter column source set default 'appointment',
  alter column source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid='public.care_package_sessions'::regclass
      and conname='care_package_sessions_source_check'
  ) then
    alter table public.care_package_sessions
      add constraint care_package_sessions_source_check
      check (source in ('appointment','manual'));
  end if;
end
$$;

create unique index if not exists care_package_sessions_request_key_uidx
  on public.care_package_sessions(owner_id,package_id,request_key)
  where request_key is not null;

create index if not exists care_package_sessions_package_consumed_idx
  on public.care_package_sessions(package_id,consumed_at desc);

create or replace function public.consume_care_package_session_manual(
  p_package_id uuid,
  p_notes text default '',
  p_request_key uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_uid uuid:=auth.uid();
  v_package public.care_packages%rowtype;
  v_session public.care_package_sessions%rowtype;
  v_used integer;
begin
  if v_uid is null then
    raise exception 'Sessão autenticada obrigatória' using errcode='42501';
  end if;
  if p_request_key is null then
    raise exception 'Identificador da operação obrigatório';
  end if;

  select * into v_package
  from public.care_packages
  where id=p_package_id and owner_id=v_uid
  for update;

  if not found then
    raise exception 'Plano não encontrado ou sem permissão' using errcode='42501';
  end if;

  select * into v_session
  from public.care_package_sessions
  where owner_id=v_uid and package_id=v_package.id and request_key=p_request_key
  limit 1;

  if found then
    return jsonb_build_object(
      'handled',true,
      'idempotent',true,
      'package_id',v_package.id,
      'session_id',v_session.id,
      'sessions_total',v_package.sessions_total,
      'sessions_used',v_package.sessions_used,
      'sessions_remaining',greatest(v_package.sessions_total-v_package.sessions_used,0),
      'package_status',v_package.status
    );
  end if;

  if v_package.status<>'active' or v_package.sessions_used>=v_package.sessions_total then
    raise exception 'Plano sem consultas disponíveis';
  end if;

  perform set_config('app.billing_write_context','trusted',true);

  insert into public.care_package_sessions(owner_id,package_id,mother_id,appointment_id,encounter_id,source,request_key,notes) values(v_uid,v_package.id,v_package.mother_id,null,null,'manual',p_request_key,coalesce(p_notes,''))
  returning * into v_session;

  select count(*)::integer into v_used
  from public.care_package_sessions
  where owner_id=v_uid and package_id=v_package.id;

  update public.care_packages
  set sessions_used=least(v_used,sessions_total),
      status=case when v_used>=sessions_total then 'completed' else 'active' end,
      updated_at=now()
  where id=v_package.id and owner_id=v_uid
  returning * into v_package;

  return jsonb_build_object(
    'handled',true,
    'idempotent',false,
    'package_id',v_package.id,
    'session_id',v_session.id,
    'sessions_total',v_package.sessions_total,
    'sessions_used',v_package.sessions_used,
    'sessions_remaining',greatest(v_package.sessions_total-v_package.sessions_used,0),
    'package_status',v_package.status
  );
end
$$;

revoke all on function public.consume_care_package_session_manual(uuid,text,uuid) from public;
revoke all on function public.consume_care_package_session_manual(uuid,text,uuid) from anon;
grant execute on function public.consume_care_package_session_manual(uuid,text,uuid) to authenticated;
