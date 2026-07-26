-- Run after referral_manual_historical_credit migration in a disposable DB.
begin;

do $$
declare
  v_trigger_enabled char;
begin
  if to_regprocedure('public.referral_admin_attach_historical_profile(uuid,uuid,text)') is null then
    raise exception 'missing historical relationship RPC';
  end if;
  if to_regprocedure('public.referral_admin_list_historical_orders(uuid)') is null then
    raise exception 'missing historical orders RPC';
  end if;
  if to_regprocedure('public.referral_admin_credit_historical_order(uuid,uuid,text)') is null then
    raise exception 'missing historical credit RPC';
  end if;

  if has_function_privilege('anon', 'public.referral_admin_attach_historical_profile(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_admin_list_historical_orders(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_admin_credit_historical_order(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'anonymous role must not access historical referral administration RPCs';
  end if;

  select tgenabled into v_trigger_enabled
  from pg_trigger
  where tgrelid = 'public.referral_relationships'::regclass
    and tgname = 'referral_relationship_process_recent_orders';
  if v_trigger_enabled <> 'O' then
    raise exception 'normal referral relationship processing trigger must remain enabled';
  end if;

  if has_table_privilege('authenticated', 'public.referral_balance_entries', 'INSERT') then
    raise exception 'historical credit must not grant direct ledger writes to authenticated';
  end if;
end $$;

rollback;
