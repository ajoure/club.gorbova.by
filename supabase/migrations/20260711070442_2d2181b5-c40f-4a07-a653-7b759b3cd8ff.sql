-- ================================================================
-- Gate A.1 v3.1a — минимальная безопасная миграция.
-- Сигнатуры функций НЕ меняются. Поведение существующих happy-path
-- вызовов остаётся идентичным: edge продолжает получать те же state.
-- ================================================================

-- A1. SQL-валидатор безопасного payment_url.
CREATE OR REPLACE FUNCTION public.rr_is_safe_payment_url(_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE v_trim text; v_after text; v_auth text;
BEGIN
  IF _url IS NULL THEN RETURN false; END IF;
  v_trim := btrim(_url);
  IF v_trim = '' OR length(v_trim) > 2048 THEN RETURN false; END IF;
  IF v_trim ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  IF left(v_trim, 8) <> 'https://' THEN RETURN false; END IF;
  v_after := substr(v_trim, 9);
  v_auth  := split_part(v_after, '/', 1);
  IF v_auth = '' THEN RETURN false; END IF;
  IF position('@' in v_auth) > 0 THEN RETURN false; END IF;
  IF v_trim ~ '\s' THEN RETURN false; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.rr_is_safe_payment_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_is_safe_payment_url(text) TO service_role;

-- A2. Hardening internal finalizer: _source allowlist + REVOKE от API-ролей.
CREATE OR REPLACE FUNCTION public.rr_finalize_created_order_internal(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text, _source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_meta jsonb; v_upstream text;
BEGIN
  IF _source IS NULL OR _source NOT IN ('canonical','reconciler') THEN
    RAISE EXCEPTION 'rr_finalize_internal_invalid_source' USING ERRCODE='P0001';
  END IF;
  IF NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE='P0001';
  END IF;
  SELECT meta INTO v_meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_finalize_internal_order_not_found' USING ERRCODE='P0002';
  END IF;
  v_upstream := v_meta#>>'{rr,upstream_outcome}';

  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb), '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','created',
      'payment_url',       _payment_url,
      'rr_request_id',     _rr_request_id,
      'rr_status_raw',     _rr_status_raw,
      'raw_last',          COALESCE(_raw_last,'{}'::jsonb),
      'finalized_at',      to_jsonb(now()),
      'finalized_source',  _source,
      'local_persist_failed', false,
      'upstream_outcome',  'created',
      'reconciliation_status','confirmed_created',
      'upstream_call_state','completed'
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;

  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true,
    _order_id::text||':create_order_succeeded','create_order_succeeded',
    _order_id::text||':create_order_succeeded',
    jsonb_build_object(
      'payment_url_present', true,
      'rr_request_id', _rr_request_id,
      'rr_status_raw', _rr_status_raw,
      'source', _source
    ),
    'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true, 'state','finalized_internal',
    'source', _source,
    'was_ambiguous', (v_upstream IS NOT NULL AND v_upstream <> 'created')
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.rr_finalize_created_order_internal(uuid,text,text,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_finalize_created_order_internal(uuid,text,text,text,jsonb,text,text) FROM anon, authenticated;
-- service_role доступ оставлен только через SECURITY DEFINER wrapper (owner=postgres).
REVOKE ALL ON FUNCTION public.rr_finalize_created_order_internal(uuid,text,text,text,jsonb,text,text) FROM service_role;

-- A1 cont. Canonical wrapper с URL-валидацией.
CREATE OR REPLACE FUNCTION public.rr_finalize_created_order(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_meta jsonb; v_provider text; v_flow text;
  v_status text; v_existing_url text; v_upstream text;
  v_persist_failed boolean;
BEGIN
  IF _order_id IS NULL OR NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE='P0001';
  END IF;
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_finalize_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_finalize_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_existing_url := v_meta#>>'{rr,payment_url}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';
  v_persist_failed := COALESCE((v_meta#>>'{rr,local_persist_failed}')::boolean, false);

  IF v_status = 'created' AND v_existing_url = _payment_url THEN
    RETURN jsonb_build_object(
      'ok', true, 'state','already_created', 'idempotent', true,
      'payment_url', v_existing_url,
      'same_payment_url', true,
      'upstream_call_state', COALESCE(v_meta#>>'{rr,upstream_call_state}','completed')
    );
  END IF;
  IF v_status = 'created' AND v_existing_url IS DISTINCT FROM _payment_url THEN
    RAISE EXCEPTION 'rr_finalize_url_conflict' USING ERRCODE='22023';
  END IF;
  IF v_status = 'failed' THEN
    RAISE EXCEPTION 'rr_finalize_from_terminal_forbidden' USING ERRCODE='22023';
  END IF;
  IF v_status = 'pending'
     AND v_upstream IS NOT NULL
     AND v_upstream <> 'created'
     AND v_persist_failed = false
  THEN
    RAISE EXCEPTION 'rr_finalize_ambiguous_source_forbidden' USING ERRCODE='22023';
  END IF;

  PERFORM public.rr_finalize_created_order_internal(
    _order_id, _payment_url, _rr_request_id, _rr_status_raw, _raw_last, _correlation_id, 'canonical'
  );
  RETURN jsonb_build_object('ok', true, 'state','finalized','idempotent', false);
END;
$function$;

-- A1 cont. Reconciler wrapper с URL-валидацией.
CREATE OR REPLACE FUNCTION public.rr_reconcile_confirm_created(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_status text; v_upstream text;
BEGIN
  IF NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE='P0001';
  END IF;
  SELECT meta#>>'{rr,initiation_status}', meta#>>'{rr,upstream_outcome}'
    INTO v_status, v_upstream
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF v_status = 'created' THEN
    RETURN jsonb_build_object('ok', true, 'state','already_created','idempotent', true);
  END IF;
  IF v_status = 'failed' THEN
    RAISE EXCEPTION 'rr_reconcile_terminal_failed_forbidden' USING ERRCODE='22023';
  END IF;
  IF COALESCE(v_upstream,'') <> 'unknown' THEN
    RAISE EXCEPTION 'rr_reconcile_source_required_unknown' USING ERRCODE='22023';
  END IF;
  PERFORM public.rr_finalize_created_order_internal(
    _order_id, _payment_url, _rr_request_id, _rr_status_raw, _raw_last, _correlation_id, 'reconciler'
  );
  RETURN jsonb_build_object('ok', true, 'state','finalized','idempotent', false);
END;
$function$;

-- A5. Compatibility payload у rr_mark_local_persist_failed (same_payment_url + upstream_call_state).
CREATE OR REPLACE FUNCTION public.rr_mark_local_persist_failed(
  _order_id uuid, _payment_url text, _rr_request_id text, _error_text text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_meta jsonb; v_existing_url text; v_persist_failed boolean;
BEGIN
  IF _payment_url IS NOT NULL AND NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE='P0001';
  END IF;
  SELECT meta INTO v_meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE='P0002'; END IF;
  IF (v_meta#>>'{rr,initiation_status}') IN ('created','failed') THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal_order_unchanged');
  END IF;
  v_existing_url := v_meta#>>'{rr,rr_payment_url_recovered}';
  v_persist_failed := COALESCE((v_meta#>>'{rr,local_persist_failed}')::boolean, false);
  IF v_persist_failed THEN
    v_meta := jsonb_set(v_meta, '{rr,upstream_call_state}', to_jsonb('completed_unpersisted'::text), true);
    UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
    RETURN jsonb_build_object(
      'ok', true, 'state','already_persist_failed',
      'same_payment_url', (v_existing_url IS NOT DISTINCT FROM _payment_url),
      'upstream_call_state','completed_unpersisted'
    );
  END IF;
  v_meta := jsonb_set(COALESCE(v_meta,'{}'::jsonb), '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'local_persist_failed', true,
      'rr_payment_url_recovered', _payment_url,
      'rr_request_id_recovered', _rr_request_id,
      'persist_error', COALESCE(_error_text,''),
      'upstream_call_state','completed_unpersisted'
    ), true);
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object(
    'ok', true, 'state','persist_failed_marked',
    'upstream_call_state','completed_unpersisted'
  );
END;
$function$;

-- A5. Compatibility payload у rr_finalize_order_rejected (same_reason).
CREATE OR REPLACE FUNCTION public.rr_finalize_order_rejected(
  _order_id uuid, _reason_code text, _http_status integer, _response_snippet jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_meta jsonb; v_status text; v_existing text;
BEGIN
  SELECT meta INTO v_meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE='P0002'; END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_existing := v_meta#>>'{rr,provider_error_code}';
  IF v_status = 'failed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'state','already_rejected',
      'provider_error_code', v_existing,
      'same_reason', (v_existing IS NOT DISTINCT FROM _reason_code)
    );
  END IF;
  IF v_status = 'created' THEN
    RAISE EXCEPTION 'rr_reject_after_created_forbidden' USING ERRCODE='P0001';
  END IF;
  v_meta := jsonb_set(COALESCE(v_meta,'{}'::jsonb), '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','failed',
      'upstream_outcome','rejected',
      'upstream_call_state','completed',
      'provider_error_code', COALESCE(_reason_code,'unknown'),
      'provider_http_status', _http_status,
      'provider_response_snippet', COALESCE(_response_snippet,'{}'::jsonb),
      'failed_at', to_jsonb(now())
    ), true);
  UPDATE public.orders_v2 SET meta = v_meta, status='failed'::order_status, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object(
    'ok', true, 'state','rejected',
    'provider_error_code', COALESCE(_reason_code,'unknown')
  );
END;
$function$;

-- A5. Compatibility payload у rr_mark_upstream_unknown (upstream_call_state).
CREATE OR REPLACE FUNCTION public.rr_mark_upstream_unknown(
  _order_id uuid, _provider_request_id text, _failure_kind text,
  _http_status integer, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_meta jsonb; v_status text; v_upstream text;
BEGIN
  SELECT meta INTO v_meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE='P0002'; END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';
  IF v_status IN ('created','failed') THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal_order_unchanged');
  END IF;
  IF v_upstream = 'unknown' THEN
    v_meta := jsonb_set(v_meta, '{rr,upstream_call_state}', to_jsonb('outcome_unknown'::text), true);
    UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
    RETURN jsonb_build_object(
      'ok', true, 'state','already_unknown',
      'upstream_call_state','outcome_unknown'
    );
  END IF;
  v_meta := jsonb_set(COALESCE(v_meta,'{}'::jsonb), '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'upstream_outcome','unknown',
      'upstream_call_state','outcome_unknown',
      'reconciliation_status','pending',
      'rr_request_id', _provider_request_id,
      'failure_kind', _failure_kind,
      'http_status', _http_status,
      'correlation_id', _correlation_id,
      'unknown_marked_at', to_jsonb(now())
    ), true);
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object(
    'ok', true, 'state','unknown_marked',
    'upstream_call_state','outcome_unknown'
  );
END;
$function$;

-- A2 finalize. Гранты wrappers (executable service_role, blocked others).
REVOKE ALL ON FUNCTION public.rr_finalize_created_order(uuid,text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_finalize_created_order(uuid,text,text,text,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.rr_reconcile_confirm_created(uuid,text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_reconcile_confirm_created(uuid,text,text,text,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.rr_mark_local_persist_failed(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_mark_local_persist_failed(uuid,text,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.rr_finalize_order_rejected(uuid,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_finalize_order_rejected(uuid,text,integer,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rr_mark_upstream_unknown(uuid,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_mark_upstream_unknown(uuid,text,text,integer,text) TO service_role;