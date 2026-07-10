
-- =====================================================================
-- Gate A.1 v3 — жёсткие state-machine guards + pre-call durable marker.
-- Все RPC — service_role only. Retry с DROP перед сменой return type.
-- =====================================================================

-- Config flags helper
CREATE OR REPLACE FUNCTION public.rr_get_config_flag(_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT (value->>'enabled')::boolean
       FROM public.app_settings WHERE key = _key LIMIT 1),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.rr_get_config_flag(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_get_config_flag(text) TO service_role;

INSERT INTO public.app_settings(key, value)
VALUES
  ('rr.not_created_resolution_enabled', jsonb_build_object('enabled', false, 'contract_version', null)),
  ('rr.allow_new_order_enabled',        jsonb_build_object('enabled', false, 'contract_version', null))
ON CONFLICT (key) DO NOTHING;

-- rr_insert_idempotent_audit_event
CREATE OR REPLACE FUNCTION public.rr_insert_idempotent_audit_event(
  _order_id uuid, _event_type text, _payload jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text; v_provider text; v_flow text;
BEGIN
  IF _order_id IS NULL OR _event_type IS NULL THEN
    RAISE EXCEPTION 'rr_audit_invalid_input' USING ERRCODE='22023';
  END IF;
  IF _event_type NOT IN ('recovery_blocked_no_url','create_order_recovered','local_state_unconfirmed','audit_write_failed') THEN
    RAISE EXCEPTION 'rr_audit_event_type_not_allowed' USING ERRCODE='22023';
  END IF;
  SELECT provider, meta->>'flow' INTO v_provider, v_flow
    FROM public.orders_v2 WHERE id = _order_id;
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_audit_wrong_order' USING ERRCODE='22023';
  END IF;
  v_key := _order_id::text || ':' || _event_type;
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr', true, v_key, _event_type, v_key,
    COALESCE(_payload,'{}'::jsonb), 'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.rr_insert_idempotent_audit_event(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_insert_idempotent_audit_event(uuid, text, jsonb) TO service_role;

-- rr_mark_call_started
CREATE OR REPLACE FUNCTION public.rr_mark_call_started(
  _order_id uuid, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text; v_status text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_call_started_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_call_started_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  IF v_status = 'created' OR v_status = 'failed' THEN
    RETURN jsonb_build_object('ok', true, 'state', 'terminal', 'initiation_status', v_status,
                              'upstream_call_state', v_meta#>>'{rr,upstream_call_state}');
  END IF;
  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb), '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'upstream_call_state','started',
      'upstream_call_started_at', to_jsonb(now()),
      'upstream_call_correlation_id', _correlation_id
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true, 'state','call_started',
                            'initiation_status', v_status, 'upstream_call_state','started');
END;
$$;
REVOKE ALL ON FUNCTION public.rr_mark_call_started(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_call_started(uuid, text) TO service_role;

-- rr_get_or_create_pending_order — расширяем reuse (сигнатура сохранена)
CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_row public.orders_v2%ROWTYPE; v_lock_key bigint; v_order_number text;
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'')||'|'||coalesce(_user_id::text,'')||'|'||
    coalesce(_email_norm,'')||'|'||coalesce(_phone_norm,''), 42);
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_row FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (_email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm)
     AND (_phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm)
     AND (
       -- durable-block: pre-call marker (высший приоритет)
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

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, provider,
    customer_email, customer_phone, customer_ip, user_id, meta)
  VALUES (v_order_number, _product_id, _tariff_id, _offer_id, _amount, _amount, _currency,
    'pending'::order_status, 'rr', _customer_email, _customer_phone, _customer_ip, _user_id, _meta)
  RETURNING * INTO v_row;
  order_id := v_row.id; was_reused := false; order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;

-- DROP + CREATE для функций, у которых меняется return type
DROP FUNCTION IF EXISTS public.rr_finalize_created_order(uuid, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.rr_mark_local_persist_failed(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.rr_mark_upstream_unknown(uuid, text, text, int, text);
DROP FUNCTION IF EXISTS public.rr_finalize_order_rejected(uuid, text, int, jsonb);
DROP FUNCTION IF EXISTS public.rr_finalize_order_not_created(uuid, jsonb);
DROP FUNCTION IF EXISTS public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text);
DROP FUNCTION IF EXISTS public.rr_operator_resolve(uuid, text, text, text, text, text);

-- rr_finalize_created_order (canonical, полный postcondition)
CREATE FUNCTION public.rr_finalize_created_order(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text; v_status text;
  v_existing_url text; v_upstream text;
BEGIN
  IF _order_id IS NULL OR _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
    RAISE EXCEPTION 'rr_finalize_invalid_input' USING ERRCODE='22023';
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

  IF v_status = 'created' AND v_existing_url = _payment_url THEN
    RETURN jsonb_build_object('ok', true, 'state','already_created','idempotent', true);
  END IF;
  IF v_status = 'created' AND v_existing_url IS DISTINCT FROM _payment_url THEN
    RAISE EXCEPTION 'rr_finalize_url_conflict' USING ERRCODE='22023';
  END IF;
  IF v_status = 'failed' THEN
    RAISE EXCEPTION 'rr_finalize_from_terminal_forbidden' USING ERRCODE='22023';
  END IF;

  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb), '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','created',
      'payment_url',       _payment_url,
      'rr_request_id',     _rr_request_id,
      'rr_status_raw',     _rr_status_raw,
      'raw_last',          COALESCE(_raw_last,'{}'::jsonb),
      'finalized_at',      to_jsonb(now()),
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
    jsonb_build_object('payment_url_present', true,'rr_request_id',_rr_request_id,
      'rr_status_raw',_rr_status_raw,'raw_last',COALESCE(_raw_last,'{}'::jsonb),
      'correlation_id',_correlation_id,'from_upstream',v_upstream),
    'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state','finalized','idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) TO service_role;

-- rr_mark_local_persist_failed
CREATE FUNCTION public.rr_mark_local_persist_failed(
  _order_id uuid, _payment_url text, _rr_request_id text, _error_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_meta jsonb; v_provider text; v_flow text; v_status text;
BEGIN
  IF _order_id IS NULL OR _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
    RAISE EXCEPTION 'rr_persist_failed_invalid_input' USING ERRCODE='22023';
  END IF;
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_persist_failed_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_persist_failed_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  IF v_status = 'created' OR v_status = 'failed' THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal_no_op','initiation_status', v_status);
  END IF;
  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb),'{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','pending',
      'local_persist_failed', true,
      'rr_payment_url_recovered', _payment_url,
      'rr_request_id_recovered',  _rr_request_id,
      'local_persist_error', LEFT(COALESCE(_error_text,''), 500),
      'local_persist_failed_at', to_jsonb(now())
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true, 'state','persist_failed_marked',
    'local_persist_failed', true, 'has_recovered_url', true);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) TO service_role;

