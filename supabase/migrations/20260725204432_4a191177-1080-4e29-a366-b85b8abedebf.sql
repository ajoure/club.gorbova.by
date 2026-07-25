-- Administrative referral corrections.
drop function if exists public.referral_admin_list_historical_orders(uuid);

create function public.referral_admin_list_historical_orders(p_relationship_id uuid)
returns table(
  order_id uuid,
  order_number text,
  created_at timestamptz,
  product_name text,
  paid_minor bigint,
  payments_count integer,
  commissionable boolean,
  sale_id uuid,
  sale_status text,
  sale_commission_minor bigint,
  sale_reversed_minor bigint,
  credit_action text,
  can_reverse boolean
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
      and coalesce(pr.referral_settings_mode, 'inherit') <> 'disabled',
    rsa.id,
    rsa.status,
    rsa.commission_minor,
    rsa.reversed_minor,
    case
      when rsa.id is null
        and coalesce(payment_totals.paid_minor, 0) > 0
        and pr.id is not null
        and coalesce(pr.referral_settings_mode, 'inherit') <> 'disabled' then 'credit'
      when rsa.reversed_minor >= rsa.commission_minor
        and coalesce(rsa.metadata->>'admin_can_restore', 'false') = 'true' then 'restore'
      when rsa.id is not null then 'credited'
      else 'ineligible'
    end,
    rsa.id is not null
      and rsa.reversed_minor < rsa.commission_minor
      and rsa.status in ('pending', 'shadow')
  from public.referral_relationships rr
  join public.orders_v2 o on o.profile_id = rr.referred_profile_id
  left join public.products_v2 pr on pr.id = o.product_id
  left join public.referral_sale_attributions rsa on rsa.order_id = o.id
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
  order by o.created_at desc;
end $$;
revoke all on function public.referral_admin_list_historical_orders(uuid) from public, anon;
grant execute on function public.referral_admin_list_historical_orders(uuid) to authenticated, service_role;

create function public.referral_admin_reverse_sale_attribution(
  p_sale_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sale public.referral_sale_attributions%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_tx_id uuid;
  v_cash_minor bigint;
  v_internal_minor bigint;
  v_counter integer;
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;

  select * into v_sale from public.referral_sale_attributions where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'sale_not_found'; end if;
  if v_sale.status not in ('pending', 'shadow') then
    raise exception 'sale_not_pending_for_admin_reversal';
  end if;
  if v_sale.reversed_minor >= v_sale.commission_minor then raise exception 'sale_already_reversed'; end if;

  if v_sale.status <> 'shadow' then
    v_cash_minor := case when coalesce((v_sale.rule_snapshot->>'split_60_40_enabled')::boolean, false)
      then round((v_sale.commission_minor - v_sale.reversed_minor)
        * coalesce((v_sale.rule_snapshot->>'withdrawable_percent_bps')::integer, 10000)::numeric / 10000)::bigint
      else v_sale.commission_minor - v_sale.reversed_minor end;
    v_internal_minor := v_sale.commission_minor - v_sale.reversed_minor - v_cash_minor;
    select count(*) into v_counter
    from public.referral_balance_transactions
    where source_id = v_sale.id
      and coalesce(metadata->>'admin_correction', 'false') = 'true'
      and transaction_type = 'refund_reversal';
    insert into public.referral_balance_transactions(
      partner_id, transaction_type, idempotency_key, source_type, source_id, description, created_by, metadata
    ) values (
      v_sale.partner_id, 'refund_reversal', 'referral:admin-reverse:' || v_sale.id || ':' || (v_counter + 1),
      'sale_attribution', v_sale.id, 'Администратор исключил покупку из реферального расчёта', auth.uid(),
      jsonb_build_object('admin_correction', true, 'reason', v_reason, 'reversal_minor', v_sale.commission_minor - v_sale.reversed_minor)
    ) returning id into v_tx_id;
    if v_cash_minor > 0 then
      insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
      values (v_tx_id, v_sale.partner_id, 'pending', -v_cash_minor);
    end if;
    if v_internal_minor > 0 then
      insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
      values (v_tx_id, v_sale.partner_id, 'internal_pending', -v_internal_minor);
    end if;
  end if;

  update public.referral_sale_attributions
  set reversed_minor = commission_minor,
      status = 'reversed',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_can_restore', true,
        'admin_last_correction', jsonb_build_object(
          'action', 'excluded_by_admin', 'reason', v_reason, 'actor_user_id', auth.uid(),
          'at', now(), 'original_status', v_sale.status
        )
      ),
      updated_at = now()
  where id = v_sale.id;

  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_sale_excluded_by_admin', 'referral_sale_attribution', v_sale.id,
    jsonb_build_object('reason', v_reason, 'order_id', v_sale.order_id, 'reversal_minor', v_sale.commission_minor - v_sale.reversed_minor));
  perform public.referral_emit_event('referral.commission.reversed', v_sale.id,
    jsonb_build_object('admin_correction', true, 'reason', v_reason, 'order_id', v_sale.order_id));

  return jsonb_build_object('sale_id', v_sale.id, 'reversed', true);
