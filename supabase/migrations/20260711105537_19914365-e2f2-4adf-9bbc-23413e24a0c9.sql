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

  INSERT INTO public.payments_v2 (
    order_id, user_id, amount, currency, status, provider, provider_payment_id,
    paid_at, meta, transaction_type, origin
  ) VALUES (
    _order_id, v_order.user_id, v_order.final_price, v_order.currency,
    'succeeded'::payment_status, 'rr',
    COALESCE(v_order.provider_payment_id, _order_id::text),
    v_now,
    jsonb_build_object('source',_source,'sign_hash_short',_sign_hash_short,'rr_status_raw',_rr_status_raw,'flow','rr_installment'),
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