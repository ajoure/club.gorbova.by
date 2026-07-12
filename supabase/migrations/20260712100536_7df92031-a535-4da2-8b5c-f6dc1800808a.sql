
-- =========================================================================
-- Sprint C2 / Этап D: D.1 promote-RPC patch + D.2 canonical financials RPC + D.3 backfill
-- =========================================================================

-- D.1 — rr_promote_authorized_order: provider_payment_id = NULL, external_reference в meta
CREATE OR REPLACE FUNCTION public.rr_promote_authorized_order(
  _order_id uuid,
  _source text,
  _rr_status_raw text,
  _sign_hash_short text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_action text;
  v_now timestamptz := now();
  v_payment_id uuid;
  v_fulfillment jsonb;
BEGIN
  v_action := CASE lower(coalesce(_rr_status_raw, ''))
    WHEN 'authorized' THEN 'authorize'
    WHEN 'authorized_all' THEN 'authorize'
    ELSE 'ignore'
  END;

  IF v_action <> 'authorize' THEN
    RETURN jsonb_build_object('state','ignored','reason','non_authorize_status','rr_status_raw',_rr_status_raw);
  END IF;

  SELECT id, provider, status::text AS status_text, final_price, currency,
         paid_amount, provider_payment_id, meta, product_id, tariff_id, offer_id, user_id
    INTO v_order
  FROM public.orders_v2
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found');
  END IF;

  IF v_order.provider IS DISTINCT FROM 'rr' THEN
    RETURN jsonb_build_object('state','wrong_provider','provider',v_order.provider);
  END IF;

  IF (v_order.meta->>'flow') IS DISTINCT FROM 'rr_installment' THEN
    RETURN jsonb_build_object('state','wrong_flow','flow',v_order.meta->>'flow');
  END IF;

  IF v_order.status_text = 'paid' THEN
    SELECT id INTO v_payment_id
      FROM public.payments_v2
     WHERE order_id = _order_id AND provider = 'rr' AND status = 'succeeded'
     LIMIT 1;

    v_fulfillment := coalesce(v_order.meta->'rr'->'fulfillment', jsonb_build_object('status','pending','attempts',0));

    RETURN jsonb_build_object(
      'state','already_promoted',
      'should_grant_access', (coalesce(v_fulfillment->>'status','pending') <> 'completed'),
      'order_status','paid',
      'payment_id',v_payment_id,
      'fulfillment',v_fulfillment
    );
  END IF;

  UPDATE public.orders_v2
     SET status = 'paid'::order_status,
         paid_amount = coalesce(final_price, paid_amount),
         meta = coalesce(meta,'{}'::jsonb)
              || jsonb_build_object('rr',
                   coalesce(meta->'rr','{}'::jsonb)
                   || jsonb_build_object(
                        'promotion', jsonb_build_object(
                          'promoted_at', to_jsonb(v_now),
                          'source', _source,
                          'sign_hash_short', _sign_hash_short,
                          'rr_status_raw', _rr_status_raw
                        ),
                        'fulfillment', jsonb_build_object('status','pending','attempts',0)
                      )
                 ),
         updated_at = v_now
   WHERE id = _order_id;

  -- provider_payment_id = NULL: RR не выдаёт независимый transaction ID.
  -- Локальный order_id продублирован в meta.rr.external_reference с явной семантикой.
  INSERT INTO public.payments_v2 (
    order_id, user_id, amount, currency, status, provider, provider_payment_id,
    paid_at, meta, transaction_type, origin
  ) VALUES (
    _order_id, v_order.user_id, v_order.final_price, v_order.currency,
    'succeeded'::payment_status, 'rr',
    NULL,
    v_now,
    jsonb_build_object(
      'source', _source,
      'sign_hash_short', _sign_hash_short,
      'rr_status_raw', _rr_status_raw,
      'flow', 'rr_installment',
      'rr', jsonb_build_object(
        'external_reference', _order_id::text,
        'reference_semantics', 'merchant_order_id_echo'
      )
    ),
    'sale','rr_installment'
  )
  ON CONFLICT (order_id) WHERE provider = 'rr' AND status = 'succeeded' DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    SELECT id INTO v_payment_id
      FROM public.payments_v2
     WHERE order_id = _order_id AND provider = 'rr' AND status = 'succeeded'
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'state','promoted',
    'should_grant_access', true,
    'order_status','paid',
    'payment_id',v_payment_id,
    'fulfillment', jsonb_build_object('status','pending','attempts',0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rr_promote_authorized_order(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_promote_authorized_order(uuid, text, text, text) TO service_role;

-- =========================================================================
-- D.2 — canonical helper: rr_update_payment_financials
-- =========================================================================
CREATE OR REPLACE FUNCTION public.rr_update_payment_financials(
  _order_id         uuid,
  _commission_minor bigint,
  _currency         text,
  _raw              jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment RECORD;
  v_existing jsonb;
  v_prev_amount_minor bigint;
  v_prev_currency text;
  v_prev_captured text;
  v_history jsonb;
  v_new_commission jsonb;
  v_now timestamptz := now();
BEGIN
  IF _order_id IS NULL THEN
    RETURN jsonb_build_object('status','invalid_input','reason','order_id_required');
  END IF;

  IF _commission_minor IS NULL THEN
    RETURN jsonb_build_object('status','unchanged','reason','no_new_value');
  END IF;

  SELECT id, meta, amount, currency
    INTO v_payment
  FROM public.payments_v2
  WHERE order_id = _order_id
    AND provider = 'rr'
    AND status = 'succeeded'
  ORDER BY paid_at NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','payment_not_found','order_id',_order_id);
  END IF;

  v_existing := coalesce(v_payment.meta->'commission', 'null'::jsonb);

  IF v_existing IS NOT NULL AND v_existing <> 'null'::jsonb THEN
    v_prev_amount_minor := NULLIF(v_existing->>'amount_minor','')::bigint;
    v_prev_currency := v_existing->>'currency';
    v_prev_captured := v_existing->>'captured_at';

    IF v_prev_amount_minor IS NOT DISTINCT FROM _commission_minor
       AND coalesce(v_prev_currency,'') = coalesce(_currency,'') THEN
      RETURN jsonb_build_object(
        'status','unchanged',
        'payment_id', v_payment.id,
        'commission_minor', _commission_minor
      );
    END IF;
  END IF;

  v_new_commission := jsonb_build_object(
    'amount_minor', _commission_minor,
    'currency', _currency,
    'source', 'rr.getOrderStatus',
    'captured_at', to_jsonb(v_now),
    'raw', coalesce(_raw, '{}'::jsonb)
  );

  IF v_existing IS NOT NULL AND v_existing <> 'null'::jsonb THEN
    v_history := coalesce(v_payment.meta->'commission_history', '[]'::jsonb)
                 || jsonb_build_array(v_existing);
  ELSE
    v_history := coalesce(v_payment.meta->'commission_history', '[]'::jsonb);
  END IF;

  UPDATE public.payments_v2
     SET meta = coalesce(meta,'{}'::jsonb)
              || jsonb_build_object(
                   'commission', v_new_commission,
                   'commission_history', v_history
                 ),
         updated_at = v_now
   WHERE id = v_payment.id;

  RETURN jsonb_build_object(
    'status','updated',
    'payment_id', v_payment.id,
    'commission_minor', _commission_minor,
    'previous_amount_minor', v_prev_amount_minor,
    'history_len', jsonb_array_length(v_history)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rr_update_payment_financials(uuid, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_update_payment_financials(uuid, bigint, text, jsonb) TO service_role;

-- =========================================================================
-- D.3 — Backfill 4 RR-платежей: очистка provider_payment_id, meta.rr.external_reference
-- Идемпотентно: WHERE provider_payment_id IS NOT NULL AND = order_id::text
-- =========================================================================
DO $$
DECLARE
  v_expected int := 4;
  v_before int;
  v_after int;
BEGIN
  SELECT count(*) INTO v_before
  FROM public.payments_v2
  WHERE provider = 'rr'
    AND status = 'succeeded'
    AND provider_payment_id IS NOT NULL
    AND provider_payment_id = order_id::text;

  IF v_before <> v_expected THEN
    RAISE EXCEPTION 'RR backfill guard: expected % rows, found %', v_expected, v_before;
  END IF;

  UPDATE public.payments_v2 p
     SET provider_payment_id = NULL,
         meta = coalesce(meta,'{}'::jsonb)
              || jsonb_build_object(
                   'rr', coalesce(meta->'rr','{}'::jsonb)
                       || jsonb_build_object(
                            'external_reference', p.order_id::text,
                            'reference_semantics', 'merchant_order_id_echo',
                            'legacy_local_provider_payment_id', p.provider_payment_id,
                            'backfill', jsonb_build_object(
                              'source','sprint_c2_stage_d3',
                              'at', to_jsonb(now())
                            )
                          )
                 ),
         updated_at = now()
   WHERE p.provider = 'rr'
     AND p.status = 'succeeded'
     AND p.provider_payment_id IS NOT NULL
     AND p.provider_payment_id = p.order_id::text;

  GET DIAGNOSTICS v_after = ROW_COUNT;

  IF v_after <> v_expected THEN
    RAISE EXCEPTION 'RR backfill: expected % row updates, got %', v_expected, v_after;
  END IF;

  RAISE NOTICE 'RR backfill D.3: updated % rows', v_after;
END $$;