end $$;
revoke all on function public.referral_admin_reverse_sale_attribution(uuid, text) from public, anon;
grant execute on function public.referral_admin_reverse_sale_attribution(uuid, text) to authenticated, service_role;

create function public.referral_admin_restore_sale_attribution(
  p_sale_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sale public.referral_sale_attributions%rowtype;
  v_reason text := nullif(trim(p_reason), '');
  v_original_status text;
  v_tx_id uuid;
  v_cash_minor bigint;
  v_internal_minor bigint;
  v_counter integer;
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;

  select * into v_sale from public.referral_sale_attributions where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'sale_not_found'; end if;
  if v_sale.status <> 'reversed' or coalesce(v_sale.metadata->>'admin_can_restore', 'false') <> 'true' then
    raise exception 'sale_not_restorable';
  end if;
  v_original_status := coalesce(v_sale.metadata->'admin_last_correction'->>'original_status', 'pending');
  if v_original_status not in ('pending', 'shadow') then raise exception 'sale_not_restorable'; end if;

  if v_original_status <> 'shadow' then
    v_cash_minor := case when coalesce((v_sale.rule_snapshot->>'split_60_40_enabled')::boolean, false)
      then round(v_sale.commission_minor
        * coalesce((v_sale.rule_snapshot->>'withdrawable_percent_bps')::integer, 10000)::numeric / 10000)::bigint
      else v_sale.commission_minor end;
    v_internal_minor := v_sale.commission_minor - v_cash_minor;
    select count(*) into v_counter
    from public.referral_balance_transactions
    where source_id = v_sale.id
      and coalesce(metadata->>'admin_correction', 'false') = 'true'
      and transaction_type = 'commission_pending';
    insert into public.referral_balance_transactions(
      partner_id, transaction_type, idempotency_key, source_type, source_id, description, created_by, metadata
    ) values (
      v_sale.partner_id, 'commission_pending', 'referral:admin-restore:' || v_sale.id || ':' || (v_counter + 1),
      'sale_attribution', v_sale.id, 'Администратор восстановил реферальное начисление', auth.uid(),
      jsonb_build_object('admin_correction', true, 'reason', v_reason, 'restored_minor', v_sale.commission_minor)
    ) returning id into v_tx_id;
    if v_cash_minor > 0 then
      insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
      values (v_tx_id, v_sale.partner_id, 'pending', v_cash_minor);
    end if;
    if v_internal_minor > 0 then
      insert into public.referral_balance_entries(transaction_id, partner_id, bucket, amount_minor)
      values (v_tx_id, v_sale.partner_id, 'internal_pending', v_internal_minor);
    end if;
  end if;

  update public.referral_sale_attributions
  set reversed_minor = 0,
      status = v_original_status,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_can_restore', false,
        'admin_last_correction', jsonb_build_object(
          'action', 'restored_by_admin', 'reason', v_reason, 'actor_user_id', auth.uid(), 'at', now()
        )
      ),
      updated_at = now()
  where id = v_sale.id;

  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_sale_restored_by_admin', 'referral_sale_attribution', v_sale.id,
    jsonb_build_object('reason', v_reason, 'order_id', v_sale.order_id, 'restored_minor', v_sale.commission_minor));
  perform public.referral_emit_event('referral.commission.pending', v_sale.id,
    jsonb_build_object('admin_correction', true, 'reason', v_reason, 'order_id', v_sale.order_id));

  return jsonb_build_object('sale_id', v_sale.id, 'restored', true);
end $$;
revoke all on function public.referral_admin_restore_sale_attribution(uuid, text) from public, anon;
grant execute on function public.referral_admin_restore_sale_attribution(uuid, text) to authenticated, service_role;

