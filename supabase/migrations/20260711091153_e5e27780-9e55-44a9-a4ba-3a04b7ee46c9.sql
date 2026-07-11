
-- 1) Guarantee at most one successful RR payment per order.
--    Zero existing RR payments verified before creating index.
CREATE UNIQUE INDEX IF NOT EXISTS payments_v2_rr_one_succeeded_per_order
  ON public.payments_v2 (order_id)
  WHERE provider = 'rr' AND status = 'succeeded';

-- 2) Atomic promotion RPC.
--    Locks the order FOR UPDATE, validates provider/flow, classifies the RR
--    notification status and decides an action.
--    C1 scope: only "authorized" / "authorized_all" cause promotion.
--    Any other status returns state='ignored' — never mutates order status.
--    Returns:
--      { state: 'promoted' | 'already_promoted' | 'ignored' | 'wrong_provider' | 'wrong_flow' | 'not_found',
--        should_grant_access: bool,
--        order_status: text,
--        payment_id: uuid | null,
--        fulfillment: jsonb }
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
  v_new_meta jsonb;
  v_rr_meta jsonb;
  v_fulfillment jsonb;
BEGIN
  -- Classify RR raw status → action.
  v_action := CASE lower(coalesce(_rr_status_raw, ''))
    WHEN 'authorized' THEN 'authorize'
    WHEN 'authorized_all' THEN 'authorize'
    ELSE 'ignore'
  END;

  IF v_action <> 'authorize' THEN
    RETURN jsonb_build_object('state', 'ignored', 'reason', 'non_authorize_status', 'rr_status_raw', _rr_status_raw);
  END IF;

  -- Lock order row.
  SELECT id, provider, status::text AS status_text, final_price, currency,
         paid_amount, provider_payment_id, meta, product_id, tariff_id, offer_id, user_id
    INTO v_order
  FROM public.orders_v2
  WHERE id = _order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'not_found');
  END IF;

  IF v_order.provider IS DISTINCT FROM 'rr' THEN
    RETURN jsonb_build_object('state', 'wrong_provider', 'provider', v_order.provider);
  END IF;

  IF (v_order.meta->>'flow') IS DISTINCT FROM 'rr_installment' THEN
    RETURN jsonb_build_object('state', 'wrong_flow', 'flow', v_order.meta->>'flow');
  END IF;

  -- Already promoted: return existing fulfillment state so caller can retry
  -- grant-access-for-order if fulfillment != completed.
  IF v_order.status_text = 'paid' THEN
    SELECT id INTO v_payment_id
      FROM public.payments_v2
     WHERE order_id = _order_id AND provider = 'rr' AND status = 'succeeded'
     LIMIT 1;

    v_fulfillment := coalesce(v_order.meta->'rr'->'fulfillment', jsonb_build_object('status','pending','attempts',0));

    RETURN jsonb_build_object(
      'state', 'already_promoted',
      'should_grant_access', (v_fulfillment->>'status') IS DISTINCT FROM 'completed',
      'order_status', 'paid',
      'payment_id', v_payment_id,
      'fulfillment', v_fulfillment
    );
  END IF;

  -- Promote to paid.
  UPDATE public.orders_v2
     SET status = 'paid'::order_status,
         paid_amount = COALESCE(paid_amount, 0) + (v_order.final_price - COALESCE(v_order.paid_amount, 0)),
         provider_payment_id = COALESCE(provider_payment_id, _order_id::text),
         reconcile_source = _source,
         updated_at = v_now,
         meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
           'rr',
           COALESCE(meta->'rr', '{}'::jsonb) || jsonb_build_object(
             'promotion', jsonb_build_object(
               'at', to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'source', _source,
               'sign_hash_short', _sign_hash_short,
               'rr_status_raw', _rr_status_raw
             ),
             'fulfillment', jsonb_build_object(
               'status', 'pending',
               'attempts', 0,
               'last_error', NULL,
               'completed_at', NULL
             )
           )
         )
   WHERE id = _order_id AND status <> 'paid'::order_status;

  IF NOT FOUND THEN
    -- Race: another writer promoted between our lock and update — treat as already_promoted.
    RETURN jsonb_build_object('state', 'already_promoted', 'race', true, 'should_grant_access', true);
  END IF;

  -- Insert single RR payment row (partial unique index enforces one per order).
  INSERT INTO public.payments_v2 (
    order_id, user_id, amount, currency, status, provider, provider_payment_id,
    paid_at, meta, transaction_type, origin
  ) VALUES (
    _order_id,
    v_order.user_id,
    v_order.final_price,
    v_order.currency,
    'succeeded'::payment_status,
    'rr',
    COALESCE(v_order.provider_payment_id, _order_id::text),
    v_now,
    jsonb_build_object(
      'source', _source,
      'sign_hash_short', _sign_hash_short,
      'rr_status_raw', _rr_status_raw,
      'flow', 'rr_installment'
    ),
    'sale',
    'rr_installment'
  )
  ON CONFLICT ON CONSTRAINT payments_v2_rr_one_succeeded_per_order DO NOTHING
  RETURNING id INTO v_payment_id;

  IF v_payment_id IS NULL THEN
    SELECT id INTO v_payment_id
      FROM public.payments_v2
     WHERE order_id = _order_id AND provider = 'rr' AND status = 'succeeded'
     LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'state', 'promoted',
    'should_grant_access', true,
    'order_status', 'paid',
    'payment_id', v_payment_id,
    'fulfillment', jsonb_build_object('status','pending','attempts',0)
  );
END;
$$;

-- 3) Mark fulfillment outcome (retryable state, orthogonal to payment row).
CREATE OR REPLACE FUNCTION public.rr_mark_fulfillment(
  _order_id uuid,
  _outcome text,           -- 'completed' | 'failed' | 'processing'
  _error text DEFAULT NULL,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_rr jsonb;
  v_fulfillment jsonb;
  v_attempts integer;
  v_now timestamptz := now();
BEGIN
  SELECT meta INTO v_meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_rr := COALESCE(v_meta->'rr', '{}'::jsonb);
  v_fulfillment := COALESCE(v_rr->'fulfillment', jsonb_build_object('status','pending','attempts',0));
  v_attempts := COALESCE((v_fulfillment->>'attempts')::int, 0) + 1;

  v_fulfillment := jsonb_build_object(
    'status', _outcome,
    'attempts', v_attempts,
    'last_error', _error,
    'last_at', to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completed_at', CASE WHEN _outcome = 'completed'
      THEN to_char(v_now AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ELSE v_fulfillment->>'completed_at' END,
    'details', _details
  );

  UPDATE public.orders_v2
     SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                  'rr', v_rr || jsonb_build_object('fulfillment', v_fulfillment)
                ),
         updated_at = v_now
   WHERE id = _order_id;

  RETURN jsonb_build_object('ok', true, 'fulfillment', v_fulfillment);
END;
$$;

-- Restrict RPCs to service_role only (webhook and admin edge functions use service key).
REVOKE ALL ON FUNCTION public.rr_promote_authorized_order(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_promote_authorized_order(uuid, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.rr_mark_fulfillment(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_fulfillment(uuid, text, text, jsonb) TO service_role;
