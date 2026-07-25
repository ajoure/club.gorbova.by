-- Run after all referrals v1 migrations in a disposable database.
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
    'referral_balance_entries', 'referral_payout_requests',
    'referral_bonus_reservations', 'referral_program_links'
  ]) as name
  where to_regclass('public.' || name) is null;
  if v_missing is not null then raise exception 'missing referral tables: %', v_missing; end if;

  if to_regprocedure('public.referral_attach_current_profile(text,timestamp with time zone)') is null then
    raise exception 'missing timestamp-bound referral capture RPC';
  end if;
  if to_regprocedure('public.referral_reconcile_orders(integer)') is null then
    raise exception 'missing referral reconciliation RPC';
  end if;
  if to_regprocedure('public.referral_admin_get_summary()') is null then
    raise exception 'missing exact referral admin summary RPC';
  end if;
  if to_regprocedure('public.referral_apply_customer_discount()') is null then
    raise exception 'missing referred-customer discount trigger function';
  end if;
  if to_regprocedure('public.referral_get_my_bonus_wallet(uuid)') is null then
    raise exception 'missing partner bonus wallet RPC';
  end if;
  if to_regprocedure('public.referral_create_program_link(text,text,uuid)') is null then
    raise exception 'missing free program link RPC';
  end if;

  if not exists (
    select 1 from public.referral_program_settings
    where singleton and base_currency = 'BYN' and commission_percent_bps = 1000
      and customer_discount_percent_bps = 0
      and split_60_40_enabled and withdrawable_percent_bps = 4000
      and minimum_payout_minor = 100000
      and commission_scheme = 'flat' and partner_bonus_enabled and telegram_notifications_enabled
      and not is_enabled and not tracking_enabled and not accrual_enabled
      and not partner_portal_enabled and shadow_mode
  ) then raise exception 'unsafe or incorrect default settings'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'products_v2'
      and column_name in ('referral_settings_mode', 'referral_commission_percent_bps', 'referral_customer_discount_percent_bps')
    group by table_schema, table_name having count(*) = 3
  ) then raise exception 'missing product referral settings'; end if;

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
  if has_function_privilege('anon', 'public.referral_admin_get_summary()', 'EXECUTE') then
    raise exception 'anon must not run referral admin summary';
  end if;
end $$;

rollback;