-- rr_mark_upstream_unknown
CREATE FUNCTION public.rr_mark_upstream_unknown(
  _order_id uuid, _provider_request_id text, _failure_kind text,
  _http_status int, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_meta jsonb; v_provider text; v_flow text; v_current_status text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_unknown_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_unknown_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_current_status := v_meta#>>'{rr,initiation_status}';
  IF v_current_status = 'created' OR v_current_status = 'failed' THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal_no_op','initiation_status', v_current_status);
  END IF;
  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb),'{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','pending',
      'upstream_outcome','unknown',
      'reconciliation_status','pending',
      'reconciliation_attempts', 0,
      'failure_kind', _failure_kind,
      'http_status_last', _http_status,
      'provider_request_id', _provider_request_id,
      'marked_unknown_at', to_jsonb(now())
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true,
    _order_id::text||':create_order_outcome_unknown','create_order_outcome_unknown',
    _order_id::text||':create_order_outcome_unknown',
    jsonb_build_object('failure_kind',_failure_kind,'http_status',_http_status,
      'provider_request_id',_provider_request_id,'correlation_id',_correlation_id),
    'pending', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state','unknown_marked',
    'upstream_outcome','unknown','reconciliation_status','pending');
END;
$$;
REVOKE ALL ON FUNCTION public.rr_mark_upstream_unknown(uuid, text, text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_upstream_unknown(uuid, text, text, int, text) TO service_role;

-- rr_finalize_order_rejected (жёсткие guards)
CREATE FUNCTION public.rr_finalize_order_rejected(
  _order_id uuid, _reason_code text, _http_status int, _response_snippet jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text; v_status text; v_upstream text;
  v_persist_failed boolean; v_prev_reason text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_reject_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_reject_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';
  v_persist_failed := COALESCE((v_meta#>>'{rr,local_persist_failed}')::boolean, false);
  v_prev_reason := v_meta#>>'{rr,reject_reason}';

  IF v_status = 'failed' AND v_upstream = 'rejected' AND v_prev_reason IS NOT DISTINCT FROM _reason_code THEN
    RETURN jsonb_build_object('ok', true, 'state','already_rejected','idempotent', true);
  END IF;
  IF v_status = 'created' THEN RAISE EXCEPTION 'rr_reject_conflict_already_created' USING ERRCODE='22023'; END IF;
  IF v_status = 'failed' THEN RAISE EXCEPTION 'rr_reject_conflict_terminal_state' USING ERRCODE='22023'; END IF;
  IF v_upstream = 'unknown' THEN RAISE EXCEPTION 'rr_reject_invalid_source_ambiguous' USING ERRCODE='22023'; END IF;
  IF v_persist_failed THEN RAISE EXCEPTION 'rr_reject_invalid_source_recovery' USING ERRCODE='22023'; END IF;

  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb),'{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','failed','upstream_outcome','rejected',
      'reject_reason', _reason_code,'http_status', _http_status,
      'raw_last', COALESCE(_response_snippet,'{}'::jsonb),
      'rejected_at', to_jsonb(now()),'upstream_call_state','completed'
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, status = 'failed'::order_status, updated_at = now()
   WHERE id = _order_id;
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true, _order_id::text||':create_order_rejected','create_order_rejected',
    _order_id::text||':create_order_rejected',
    jsonb_build_object('reason_code',_reason_code,'http_status',_http_status,
                       'raw_last',COALESCE(_response_snippet,'{}'::jsonb)),
    'rejected', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state','rejected','idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_finalize_order_rejected(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_finalize_order_rejected(uuid, text, int, jsonb) TO service_role;

-- rr_finalize_order_not_created (contract-gated + evidence contract)
CREATE FUNCTION public.rr_finalize_order_not_created(
  _order_id uuid, _evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text;
  v_status text; v_upstream text; v_recon text; v_attempts int;
BEGIN
  IF NOT public.rr_get_config_flag('rr.not_created_resolution_enabled') THEN
    RAISE EXCEPTION 'rr_not_created_contract_not_enabled' USING ERRCODE='0A000';
  END IF;
  IF _evidence IS NULL OR jsonb_typeof(_evidence) <> 'object' THEN
    RAISE EXCEPTION 'rr_not_created_evidence_invalid' USING ERRCODE='22023';
  END IF;
  IF (_evidence->>'provider_error_code') IS NULL
     OR (_evidence->>'http_status') IS NULL
     OR (_evidence->>'attempts') IS NULL
     OR (_evidence->>'first_checked_at') IS NULL
     OR (_evidence->>'last_checked_at') IS NULL
     OR (_evidence->>'endpoint_mode') IS NULL THEN
    RAISE EXCEPTION 'rr_not_created_evidence_invalid' USING ERRCODE='22023';
  END IF;
  BEGIN v_attempts := (_evidence->>'attempts')::int;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'rr_not_created_evidence_invalid' USING ERRCODE='22023';
  END;
  IF v_attempts < 3 THEN RAISE EXCEPTION 'rr_not_created_evidence_attempts_below_min' USING ERRCODE='22023'; END IF;
  IF (_evidence->>'endpoint_mode') NOT IN ('test','prod') THEN
    RAISE EXCEPTION 'rr_not_created_evidence_invalid' USING ERRCODE='22023';
  END IF;

  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_not_created_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_not_created_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';
  v_recon := COALESCE(v_meta#>>'{rr,reconciliation_status}','pending');

  IF v_status = 'failed' AND v_upstream = 'not_created' THEN
    RETURN jsonb_build_object('ok', true, 'state','already_not_created','idempotent', true);
  END IF;
  IF v_status = 'created' THEN
    RAISE EXCEPTION 'rr_not_created_conflict_already_created' USING ERRCODE='22023';
  END IF;
  IF NOT (v_status = 'pending' AND v_upstream = 'unknown' AND v_recon IN ('pending','operator_required')) THEN
    RAISE EXCEPTION 'rr_not_created_invalid_source_state' USING ERRCODE='22023';
  END IF;

  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb),'{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','failed','upstream_outcome','not_created',
      'reconciliation_status','not_found','reconciled_at', to_jsonb(now()),
      'reconciliation_evidence', _evidence,'upstream_call_state','completed'
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, status='failed'::order_status, updated_at = now()
   WHERE id = _order_id;
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true, _order_id::text||':create_order_confirmed_not_created',
    'create_order_confirmed_not_created',
    _order_id::text||':create_order_confirmed_not_created',
    jsonb_build_object('evidence', _evidence),'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state','not_created','idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_finalize_order_not_created(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_finalize_order_not_created(uuid, jsonb) TO service_role;

-- rr_reconcile_confirm_created (жёсткие source-state guards)
CREATE FUNCTION public.rr_reconcile_confirm_created(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text;
  v_status text; v_upstream text; v_recon text; v_existing_url text;
BEGIN
  IF _order_id IS NULL OR _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
    RAISE EXCEPTION 'rr_recon_invalid_input' USING ERRCODE='22023';
  END IF;
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_recon_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_recon_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';
  v_recon := COALESCE(v_meta#>>'{rr,reconciliation_status}','pending');
  v_existing_url := v_meta#>>'{rr,payment_url}';

  IF v_status = 'created' AND v_existing_url = _payment_url THEN
    RETURN jsonb_build_object('ok', true, 'state','already_created','idempotent', true);
  END IF;
  IF v_status = 'created' AND v_existing_url IS DISTINCT FROM _payment_url THEN
    RAISE EXCEPTION 'rr_reconcile_url_conflict' USING ERRCODE='22023';
  END IF;
  IF NOT (v_status = 'pending' AND v_upstream = 'unknown' AND v_recon IN ('pending','operator_required')) THEN
    RAISE EXCEPTION 'rr_reconcile_invalid_source_state' USING ERRCODE='22023';
  END IF;

  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb),'{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','created',
      'payment_url', _payment_url,
      'rr_request_id', _rr_request_id,
      'rr_status_raw', _rr_status_raw,
      'raw_last', COALESCE(_raw_last,'{}'::jsonb),
      'finalized_at', to_jsonb(now()),
      'local_persist_failed', false,
      'upstream_outcome','created',
      'reconciliation_status','confirmed_created',
      'reconciled_at', to_jsonb(now()),
      'upstream_call_state','completed'
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true, _order_id::text||':create_order_succeeded','create_order_succeeded',
    _order_id::text||':create_order_succeeded',
    jsonb_build_object('source','reconciler','correlation_id',_correlation_id,'rr_request_id',_rr_request_id),
    'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true, _order_id::text||':reconciliation_confirmed_created','reconciliation_confirmed_created',
    _order_id::text||':reconciliation_confirmed_created',
    jsonb_build_object('correlation_id',_correlation_id,'rr_request_id',_rr_request_id),
    'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state','reconciled_created','idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text) TO service_role;

-- rr_operator_resolve (новая сигнатура с _evidence)
CREATE FUNCTION public.rr_operator_resolve(
  _order_id uuid, _resolution text, _actor text,
  _payment_url text, _rr_request_id text, _note text, _evidence jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text;
  v_status text; v_upstream text; v_recon text; v_prev_resolution text;
BEGIN
  IF _resolution NOT IN ('confirm_created','keep_blocked','allow_new_order') THEN
    RAISE EXCEPTION 'rr_operator_invalid_resolution' USING ERRCODE='22023';
  END IF;
  IF _actor IS NULL OR length(trim(_actor)) = 0 THEN
    RAISE EXCEPTION 'rr_operator_actor_required' USING ERRCODE='22023';
  END IF;
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_operator_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_operator_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';
  v_recon := COALESCE(v_meta#>>'{rr,reconciliation_status}','pending');
  v_prev_resolution := v_meta#>>'{rr,operator_resolution}';

  IF v_prev_resolution IS NOT NULL AND v_prev_resolution IS DISTINCT FROM _resolution THEN
    RAISE EXCEPTION 'rr_operator_resolution_override_forbidden' USING ERRCODE='22023';
  END IF;
  IF v_prev_resolution IS NOT DISTINCT FROM _resolution AND v_prev_resolution IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'state','already_resolved','idempotent', true,'resolution', _resolution);
  END IF;

  IF _resolution = 'confirm_created' THEN
    IF _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
      RAISE EXCEPTION 'rr_operator_confirm_requires_url' USING ERRCODE='22023';
    END IF;
    IF NOT (v_status='pending' AND v_upstream='unknown' AND v_recon IN ('pending','operator_required')) THEN
      RAISE EXCEPTION 'rr_operator_confirm_invalid_source_state' USING ERRCODE='22023';
    END IF;
    PERFORM public.rr_reconcile_confirm_created(
      _order_id, _payment_url, _rr_request_id, NULL,
      jsonb_build_object('source','operator','actor',_actor,'note',COALESCE(_note,'')),
      'operator:'||_actor
    );
    v_meta := (SELECT meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE);
    v_meta := jsonb_set(v_meta,'{rr,operator_resolution}', to_jsonb('confirm_created'::text));
    v_meta := jsonb_set(v_meta,'{rr,operator_actor}',      to_jsonb(_actor));
    v_meta := jsonb_set(v_meta,'{rr,operator_note}',       to_jsonb(COALESCE(_note,'')));
    v_meta := jsonb_set(v_meta,'{rr,operator_resolved_at}', to_jsonb(now()));
    UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  ELSIF _resolution = 'allow_new_order' THEN
    IF NOT public.rr_get_config_flag('rr.allow_new_order_enabled') THEN
      RAISE EXCEPTION 'rr_operator_allow_new_order_not_enabled' USING ERRCODE='0A000';
    END IF;
    IF _evidence IS NULL OR jsonb_typeof(_evidence) <> 'object' OR _evidence = '{}'::jsonb THEN
      RAISE EXCEPTION 'rr_operator_allow_new_order_evidence_required' USING ERRCODE='22023';
    END IF;
    IF _note IS NULL OR length(trim(_note)) = 0 THEN
      RAISE EXCEPTION 'rr_operator_allow_new_order_note_required' USING ERRCODE='22023';
    END IF;
    IF NOT (v_status='pending' AND v_upstream='unknown' AND v_recon IN ('pending','operator_required')) THEN
      RAISE EXCEPTION 'rr_operator_allow_new_order_invalid_source_state' USING ERRCODE='22023';
    END IF;
    v_meta := jsonb_set(
      COALESCE(v_meta,'{}'::jsonb),'{rr}',
      COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
        'initiation_status','failed','reconciliation_status','resolved',
        'operator_resolution','allow_new_order','operator_actor',_actor,
        'operator_note',_note,'operator_evidence',_evidence,
        'operator_resolved_at', to_jsonb(now()),'upstream_call_state','completed'
      ), true
    );
    UPDATE public.orders_v2 SET meta = v_meta, status='failed'::order_status, updated_at = now()
     WHERE id = _order_id;
  ELSE -- keep_blocked
    IF NOT (v_status='pending' AND v_upstream='unknown') THEN
      RAISE EXCEPTION 'rr_operator_keep_blocked_invalid_source_state' USING ERRCODE='22023';
    END IF;
    v_meta := jsonb_set(
      COALESCE(v_meta,'{}'::jsonb),'{rr}',
      COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
        'reconciliation_status','resolved','operator_resolution','keep_blocked',
        'operator_actor',_actor,'operator_note',COALESCE(_note,''),
        'operator_resolved_at', to_jsonb(now())
      ), true
    );
    UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  END IF;

  INSERT INTO public.provider_events(
    provider, account_code, signature_valid, event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true, _order_id::text||':operator_intervention:'||_resolution,
    'operator_intervention', _order_id::text||':operator_intervention:'||_resolution,
    jsonb_build_object('resolution',_resolution,'actor',_actor,
                       'note',COALESCE(_note,''),'evidence_present', _evidence IS NOT NULL),
    'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'state','resolved','idempotent', false,'resolution', _resolution);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_operator_resolve(uuid, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_operator_resolve(uuid, text, text, text, text, text, jsonb) TO service_role;
