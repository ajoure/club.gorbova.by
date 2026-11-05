-- Manual customer bonuses use the existing customer purchase-credit ledger.
-- They never create a referral, partner payout, payment, order or access grant.
create or replace function public.admin_get_customer_bonus_wallet(
  p_profile_id uuid,
  p_request_id uuid default null
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_available bigint; v_entries jsonb; v_payments jsonb; v_request jsonb;
begin
  if auth.uid() is null or not public.referral_is_admin(auth.uid()) then
    raise exception 'bonus_admin_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and not coalesce(is_archived, false)) then
    raise exception 'bonus_contact_not_found';
  end if;
  -- Match the customer wallet after its existing expired-reservation cleanup,
  -- without changing reservations merely by opening this read-only panel.
  select greatest(coalesce(sum(amount_minor), 0), 0)::bigint into v_available
  from public.referral_customer_credit_entries
  where profile_id = p_profile_id and status in ('posted', 'reserved', 'consumed')
    and not (status = 'reserved' and coalesce(expires_at < now(), false) and applied_order_id is null);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id), '[]'::jsonb) into v_entries
  from (
    select id, amount_minor, entry_type, status, created_at, source_payment_id,
      metadata->>'reason' as reason, metadata->>'actor_user_id' as actor_user_id,
      metadata->>'request_id' as request_id
    from public.referral_customer_credit_entries where profile_id = p_profile_id
    order by created_at desc, id limit 50
  ) e;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.paid_at desc nulls last, p.id), '[]'::jsonb) into v_payments
  from (
    select pay.id, pay.paid_at, round(pay.amount * 100)::bigint as amount_minor,
      coalesce(product.name, pay.product_name_raw, 'Оплата') as product_name,
      exists (select 1 from public.referral_customer_credit_entries c where c.source_payment_id = pay.id) as already_credited
    from public.payments_v2 pay
    left join public.orders_v2 o on o.id = pay.order_id
    left join public.products_v2 product on product.id = o.product_id
    where pay.profile_id = p_profile_id and pay.status::text = 'succeeded'
      and pay.currency = 'BYN' and pay.amount > 0 and not coalesce(pay.is_deleted, false)
      and coalesce(pay.refunded_amount, 0) = 0
      and lower(coalesce(pay.transaction_type, '')) not in ('refund', 'void', 'возврат средств')
      and (o.id is null or o.profile_id is null or o.profile_id = p_profile_id)
    order by pay.paid_at desc nulls last, pay.id limit 100
  ) p;
  if p_request_id is not null then
    select jsonb_build_object('entry_id', id, 'profile_id', profile_id, 'amount_minor', amount_minor,
      'reason', metadata->>'reason', 'source_payment_id', source_payment_id, 'status', status)
    into v_request from public.referral_customer_credit_entries
    where profile_id = p_profile_id and entry_type = 'admin_adjustment'
      and checkout_key = 'admin-bonus:' || p_request_id::text;
  end if;
  return jsonb_build_object('available_minor', v_available, 'currency', 'BYN', 'entries', v_entries,
    'payments', v_payments, 'request', v_request);
