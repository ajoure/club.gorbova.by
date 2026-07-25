-- Run after referral_admin_corrections migration in a disposable DB.
begin;

do $$
begin
  if to_regprocedure('public.referral_admin_reverse_sale_attribution(uuid,text)') is null
     or to_regprocedure('public.referral_admin_restore_sale_attribution(uuid,text)') is null
     or to_regprocedure('public.referral_admin_revoke_relationship(uuid,text)') is null
     or to_regprocedure('public.referral_admin_reassign_relationship(uuid,uuid,text)') is null then
    raise exception 'missing referral administrator correction RPC';
  end if;

  if has_function_privilege('anon', 'public.referral_admin_reverse_sale_attribution(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_admin_restore_sale_attribution(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_admin_revoke_relationship(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.referral_admin_reassign_relationship(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'anonymous role must not access referral correction RPCs';
  end if;

  if has_table_privilege('authenticated', 'public.referral_balance_entries', 'INSERT')
     or has_table_privilege('authenticated', 'public.referral_balance_transactions', 'UPDATE') then
    raise exception 'referral correction must not grant direct ledger writes to authenticated';
  end if;
end $$;

rollback;
