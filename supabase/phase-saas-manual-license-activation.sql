-- Automatically consumes a valid pending manual grant when the licensed user creates a SaaS account.
-- This avoids coupling onboarding JavaScript to administrative licensing.

create or replace function saas_private.activate_manual_license_on_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_grant public.manual_license_grants%rowtype;
begin
  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = new.owner_id;

  if v_email is null or v_email = '' then
    return new;
  end if;

  select * into v_grant
  from public.manual_license_grants g
  where g.email = v_email
    and g.status = 'active'
    and g.expires_at > now()
  limit 1;

  if not found then
    return new;
  end if;

  perform public.apply_billing_state(
    new.owner_id,
    'pro_6m',
    'active',
    'manual_marketplace',
    v_grant.id::text,
    v_grant.expires_at,
    jsonb_build_object('source', v_grant.source, 'grant_id', v_grant.id, 'activation', 'account_trigger')
  );

  return new;
end;
$$;

revoke all on function saas_private.activate_manual_license_on_account() from public, anon, authenticated;
grant execute on function saas_private.activate_manual_license_on_account() to service_role;

drop trigger if exists saas_accounts_manual_license_activation on public.saas_accounts;
create trigger saas_accounts_manual_license_activation
after insert on public.saas_accounts
for each row
execute function saas_private.activate_manual_license_on_account();
