-- Manual historical referral attribution.
--
-- This is deliberately separate from normal tracking: an administrator can
-- attach an already-existing client and selectively credit only the paid
-- orders they confirm. The relationship and every created sale retain a
-- durable administrative marker for audit and UI disclosure.

create or replace function public.referral_process_orders_for_relationship()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_order_id uuid; v_enabled_at timestamptz;
begin
  -- Historical relationships are reviewed order-by-order by an administrator.
  -- Do not let the normal "recent paid orders" trigger silently credit them.
  if coalesce(new.metadata->>'administrative_historical', 'false') = 'true' then
    return new;
  end if;

  select enabled_at into v_enabled_at from public.referral_program_settings where singleton;
  if v_enabled_at is null then return new; end if;
  for v_order_id in
    select o.id from public.orders_v2 o
    where o.profile_id = new.referred_profile_id
      and o.status::text = 'paid'
      and o.created_at >= v_enabled_at
      and not exists (select 1 from public.referral_sale_attributions rsa where rsa.order_id = o.id)
    order by o.created_at
    limit 100
  loop
    perform public.referral_process_order(v_order_id);
  end loop;
  return new;
end $$;
revoke all on function public.referral_process_orders_for_relationship() from public;

create or replace function public.referral_admin_attach_historical_profile(
  p_partner_profile_id uuid,
  p_referred_profile_id uuid,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_partner_id uuid;
  v_relationship public.referral_relationships%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  if p_partner_profile_id = p_referred_profile_id then raise exception 'self_referral'; end if;

  select id into v_partner_id
  from public.referral_partners
  where profile_id = p_partner_profile_id and status = 'active';
  if v_partner_id is null then raise exception 'active_partner_not_found'; end if;
  if not exists (
    select 1 from public.profiles
    where id = p_referred_profile_id and coalesce(is_archived, false) = false
  ) then raise exception 'profile_not_found'; end if;

  select * into v_relationship
  from public.referral_relationships
  where referred_profile_id = p_referred_profile_id and status = 'active'
  for update;

  if v_relationship.id is not null then
    if v_relationship.partner_id <> v_partner_id then raise exception 'profile_already_attributed'; end if;
    return v_relationship.id;
  end if;

  insert into public.referral_relationships(
    partner_id, referred_profile_id, source, manual_reason, manual_actor_user_id, metadata
  ) values (
    v_partner_id, p_referred_profile_id, 'admin_manual', v_reason, auth.uid(),
    jsonb_build_object(
      'administrative_historical', true,
      'entered_by_admin', true,
      'entry_kind', 'historical_referral_link',
      'reason', v_reason,
      'entered_at', now()
    )
  ) returning * into v_relationship;

  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (
    auth.uid(), 'user', 'referral_historical_relationship_attached',
    'referral_relationship', v_relationship.id,
    jsonb_build_object(
      'partner_profile_id', p_partner_profile_id,
      'referred_profile_id', p_referred_profile_id,
      'reason', v_reason,
      'administrative_historical', true
    )
  );

  return v_relationship.id;
end $$;
revoke all on function public.referral_admin_attach_historical_profile(uuid, uuid, text) from public, anon;
grant execute on function public.referral_admin_attach_historical_profile(uuid, uuid, text) to authenticated, service_role;

create or replace function public.referral_admin_list_historical_orders(p_relationship_id uuid)
returns table(
  order_id uuid,
  order_number text,
  created_at timestamptz,
  product_name text,
  paid_minor bigint,
  payments_count integer,
  commissionable boolean
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;

  return query
  select
    o.id,
    o.order_number,
    o.created_at,
    coalesce(pr.name, 'Продукт без названия'),
    coalesce(payment_totals.paid_minor, 0)::bigint,
    coalesce(payment_totals.payments_count, 0)::integer,
    coalesce(payment_totals.paid_minor, 0) > 0
      and pr.id is not null
      and coalesce(pr.referral_settings_mode, 'inherit') <> 'disabled'
  from public.referral_relationships rr
  join public.orders_v2 o on o.profile_id = rr.referred_profile_id
  left join public.products_v2 pr on pr.id = o.product_id
  cross join lateral (
    select
      coalesce(sum(round(p.amount * 100)::bigint), 0) as paid_minor,
      count(*)::integer as payments_count
    from public.payments_v2 p
    where p.order_id = o.id
      and p.status::text = 'succeeded'
      and not coalesce(p.is_recurring, false)
      and not coalesce(p.is_deleted, false)
  ) payment_totals
  where rr.id = p_relationship_id
    and rr.status = 'active'
    and o.status::text = 'paid'
    and not coalesce(o.is_deleted, false)
    and o.currency = 'BYN'
    and coalesce(o.meta->>'split_from_order_id', '') = ''
    and coalesce(o.meta->>'is_test', 'false') <> 'true'
    and coalesce(o.meta->>'sandbox', 'false') <> 'true'
    and not exists (
      select 1 from public.payments_v2 recurring_payment
      where recurring_payment.order_id = o.id
        and recurring_payment.status::text = 'succeeded'
        and coalesce(recurring_payment.is_recurring, false)
    )
    and not exists (select 1 from public.referral_sale_attributions rsa where rsa.order_id = o.id)
  order by o.created_at desc;
end $$;
revoke all on function public.referral_admin_list_historical_orders(uuid) from public, anon;
grant execute on function public.referral_admin_list_historical_orders(uuid) to authenticated, service_role;

create or replace function public.referral_admin_credit_historical_order(
  p_relationship_id uuid,
  p_order_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_relationship public.referral_relationships%rowtype;
  v_sale_id uuid;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;

  select * into v_relationship
  from public.referral_relationships
  where id = p_relationship_id and status = 'active'
  for update;
  if v_relationship.id is null then raise exception 'active_relationship_not_found'; end if;
  if not exists (
    select 1 from public.orders_v2
    where id = p_order_id and profile_id = v_relationship.referred_profile_id
  ) then raise exception 'order_not_owned_by_referred_profile'; end if;
  if exists (select 1 from public.referral_sale_attributions where order_id = p_order_id) then
    raise exception 'order_already_credited';
  end if;

  -- Reuse the canonical calculation: product override, Club first payment,
  -- recurring-payment exclusion, 60/40 split and idempotency all stay intact.
  v_sale_id := public.referral_process_order(p_order_id);
  if v_sale_id is null then raise exception 'order_not_eligible_for_referral'; end if;

  update public.referral_sale_attributions
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'entered_by_admin', true,
    'administrative_historical', true,
    'entry_kind', 'historical_order_credit',
    'reason', v_reason,
    'actor_user_id', auth.uid(),
    'entered_at', now()
  )
  where id = v_sale_id;

  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (
    auth.uid(), 'user', 'referral_historical_order_credited',
    'referral_sale_attribution', v_sale_id,
    jsonb_build_object(
      'relationship_id', p_relationship_id,
      'order_id', p_order_id,
      'reason', v_reason,
      'administrative_historical', true
    )
  );

  return jsonb_build_object('sale_id', v_sale_id, 'created', true);
end $$;
revoke all on function public.referral_admin_credit_historical_order(uuid, uuid, text) from public, anon;
grant execute on function public.referral_admin_credit_historical_order(uuid, uuid, text) to authenticated, service_role;
