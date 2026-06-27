create or replace function public.create_preorder_deal_atomic(
  p_offer_id        uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_consent         boolean,
  p_user_id         uuid,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer        record;
  v_routing      jsonb;
  v_pipeline_id  uuid;
  v_stage_id     uuid;
  v_norm_email   text;
  v_existing     record;
  v_prereg_id    uuid;
  v_order_id     uuid;
  v_order_num    text;
begin
  if p_offer_id is null then raise exception 'offer_id_required' using errcode='22023'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'name_required' using errcode='22023'; end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email' using errcode='22023'; end if;
  if p_consent is not true then raise exception 'consent_required' using errcode='22023'; end if;

  v_norm_email := lower(btrim(p_email));

  select o.id, o.offer_type, o.is_active, o.amount, t.product_id, o.tariff_id, o.meta
  into v_offer
  from public.tariff_offers o
  join public.tariffs t on t.id = o.tariff_id
  where o.id = p_offer_id;

  if not found then raise exception 'offer_not_found' using errcode='22023'; end if;
  if v_offer.offer_type <> 'preregistration' then raise exception 'offer_type_not_preregistration' using errcode='22023'; end if;
  if v_offer.is_active is not true then raise exception 'offer_inactive' using errcode='22023'; end if;
  if coalesce(v_offer.amount, 0) <> 0 then raise exception 'offer_amount_must_be_zero' using errcode='22023'; end if;

  v_routing     := coalesce(v_offer.meta -> 'crm_routing', '{}'::jsonb);
  v_pipeline_id := nullif(v_routing ->> 'pipeline_id', '')::uuid;
  v_stage_id    := nullif(v_routing ->> 'stage_on_pending', '')::uuid;
  if v_pipeline_id is null or v_stage_id is null then raise exception 'crm_routing_missing' using errcode='22023'; end if;

  select cp.id as prereg_id, (cp.meta ->> 'order_id')::uuid as order_id
  into v_existing
  from public.course_preregistrations cp
  where (cp.meta ->> 'offer_id')::uuid = p_offer_id
    and lower(cp.email) = v_norm_email
    and cp.status in ('new', 'pending', 'draft')
    and cp.created_at > (now() - interval '24 hours')
  order by cp.created_at desc
  limit 1;

  if found then
    return jsonb_build_object('deduped', true, 'preregistration_id', v_existing.prereg_id, 'order_id', v_existing.order_id);
  end if;

  insert into public.course_preregistrations (
    name, email, phone, product_code, tariff_name, source, consent, status, user_id, meta
  ) values (
    btrim(p_name), v_norm_email, nullif(btrim(coalesce(p_phone,'')), ''),
    'cb20_predzapis', null, 'preorder_form', true, 'new', p_user_id,
    jsonb_build_object(
      'product_id', v_offer.product_id,
      'tariff_id',  v_offer.tariff_id,
      'offer_id',   v_offer.id,
      'source',     'preorder_form',
      'idempotency_key', p_idempotency_key
    )
  ) returning id into v_prereg_id;

  v_order_num := 'PREORDER-' || replace(gen_random_uuid()::text, '-', '');

  insert into public.orders_v2 (
    order_number, user_id, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, paid_amount,
    is_trial, customer_email, customer_phone,
    pipeline_id, pipeline_stage_id, deal_date, meta
  ) values (
    v_order_num, p_user_id, v_offer.product_id, v_offer.tariff_id, v_offer.id,
    0, 0, 'BYN', 'draft'::order_status, 0,
    false, v_norm_email, nullif(btrim(coalesce(p_phone,'')), ''),
    v_pipeline_id, v_stage_id, now(),
    jsonb_build_object(
      'source','preorder_form','is_preorder',true,'is_revenue',false,
      'payment_required',false,'access_grant_required',false,
      'preregistration_id', v_prereg_id, 'idempotency_key', p_idempotency_key
    )
  ) returning id into v_order_id;

  update public.course_preregistrations
  set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('order_id', v_order_id),
      updated_at = now()
  where id = v_prereg_id;

  return jsonb_build_object('deduped', false, 'preregistration_id', v_prereg_id, 'order_id', v_order_id);
end;
$$;