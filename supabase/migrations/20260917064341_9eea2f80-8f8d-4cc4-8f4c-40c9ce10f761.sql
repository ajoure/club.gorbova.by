CREATE OR REPLACE FUNCTION public.materialize_composable_order_group(_primary_order_id uuid, _quote jsonb, _source text, _idempotency_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_primary public.orders_v2%ROWTYPE;
  v_group_id uuid;
  v_item jsonb;
  v_index integer := 0;
  v_order_id uuid;
  v_order_number text;
  v_role text;
BEGIN
  SELECT * INTO v_primary FROM public.orders_v2 WHERE id = _primary_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'primary_order_not_found'; END IF;
  IF jsonb_typeof(_quote->'items') <> 'array' OR jsonb_array_length(_quote->'items') < 1 THEN
    RAISE EXCEPTION 'quote_items_required';
  END IF;
  IF ((_quote->'items'->0->>'product_id')::uuid IS DISTINCT FROM v_primary.product_id)
     OR ((_quote->'items'->0->>'tariff_id')::uuid IS DISTINCT FROM v_primary.tariff_id)
     OR ((_quote->'items'->0->>'offer_id')::uuid IS DISTINCT FROM v_primary.offer_id) THEN
    RAISE EXCEPTION 'primary_quote_order_mismatch';
  END IF;

  -- Идемпотентность: группа для этого заказа уже может быть создана другим каналом
  SELECT id INTO v_group_id
  FROM public.order_groups
  WHERE idempotency_key = _idempotency_key
     OR primary_order_id = _primary_order_id
     OR group_number = 'GRP-' || v_primary.order_number
  LIMIT 1;
  IF v_group_id IS NOT NULL THEN
    RETURN v_group_id;
  END IF;

  INSERT INTO public.order_groups (
    group_number, profile_id, user_id, primary_order_id, payer_type, status,
    currency, subtotal, adjustment_amount, total_amount, adjustment_reason,
    payment_method, source, idempotency_key, quote_snapshot, meta
  ) VALUES (
    'GRP-' || v_primary.order_number, v_primary.profile_id, v_primary.user_id,
    v_primary.id, v_primary.payer_type,
    CASE WHEN v_primary.status::text = 'paid' THEN 'paid' ELSE 'pending' END,
    COALESCE(_quote->>'currency', v_primary.currency),
    (_quote->>'subtotal')::numeric,
    COALESCE((_quote->>'adjustment_amount')::numeric, 0),
    (_quote->>'total')::numeric,
    NULLIF(_quote->>'adjustment_reason', ''),
    v_primary.meta->>'payment_method', _source, _idempotency_key, _quote,
    jsonb_build_object('single_crm_deal', true, 'separate_entitlements', true)
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_group_id;
  IF v_group_id IS NULL THEN
    SELECT id INTO v_group_id
    FROM public.order_groups
    WHERE idempotency_key = _idempotency_key
       OR primary_order_id = _primary_order_id
    LIMIT 1;
    RETURN v_group_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(_quote->'items')
  LOOP
    v_role := COALESCE(v_item->>'role', CASE WHEN v_index = 0 THEN 'primary' ELSE 'addon' END);
    IF v_role = 'primary' THEN
      v_order_id := v_primary.id;
    ELSE
      v_order_number := v_primary.order_number || '-A' || v_index::text;
      INSERT INTO public.orders_v2 (
        order_number, product_id, tariff_id, offer_id, profile_id, user_id,
        customer_email, customer_phone, payer_type, status, reconcile_source,
        base_price, final_price, paid_amount, currency, purchase_snapshot, meta
      ) VALUES (
        v_order_number, (v_item->>'product_id')::uuid, (v_item->>'tariff_id')::uuid,
        (v_item->>'offer_id')::uuid, v_primary.profile_id, v_primary.user_id,
        v_primary.customer_email, v_primary.customer_phone, v_primary.payer_type,
        v_primary.status, 'composable_checkout',
        (v_item->>'list_amount')::numeric, (v_item->>'final_amount')::numeric,
        CASE WHEN v_primary.status::text = 'paid' THEN (v_item->>'final_amount')::numeric ELSE 0 END,
        COALESCE(_quote->>'currency', v_primary.currency), v_item,
        jsonb_build_object(
          'order_group_id', v_group_id,
          'group_primary_order_id', v_primary.id,
          'group_child_order', true,
          'exclude_separate_crm_deal', true
        )
      ) RETURNING id INTO v_order_id;
    END IF;

    INSERT INTO public.order_group_items (
      order_group_id, order_id, role, product_id, tariff_id, offer_id,
      list_amount, discount_amount, final_amount, sort_order, item_snapshot
    ) VALUES (
      v_group_id, v_order_id, v_role, (v_item->>'product_id')::uuid,
      (v_item->>'tariff_id')::uuid, (v_item->>'offer_id')::uuid,
      (v_item->>'list_amount')::numeric, COALESCE((v_item->>'discount_amount')::numeric, 0),
      (v_item->>'final_amount')::numeric, v_index, v_item
    );
    v_index := v_index + 1;
  END LOOP;

  UPDATE public.orders_v2
  SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
    'order_group_id', v_group_id,
    'composable_checkout', _quote,
    'single_crm_deal', true
  )
  WHERE id = v_primary.id;
  RETURN v_group_id;
END;
$function$;