end $$;
revoke all on function public.admin_get_customer_bonus_wallet(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_get_customer_bonus_wallet(uuid, uuid) to authenticated;

create or replace function public.admin_credit_customer_bonus(
  p_profile_id uuid,
  p_amount_minor bigint,
  p_reason text,
  p_request_id uuid,
  p_source_payment_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_reason text := btrim(p_reason); v_id uuid; v_existing public.referral_customer_credit_entries%rowtype;
  v_payment public.payments_v2%rowtype; v_order_profile uuid; v_key text;
begin
  if auth.uid() is null or not public.referral_is_admin(auth.uid()) then
    raise exception 'bonus_admin_required' using errcode = '42501';
  end if;
  if p_profile_id is null or p_request_id is null or p_amount_minor is null
    or p_amount_minor <= 0 or p_amount_minor > 9007199254740991 then raise exception 'bonus_invalid_amount_or_request'; end if;
  if v_reason is null or length(v_reason) = 0 or length(v_reason) > 1000 then raise exception 'bonus_reason_required'; end if;
  v_key := 'admin-bonus:' || p_request_id::text;
  -- The request lock is global: the same key cannot be raced across contacts.
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  -- Share the existing wallet lock with checkout reservations.
  perform pg_advisory_xact_lock(hashtextextended('referral-credit:' || p_profile_id::text, 0));
  select * into v_existing from public.referral_customer_credit_entries where checkout_key = v_key;
  if v_existing.id is not null then
    if v_existing.entry_type <> 'admin_adjustment' or v_existing.profile_id <> p_profile_id
      or v_existing.amount_minor <> p_amount_minor or v_existing.metadata->>'reason' is distinct from v_reason
      or v_existing.source_payment_id is distinct from p_source_payment_id then raise exception 'bonus_request_conflict'; end if;
    return jsonb_build_object('entry_id', v_existing.id, 'created', false);
  end if;
  perform 1 from public.profiles where id = p_profile_id and not coalesce(is_archived, false) for share;
  if not found then raise exception 'bonus_contact_not_found'; end if;
  if p_source_payment_id is not null then
    select * into v_payment from public.payments_v2 where id = p_source_payment_id for update;
    if not found then raise exception 'bonus_payment_not_eligible'; end if;
    if v_payment.profile_id is distinct from p_profile_id or v_payment.status::text <> 'succeeded'
      or v_payment.currency <> 'BYN' or v_payment.amount <= 0 or coalesce(v_payment.is_deleted, false)
      or coalesce(v_payment.refunded_amount, 0) <> 0
      or lower(coalesce(v_payment.transaction_type, '')) in ('refund', 'void', 'возврат средств')
      or p_amount_minor > round(v_payment.amount * 100)::bigint then raise exception 'bonus_payment_not_eligible'; end if;
    if v_payment.order_id is not null then
      select profile_id into v_order_profile from public.orders_v2 where id = v_payment.order_id;
      if v_order_profile is not null and v_order_profile <> p_profile_id then raise exception 'bonus_payment_contact_conflict'; end if;
    end if;
    -- A separate refund row must not be mistaken for an unchanged successful receipt.
    if exists (select 1 from public.payments_v2 r where not coalesce(r.is_deleted, false)
      and (r.status::text = 'refunded' or (r.status::text = 'succeeded' and lower(coalesce(r.transaction_type, '')) = 'refund'))
      and (r.reference_payment_id::text = v_payment.id::text
        or (v_payment.provider_payment_id is not null and r.reference_payment_id::text = v_payment.provider_payment_id)
        or r.meta->>'parent_payment_id' = v_payment.id::text)) then raise exception 'bonus_payment_refund_found'; end if;
    if exists (select 1 from public.referral_customer_credit_entries where source_payment_id = p_source_payment_id) then
      raise exception 'bonus_payment_already_credited';
    end if;
  end if;
  insert into public.referral_customer_credit_entries(
    profile_id, amount_minor, entry_type, status, source_payment_id, source_order_id, checkout_key, metadata
  ) values (
    p_profile_id, p_amount_minor, 'admin_adjustment', 'posted', p_source_payment_id, v_payment.order_id, v_key,
    jsonb_build_object('reason', v_reason, 'actor_user_id', auth.uid(), 'request_id', p_request_id, 'manual_customer_bonus', true)
  ) returning id into v_id;
  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, meta)
  values (auth.uid(), 'user', 'customer_bonus_manually_credited', 'referral_customer_credit_entry', v_id,
    jsonb_build_object('profile_id', p_profile_id, 'amount_minor', p_amount_minor, 'currency', 'BYN',
      'reason', v_reason, 'source_payment_id', p_source_payment_id, 'request_id', p_request_id));
  return jsonb_build_object('entry_id', v_id, 'created', true);
end $$;
revoke all on function public.admin_credit_customer_bonus(uuid, bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_credit_customer_bonus(uuid, bigint, text, uuid, uuid) to authenticated;

-- Customer-facing read is independent of referral-program enrollment/settings.
-- Internal reasons, actor identity and request keys never leave the admin API.
create or replace function public.get_my_customer_bonus_wallet()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
declare v_profile_id uuid; v_available bigint; v_entries jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select id into v_profile_id from public.profiles
    where user_id = auth.uid() and not coalesce(is_archived, false) order by created_at, id limit 1;
  select greatest(coalesce(sum(amount_minor), 0), 0)::bigint into v_available
  from public.referral_customer_credit_entries where profile_id = v_profile_id
    and status in ('posted', 'reserved', 'consumed')
    and not (status = 'reserved' and coalesce(expires_at < now(), false) and applied_order_id is null);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc, e.id), '[]'::jsonb) into v_entries
  from (select id, amount_minor, entry_type, status, created_at from public.referral_customer_credit_entries
    where profile_id = v_profile_id and status in ('posted', 'reserved', 'consumed')
      and not (status = 'reserved' and coalesce(expires_at < now(), false) and applied_order_id is null)
    order by created_at desc, id limit 10) e;
  return jsonb_build_object('available_minor', v_available, 'currency', 'BYN', 'entries', v_entries);
end $$;
revoke all on function public.get_my_customer_bonus_wallet() from public, anon, authenticated;
grant execute on function public.get_my_customer_bonus_wallet() to authenticated;
