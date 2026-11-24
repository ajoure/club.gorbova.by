-- Keep canonical commission eligibility, money and ledger calculation unchanged.
-- Creation time is audit time; the hold window starts at the verified sale time.
create or replace function referral_private.process_order_at(p_order_id uuid, p_sale_at timestamptz default null, p_available_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp set timezone='UTC' as $$
declare
  v_order public.orders_v2%rowtype; v_settings public.referral_program_settings%rowtype;
  v_relationship public.referral_relationships%rowtype; v_partner public.referral_partners%rowtype;
  v_product public.products_v2%rowtype; v_payment_id uuid; v_paid_minor bigint; v_basis_minor bigint;
  v_commission_minor bigint; v_sale_id uuid; v_tx_id uuid; v_status text; v_available_at timestamptz; v_sale_at timestamptz;
  v_commission_bps integer; v_scheme text; v_rank bigint; v_existing boolean; v_cash_minor bigint; v_internal_minor bigint;
begin
  select * into v_settings from public.referral_program_settings where singleton;
  if not coalesce(v_settings.is_enabled, false) or not coalesce(v_settings.accrual_enabled, false) then return null; end if;
  select * into v_order from public.orders_v2 where id = p_order_id for update;
  if v_order.meta->>'financial_kind' = 'referral_redemption' then return null; end if;
  if v_order.id is null or v_order.status::text <> 'paid' or coalesce(v_order.is_deleted, false) then return null; end if;
  if coalesce(v_order.currency, '') <> 'BYN' or coalesce(v_order.paid_amount, 0) <= 0 then return null; end if;
  if coalesce(v_order.meta->>'split_from_order_id', '') <> '' or coalesce(v_order.meta->>'is_test', 'false') = 'true' or coalesce(v_order.meta->>'sandbox', 'false') = 'true' then return null; end if;
  if exists (select 1 from public.referral_sale_attributions where order_id = p_order_id) then
    select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
  end if;
  if exists (select 1 from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and coalesce(is_recurring, false)) then return null; end if;
  select (array_agg(id order by paid_at nulls last, created_at))[1], coalesce(sum(round(amount * 100)::bigint), 0)
    into v_payment_id, v_paid_minor from public.payments_v2 where order_id = p_order_id and status::text = 'succeeded' and not coalesce(is_recurring, false) and not coalesce(is_deleted, false);
  if v_paid_minor <= 0 then return null; end if;
  select * into v_relationship from public.referral_relationships where referred_profile_id = v_order.profile_id and status = 'active' order by attached_at, id limit 1;
  if v_relationship.id is null then return null; end if;
  select * into v_partner from public.referral_partners where id = v_relationship.partner_id and status = 'active';
  if v_partner.id is null or v_partner.profile_id = v_order.profile_id then return null; end if;
  select * into v_product from public.products_v2 where id = v_order.product_id;
  if v_product.id is null or v_product.referral_settings_mode = 'disabled' then return null; end if;

  v_scheme := coalesce(v_product.referral_commission_scheme, v_settings.commission_scheme, 'flat');
  if v_scheme = 'club_first_payment' then
    select exists (select 1 from public.referral_sale_attributions rsa where rsa.relationship_id = v_relationship.id and rsa.product_id = v_order.product_id) into v_existing;
    if v_existing then return null; end if;
    v_commission_bps := coalesce(v_product.referral_club_first_payment_percent_bps, v_product.referral_commission_percent_bps, v_settings.club_first_payment_percent_bps);
  elsif v_scheme = 'tiered' then
    select count(*) + 1 into v_rank from public.referral_relationships rr where rr.partner_id = v_relationship.partner_id and rr.status = 'active'
      and (rr.attached_at, rr.id) < (v_relationship.attached_at, v_relationship.id);
    v_commission_bps := case
      when v_rank <= coalesce(v_product.referral_tier_1_limit, v_settings.tier_1_limit) then coalesce(v_product.referral_tier_1_commission_percent_bps, v_settings.tier_1_commission_percent_bps)
      when v_rank <= coalesce(v_product.referral_tier_1_limit, v_settings.tier_1_limit) + coalesce(v_product.referral_tier_2_limit, v_settings.tier_2_limit) then coalesce(v_product.referral_tier_2_commission_percent_bps, v_settings.tier_2_commission_percent_bps)
      else coalesce(v_product.referral_tier_3_commission_percent_bps, v_settings.tier_3_commission_percent_bps) end;
  else
    v_commission_bps := case v_product.referral_settings_mode when 'custom' then coalesce(v_product.referral_commission_percent_bps, v_settings.commission_percent_bps) else v_settings.commission_percent_bps end;
  end if;
  v_commission_bps := greatest(0, least(10000, coalesce(v_commission_bps, 0)));
  v_basis_minor := least(round(v_order.paid_amount * 100)::bigint, v_paid_minor);
  v_commission_minor := round(v_basis_minor * v_commission_bps::numeric / 10000)::bigint;
  if v_basis_minor <= 0 or v_commission_minor <= 0 then return null; end if;
  v_status := case when v_settings.shadow_mode then 'shadow' else 'pending' end;
  select coalesce(p_sale_at, paid_at) into v_sale_at from public.payments_v2 where id = v_payment_id;
  -- Missing evidence defers automatic commission; never block a payment write.
  if v_sale_at is null then return null; end if;
  if p_sale_at > now() then raise exception 'sale_date_in_future'; end if;
  v_available_at := coalesce(p_available_at, v_sale_at + make_interval(days => v_settings.hold_days));
  if v_available_at < v_sale_at then raise exception 'availability_before_sale'; end if;
  insert into public.referral_sale_attributions(partner_id, relationship_id, order_id, payment_id, product_id, tariff_id, offer_id, status,
    commission_basis_minor, commission_basis_currency, commission_percent_bps, commission_minor, available_at, rule_snapshot, order_snapshot)
  values (v_partner.id, v_relationship.id, v_order.id, v_payment_id, v_order.product_id, v_order.tariff_id, v_order.offer_id, v_status,
    v_basis_minor, 'BYN', v_commission_bps, v_commission_minor, v_available_at,
    jsonb_build_object('commission_percent_bps', v_commission_bps, 'scheme', v_scheme, 'relationship_rank', v_rank,
      'hold_days', v_settings.hold_days, 'split_60_40_enabled', v_settings.split_60_40_enabled,
      'withdrawable_percent_bps', v_settings.withdrawable_percent_bps, 'version', 5, 'sale_at', v_sale_at, 'available_at_override', p_available_at),
    jsonb_build_object('order_id', v_order.id, 'paid_amount', v_order.paid_amount, 'currency', v_order.currency, 'product_id', v_order.product_id, 'tariff_id', v_order.tariff_id, 'offer_id', v_order.offer_id))
  returning id into v_sale_id;
  if not v_settings.shadow_mode then
    insert into public.referral_balance_transactions(partner_id, transaction_type, idempotency_key, source_type, source_id, description)
      values (v_partner.id, 'commission_pending', 'referral:commission:' || v_sale_id, 'sale_attribution', v_sale_id, trim(trailing '0' from trim(trailing '.' from (v_commission_bps::numeric / 100)::text)) || '% за покупку приглашённого') returning id into v_tx_id;
    v_cash_minor := case when v_settings.split_60_40_enabled then round(v_commission_minor * v_settings.withdrawable_percent_bps::numeric / 10000)::bigint else v_commission_minor end;
    v_internal_minor := v_commission_minor - v_cash_minor;
    if v_cash_minor > 0 then insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx_id, v_partner.id, 'pending', v_cash_minor); end if;
    if v_internal_minor > 0 then insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor) values (v_tx_id, v_partner.id, 'internal_pending', v_internal_minor); end if;
  end if;
  perform public.referral_emit_event('referral.commission.' || v_status, v_sale_id, jsonb_build_object('partner_id', v_partner.id, 'order_id', v_order.id, 'commission_minor', v_commission_minor, 'currency', 'BYN'));
  return v_sale_id;
