-- Run after 20260721181043_referrals_v1_core.sql in a disposable database.
begin;

do $$
declare
  v_missing text[];
  v_commission bigint;
begin
  select array_agg(name) into v_missing
  from unnest(array[
    'referral_program_settings', 'referral_partners', 'referral_relationships',
    'referral_sale_attributions', 'referral_balance_transactions',
    'referral_balance_entries', 'referral_payout_requests'
  ]) as name
  where to_regclass('public.' || name) is null;
  if v_missing is not null then raise exception 'missing referral tables: %', v_missing; end if;

  if to_regprocedure('public.referral_attach_current_profile(text,timestamp with time zone)') is null then
    raise exception 'missing timestamp-bound referral capture RPC';
  end if;
  if to_regprocedure('public.referral_reconcile_orders(integer)') is null then
    raise exception 'missing referral reconciliation RPC';
  end if;

  if not exists (
    select 1 from public.referral_program_settings
    where singleton and base_currency = 'BYN' and commission_percent_bps = 1000
      and not is_enabled and not tracking_enabled and not accrual_enabled
      and not partner_portal_enabled and shadow_mode
  ) then raise exception 'unsafe or incorrect default settings'; end if;

  v_commission := round(500000::numeric * 1000 / 10000)::bigint;
  if v_commission <> 50000 then raise exception '10 percent calculation failed'; end if;

  if has_table_privilege('authenticated', 'public.referral_balance_entries', 'INSERT') then
    raise exception 'authenticated must not insert ledger entries';
  end if;
  if has_table_privilege('authenticated', 'public.referral_balance_entries', 'UPDATE') then
    raise exception 'authenticated must not update ledger entries';
  end if;
  if has_table_privilege('authenticated', 'public.referral_balance_entries', 'DELETE') then
    raise exception 'authenticated must not delete ledger entries';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.referral_reconcile_orders(integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not run referral reconciliation';
  end if;
end $$;

rollback;