create function public.referral_admin_revoke_relationship(
  p_relationship_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_relationship public.referral_relationships%rowtype;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  select * into v_relationship from public.referral_relationships where id = p_relationship_id for update;
  if v_relationship.id is null or v_relationship.status <> 'active' then raise exception 'active_relationship_not_found'; end if;
  perform 1 from public.referral_sale_attributions where relationship_id = v_relationship.id for update;
  if exists (
    select 1 from public.referral_sale_attributions
    where relationship_id = v_relationship.id and commission_minor > reversed_minor
  ) then raise exception 'relationship_has_unreversed_accruals'; end if;

  update public.referral_relationships
  set status = 'revoked', revoked_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_last_correction', jsonb_build_object('action', 'revoked_by_admin', 'reason', v_reason, 'actor_user_id', auth.uid(), 'at', now())
      )
  where id = v_relationship.id;
  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_relationship_revoked_by_admin', 'referral_relationship', v_relationship.id,
    jsonb_build_object('reason', v_reason, 'partner_id', v_relationship.partner_id, 'referred_profile_id', v_relationship.referred_profile_id));
end $$;
revoke all on function public.referral_admin_revoke_relationship(uuid, text) from public, anon;
grant execute on function public.referral_admin_revoke_relationship(uuid, text) to authenticated, service_role;

create function public.referral_admin_reassign_relationship(
  p_relationship_id uuid,
  p_new_partner_profile_id uuid,
  p_reason text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_relationship public.referral_relationships%rowtype;
  v_new_partner_id uuid;
  v_new_relationship_id uuid;
  v_reason text := nullif(trim(p_reason), '');
begin
  if not public.referral_is_admin(auth.uid()) then raise exception 'forbidden'; end if;
  if v_reason is null then raise exception 'reason_required'; end if;
  select * into v_relationship from public.referral_relationships where id = p_relationship_id for update;
  if v_relationship.id is null or v_relationship.status <> 'active' then raise exception 'active_relationship_not_found'; end if;
  perform 1 from public.referral_sale_attributions where relationship_id = v_relationship.id for update;
  select id into v_new_partner_id from public.referral_partners
  where profile_id = p_new_partner_profile_id and status = 'active';
  if v_new_partner_id is null then raise exception 'active_partner_not_found'; end if;
  if v_new_partner_id = v_relationship.partner_id then raise exception 'same_partner'; end if;
  if p_new_partner_profile_id = v_relationship.referred_profile_id then raise exception 'self_referral'; end if;
  if exists (
    select 1 from public.referral_sale_attributions
    where relationship_id = v_relationship.id and commission_minor > reversed_minor
  ) then raise exception 'relationship_has_unreversed_accruals'; end if;
  if exists (
    select 1 from public.referral_sale_attributions
    where relationship_id = v_relationship.id
      and commission_minor = reversed_minor
      and coalesce(metadata->>'admin_can_restore', 'false') <> 'true'
  ) then raise exception 'relationship_has_nontransferable_history'; end if;

  update public.referral_relationships
  set status = 'revoked', revoked_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'admin_last_correction', jsonb_build_object('action', 'reassigned_by_admin', 'reason', v_reason, 'actor_user_id', auth.uid(), 'at', now())
      )
  where id = v_relationship.id;

  insert into public.referral_relationships(
    partner_id, referred_profile_id, source, manual_reason, manual_actor_user_id, metadata
  ) values (
    v_new_partner_id, v_relationship.referred_profile_id, 'admin_manual', v_reason, auth.uid(),
    jsonb_build_object('administrative_historical', true, 'entered_by_admin', true,
      'entry_kind', 'corrected_referral_link', 'reassigned_from_relationship_id', v_relationship.id,
      'reason', v_reason, 'entered_at', now())
  ) returning id into v_new_relationship_id;

  update public.referral_sale_attributions
  set partner_id = v_new_partner_id,
      relationship_id = v_new_relationship_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'administrative_transfer', jsonb_build_object('from_relationship_id', v_relationship.id,
          'to_relationship_id', v_new_relationship_id, 'reason', v_reason, 'actor_user_id', auth.uid(), 'at', now())
      ),
      updated_at = now()
  where relationship_id = v_relationship.id
    and commission_minor = reversed_minor
    and coalesce(metadata->>'admin_can_restore', 'false') = 'true';

  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'referral_relationship_reassigned_by_admin', 'referral_relationship', v_new_relationship_id,
    jsonb_build_object('reason', v_reason, 'previous_relationship_id', v_relationship.id,
      'previous_partner_id', v_relationship.partner_id, 'new_partner_id', v_new_partner_id,
      'referred_profile_id', v_relationship.referred_profile_id));
  return v_new_relationship_id;
end $$;
revoke all on function public.referral_admin_reassign_relationship(uuid, uuid, text) from public, anon;
grant execute on function public.referral_admin_reassign_relationship(uuid, uuid, text) to authenticated, service_role;