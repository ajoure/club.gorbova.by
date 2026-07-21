create or replace function public.referral_admin_get_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.referral_is_admin((select auth.uid())) then
    raise exception 'forbidden';
  end if;

  select jsonb_build_object(
    'partners_count', (select count(*) from public.referral_partners),
    'relationships_count', (select count(*) from public.referral_relationships where status = 'active'),
    'sales_count', (select count(*) from public.referral_sale_attributions),
    'pending_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket in ('pending', 'internal_pending')), 0),
    'available_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'available'), 0),
    'internal_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'internal'), 0),
    'held_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'held'), 0),
    'paid_minor', coalesce((select sum(amount_minor) from public.referral_balance_entries where bucket = 'paid'), 0)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.referral_admin_get_summary() from public, anon;
grant execute on function public.referral_admin_get_summary() to authenticated, service_role;