exception when unique_violation then select id into v_sale_id from public.referral_sale_attributions where order_id = p_order_id; return v_sale_id;
end $$;
REVOKE ALL ON FUNCTION referral_private.process_order_at(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.referral_process_order(p_order_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT referral_private.process_order_at(p_order_id,NULL,NULL);
$$;

create or replace function public.referral_admin_credit_historical_order_at(
  p_relationship_id uuid,
  p_order_id uuid,
  p_reason text,
  p_sale_at timestamptz default null,
  p_available_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_relationship public.referral_relationships%rowtype;
  v_sale_id uuid;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not coalesce(public.referral_is_admin(auth.uid()),false) then raise exception 'forbidden'; end if;
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

  if p_sale_at is null and not exists (
    select 1 from public.payments_v2 where order_id=p_order_id and status::text='succeeded'
     and not coalesce(is_deleted,false) and not coalesce(is_recurring,false) and paid_at is not null
  ) then raise exception 'sale_date_required'; end if;

  -- Reuse the canonical calculation: product override, Club first payment,
  -- recurring-payment exclusion, 60/40 split and idempotency all stay intact.
  v_sale_id := referral_private.process_order_at(p_order_id,p_sale_at,p_available_at);
  if v_sale_id is null then raise exception 'order_not_eligible_for_referral'; end if;

  update public.referral_sale_attributions
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'entered_by_admin', true,
    'administrative_historical', true,
    'entry_kind', 'historical_order_credit',
    'reason', v_reason,
    'actor_user_id', auth.uid(),
    'entered_at', now(),
    'sale_at_override', p_sale_at,
    'available_at_override', p_available_at
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
REVOKE ALL ON FUNCTION public.referral_admin_credit_historical_order_at(uuid,uuid,text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.referral_admin_credit_historical_order_at(uuid,uuid,text,timestamptz,timestamptz) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.referral_admin_credit_historical_order(p_relationship_id uuid,p_order_id uuid,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.referral_admin_credit_historical_order_at(p_relationship_id,p_order_id,p_reason,NULL,NULL);
$$;
