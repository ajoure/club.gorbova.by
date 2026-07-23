-- Different module sets for the same RR offer/contact must never reuse one
-- another's pending application.
DROP FUNCTION IF EXISTS public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb,
  _crm_routing_snapshot jsonb DEFAULT NULL,
  _pipeline_id uuid DEFAULT NULL,
  _pipeline_stage_id uuid DEFAULT NULL,
  _checkout_fingerprint text DEFAULT ''
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_lock_key bigint;
  v_order_number text;
  v_meta jsonb := COALESCE(_meta, '{}'::jsonb);
  v_fingerprint text := COALESCE(_checkout_fingerprint, '');
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'')||'|'||coalesce(_user_id::text,'')||'|'||
    coalesce(_email_norm,'')||'|'||coalesce(_phone_norm,'')||'|'||v_fingerprint, 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND coalesce(o.meta->>'checkout_fingerprint', '') = v_fingerprint
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (_email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm)
     AND (_phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm)
     AND (
       (o.status = 'pending'::order_status
        AND (o.meta->'rr'->>'upstream_call_state') = 'started'
        AND coalesce(o.meta->'rr'->>'initiation_status','pending') NOT IN ('created','failed'))
       OR (o.status = 'pending'::order_status AND (o.meta->'rr'->>'local_persist_failed') = 'true')
       OR (o.status = 'pending'::order_status AND (o.meta->'rr'->>'upstream_outcome') = 'unknown'
           AND coalesce(o.meta->'rr'->>'reconciliation_status','pending') IN ('pending','operator_required'))
       OR (o.status = 'pending'::order_status AND (o.meta->'rr'->>'reconciliation_status') = 'resolved'
           AND coalesce(o.meta->'rr'->>'operator_resolution','') IN ('keep_blocked','confirm_created'))
       OR (o.status = 'pending'::order_status AND o.created_at >= now() - interval '30 minutes'
           AND (((o.meta->'rr'->>'initiation_status') = 'created' AND coalesce(o.meta->'rr'->>'payment_url','') <> '')
             OR ((o.meta->'rr'->>'initiation_status') = 'pending'
                 AND o.created_at >= now() - interval '120 seconds'
                 AND (o.meta->'rr'->>'local_persist_failed') IS DISTINCT FROM 'true'
                 AND (o.meta->'rr'->>'upstream_outcome') IS DISTINCT FROM 'unknown'
                 AND (o.meta->'rr'->>'upstream_call_state') IS DISTINCT FROM 'started')))
     )
   ORDER BY
     CASE
       WHEN (o.meta->'rr'->>'upstream_call_state') = 'started'
            AND coalesce(o.meta->'rr'->>'initiation_status','pending') NOT IN ('created','failed') THEN 0
       WHEN (o.meta->'rr'->>'local_persist_failed') = 'true' THEN 1
       WHEN (o.meta->'rr'->>'upstream_outcome') = 'unknown' THEN 2
       WHEN (o.meta->'rr'->>'reconciliation_status') = 'resolved' THEN 3
       WHEN (o.meta->'rr'->>'initiation_status') = 'created' THEN 4
       ELSE 5
     END, o.created_at DESC LIMIT 1;

  IF FOUND THEN
    order_id := v_row.id; was_reused := true; order_number := v_row.order_number;
    RETURN NEXT; RETURN;
  END IF;

  v_meta := jsonb_set(
    v_meta, '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object('upstream_call_state','not_started'),
    true
  );
  v_meta := jsonb_set(v_meta, '{checkout_fingerprint}', to_jsonb(v_fingerprint), true);
  IF _crm_routing_snapshot IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{crm_routing_snapshot}', _crm_routing_snapshot, true);
  END IF;

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, provider,
    customer_email, customer_phone, customer_ip, user_id, meta,
    pipeline_id, pipeline_stage_id)
  VALUES (v_order_number, _product_id, _tariff_id, _offer_id, _amount, _amount, _currency,
    'pending'::order_status, 'rr', _customer_email, _customer_phone, _customer_ip, _user_id, v_meta,
    _pipeline_id, _pipeline_stage_id)
  RETURNING * INTO v_row;
  order_id := v_row.id; was_reused := false; order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb,
  jsonb, uuid, uuid, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_composable_order_group(
  _primary_order_id uuid,
  _payment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_group public.order_groups%ROWTYPE;
  v_payment public.payments_v2%ROWTYPE;
  v_item record;
  v_subtotal numeric;
  v_allocated numeric := 0;
  v_amount numeric;
  v_count integer;
  v_index integer := 0;
BEGIN
  SELECT * INTO v_group FROM public.order_groups
  WHERE primary_order_id = _primary_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'state', 'not_grouped');
  END IF;

  SELECT * INTO v_payment FROM public.payments_v2
  WHERE id = _payment_id AND order_id = _primary_order_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status::text <> 'succeeded' THEN
    RAISE EXCEPTION 'succeeded_primary_payment_required';
  END IF;
  IF upper(v_payment.currency) IS DISTINCT FROM upper(v_group.currency) THEN
    RAISE EXCEPTION 'group_payment_currency_mismatch';
  END IF;
  IF v_payment.amount IS DISTINCT FROM v_group.total_amount THEN
    RAISE EXCEPTION 'group_payment_amount_mismatch';
  END IF;

  SELECT count(*), sum(final_amount) INTO v_count, v_subtotal
  FROM public.order_group_items WHERE order_group_id = v_group.id;

  FOR v_item IN
    SELECT * FROM public.order_group_items
    WHERE order_group_id = v_group.id ORDER BY sort_order, id
  LOOP
    v_index := v_index + 1;
    v_amount := CASE
      WHEN v_index = v_count THEN v_payment.amount - v_allocated
      WHEN coalesce(v_subtotal, 0) = 0 THEN 0
      ELSE round(v_payment.amount * v_item.final_amount / v_subtotal, 2)
    END;
    v_allocated := v_allocated + v_amount;

    INSERT INTO public.payment_allocations(
      payment_id, order_group_id, order_group_item_id, amount
    ) VALUES (_payment_id, v_group.id, v_item.id, v_amount)
    ON CONFLICT (payment_id, order_group_item_id)
    DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();

    UPDATE public.orders_v2
    SET status = 'paid'::order_status,
        paid_amount = v_amount,
        deal_date = COALESCE(deal_date, v_payment.paid_at, now()),
        meta = COALESCE(meta, '{}'::jsonb) ||
          jsonb_build_object('group_payment_id', _payment_id)
    WHERE id = v_item.order_id AND v_item.role = 'addon';
  END LOOP;

  UPDATE public.order_groups
  SET status = 'paid', paid_at = COALESCE(v_payment.paid_at, now()), updated_at = now()
  WHERE id = v_group.id;
  RETURN jsonb_build_object('ok', true, 'state', 'settled', 'group_id', v_group.id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_composable_order_group(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_composable_order_group(uuid, uuid)
  TO service_role;
