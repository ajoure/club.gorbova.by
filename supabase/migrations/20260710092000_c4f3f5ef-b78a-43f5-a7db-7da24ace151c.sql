-- Sprint B follow-up: atomic finalize RPC for RR createOrder success.
-- Guarantees UPDATE orders_v2 + INSERT provider_events happen in one transaction.
-- If either fails, both roll back and caller learns via SQLSTATE.

CREATE OR REPLACE FUNCTION public.rr_finalize_created_order(
  _order_id       uuid,
  _payment_url    text,
  _rr_request_id  text,
  _rr_status_raw  text,
  _raw_last       jsonb,
  _correlation_id text
)
RETURNS TABLE (
  order_id        uuid,
  finalized       boolean,
  already_created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_provider text;
  v_flow text;
  v_current_status text;
  v_current_url text;
  v_event_id text;
  v_idempotency_key text;
BEGIN
  IF _order_id IS NULL OR _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
    RAISE EXCEPTION 'rr_finalize_invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Lock the row for the duration of the transaction.
  SELECT provider, meta
    INTO v_provider, v_meta
    FROM public.orders_v2
   WHERE id = _order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_finalize_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_finalize_wrong_provider_or_flow' USING ERRCODE = '22023';
  END IF;

  v_current_status := v_meta#>>'{rr,initiation_status}';
  v_current_url    := v_meta#>>'{rr,payment_url}';

  -- Idempotent short-circuit: already finalized with the same URL.
  IF v_current_status = 'created'
     AND v_current_url IS NOT NULL
     AND v_current_url = _payment_url
  THEN
    RETURN QUERY SELECT _order_id, false, true;
    RETURN;
  END IF;

  -- Merge rr subtree.
  v_meta := jsonb_set(
    coalesce(v_meta, '{}'::jsonb),
    '{rr}',
    coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status', 'created',
      'payment_url',       _payment_url,
      'rr_request_id',     coalesce(_rr_request_id, _order_id::text),
      'rr_status_raw',     _rr_status_raw,
      'raw_last',          _raw_last,
      'finalized_at',      to_jsonb(now())
    ),
    true
  );

  UPDATE public.orders_v2
     SET meta = v_meta,
         updated_at = now()
   WHERE id = _order_id;

  v_event_id := _order_id::text || ':create_order_succeeded';
  v_idempotency_key := v_event_id;

  -- Idempotent insert: same idempotency_key => no duplicate.
  INSERT INTO public.provider_events (
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  )
  VALUES (
    'rr', 'rr', true,
    v_event_id, 'create_order_succeeded', v_idempotency_key,
    jsonb_build_object(
      'payment_url',    _payment_url,
      'rr_request_id',  coalesce(_rr_request_id, _order_id::text),
      'rr_status_raw',  _rr_status_raw,
      'raw_last',       _raw_last,
      'correlation_id', _correlation_id
    ),
    'processed', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY SELECT _order_id, true, false;
END;
$$;

REVOKE ALL ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) TO service_role;

-- Companion helper: mark local_persist_failed marker without breaking reuse window.
-- Best-effort recovery hint for operators; keeps initiation_status='pending' so the
-- 120s reuse RPC still short-circuits, preventing a second RR createOrder.
CREATE OR REPLACE FUNCTION public.rr_mark_local_persist_failed(
  _order_id       uuid,
  _payment_url    text,
  _rr_request_id  text,
  _error_text     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
BEGIN
  SELECT meta INTO v_meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_meta := jsonb_set(
    coalesce(v_meta, '{}'::jsonb),
    '{rr}',
    coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'local_persist_failed', true,
      'local_persist_error',  _error_text,
      'local_persist_at',     to_jsonb(now()),
      'rr_payment_url_recovered', _payment_url,
      'rr_request_id_recovered', _rr_request_id
    ),
    true
  );

  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) TO service_role;