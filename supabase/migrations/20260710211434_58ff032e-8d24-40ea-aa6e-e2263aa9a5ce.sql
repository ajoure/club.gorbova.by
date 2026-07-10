
-- =====================================================================
-- Gate A.1 v3.1 — исправление приоритета состояний RR:
--   • upstream_call_state получает семантические post-call значения;
--   • canonical finalize защищён от ambiguous source-state;
--   • единый internal writer success-state (не доступен снаружи);
--   • pre-call marker при создании нового заказа = not_started.
-- Сигнатуры RPC не меняются. Grants: service_role only (internal — никому).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Internal helper — единственный writer canonical success-state.
--    Не имеет EXECUTE ни для одной роли; вызывается через SECURITY DEFINER
--    wrappers, которые сами являются owner'ом функции.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rr_finalize_created_order_internal(uuid, text, text, text, jsonb, text, text);

CREATE FUNCTION public.rr_finalize_created_order_internal(
  _order_id uuid,
  _payment_url text,
  _rr_request_id text,
  _rr_status_raw text,
  _raw_last jsonb,
  _correlation_id text,
  _source text  -- 'canonical' | 'reconciler'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb;
  v_upstream text;
BEGIN
  -- Атомарно читает + FOR UPDATE; вызывающий wrapper уже проверил
  -- source-state guards и владеет транзакцией.
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
      'raw_last', COALESCE(_raw_last,'{}'::jsonb),
      'correlation_id', _correlation_id,
      'from_upstream', v_upstream,
      'source', _source
    ),
    'processed', now(), _order_id
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  IF _source = 'reconciler' THEN
    INSERT INTO public.provider_events(
      provider, account_code, signature_valid, event_id, event_type, idempotency_key,
      payload, processing_status, processed_at, related_order_id
    ) VALUES (
      'rr','rr',true,
      _order_id::text||':reconciliation_confirmed_created','reconciliation_confirmed_created',
      _order_id::text||':reconciliation_confirmed_created',
      jsonb_build_object('correlation_id',_correlation_id,'rr_request_id',_rr_request_id),
      'processed', now(), _order_id
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'state','finalized','idempotent', false);
END;
$$;
-- Internal: недоступно НИКОМУ извне.
REVOKE ALL ON FUNCTION public.rr_finalize_created_order_internal(uuid, text, text, text, jsonb, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. rr_get_or_create_pending_order — при вставке нового заказа явно
--    выставляем upstream_call_state='not_started'. Сигнатура сохранена.
--    Reuse-логика оставлена как в v3 (edge теперь строго различает
--    started / outcome_unknown / completed_unpersisted).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb
) RETURNS TABLE(order_id uuid, was_reused boolean, order_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_lock_key bigint;
  v_order_number text;
  v_meta jsonb := COALESCE(_meta, '{}'::jsonb);
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

  -- Явно фиксируем pre-call состояние.
  v_meta := jsonb_set(
    v_meta, '{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object('upstream_call_state','not_started'),
    true
  );

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency, status, provider,
    customer_email, customer_phone, customer_ip, user_id, meta)
  VALUES (v_order_number, _product_id, _tariff_id, _offer_id, _amount, _amount, _currency,
    'pending'::order_status, 'rr', _customer_email, _customer_phone, _customer_ip, _user_id, v_meta)
  RETURNING * INTO v_row;
  order_id := v_row.id; was_reused := false; order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. rr_finalize_created_order (public wrapper):
--    закрывает direct ambiguous → created и запрещает переходы из failed.
--    Делегирует запись в rr_finalize_created_order_internal.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rr_finalize_created_order(uuid, text, text, text, jsonb, text);

CREATE FUNCTION public.rr_finalize_created_order(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta jsonb; v_provider text; v_flow text;
  v_status text; v_existing_url text; v_upstream text;
  v_persist_failed boolean;
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
  v_persist_failed := COALESCE((v_meta#>>'{rr,local_persist_failed}')::boolean, false);

  -- Idempotent no-op при повторном тот же URL.
  IF v_status = 'created' AND v_existing_url = _payment_url THEN
    RETURN jsonb_build_object('ok', true, 'state','already_created','idempotent', true);
  END IF;
  -- URL conflict.
  IF v_status = 'created' AND v_existing_url IS DISTINCT FROM _payment_url THEN
    RAISE EXCEPTION 'rr_finalize_url_conflict' USING ERRCODE='22023';
  END IF;
  -- Terminal failed запрещён.
  IF v_status = 'failed' THEN
    RAISE EXCEPTION 'rr_finalize_from_terminal_forbidden' USING ERRCODE='22023';
  END IF;
  -- Блокер №3: ambiguous → created только через reconciler.
  IF v_status = 'pending'
     AND v_upstream IS NOT NULL
     AND v_upstream <> 'created'
     AND v_persist_failed = false
  THEN
    RAISE EXCEPTION 'rr_finalize_ambiguous_source_forbidden' USING ERRCODE='22023';
  END IF;

  -- Разрешено: (pending + upstream_outcome IS NULL) OR (pending + local_persist_failed=true).
  PERFORM public.rr_finalize_created_order_internal(
    _order_id, _payment_url, _rr_request_id, _rr_status_raw, _raw_last, _correlation_id, 'canonical'
  );
  RETURN jsonb_build_object('ok', true, 'state','finalized','idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------
-- 3. rr_reconcile_confirm_created — единственный вход ambiguous → created.
--    Атомарно проверяет ambiguous source-state и делегирует internal.
--    upstream_outcome='created' выставляется только внутри internal — не до.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text);

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

  PERFORM public.rr_finalize_created_order_internal(
    _order_id, _payment_url, _rr_request_id, _rr_status_raw, _raw_last, _correlation_id, 'reconciler'
  );
  RETURN jsonb_build_object('ok', true, 'state','reconciled_created','idempotent', false);
END;
$$;
REVOKE ALL ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text) TO service_role;

-- ---------------------------------------------------------------------
-- 4. rr_mark_upstream_unknown — фиксирует upstream_call_state='outcome_unknown'.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rr_mark_upstream_unknown(uuid, text, text, int, text);

CREATE FUNCTION public.rr_mark_upstream_unknown(
  _order_id uuid, _provider_request_id text, _failure_kind text,
  _http_status int, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_meta jsonb; v_provider text; v_flow text; v_status text; v_prev_upstream text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_unknown_order_not_found' USING ERRCODE='P0002'; END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_unknown_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;
  v_status := v_meta#>>'{rr,initiation_status}';
  v_prev_upstream := v_meta#>>'{rr,upstream_outcome}';

  IF v_status = 'created' OR v_status = 'failed' THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal','initiation_status', v_status);
  END IF;
  IF v_prev_upstream = 'unknown' THEN
    RETURN jsonb_build_object('ok', true, 'state','already_unknown','idempotent', true);
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
      'marked_unknown_at', to_jsonb(now()),
      'upstream_call_state','outcome_unknown'
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
    'upstream_outcome','unknown','reconciliation_status','pending',
    'upstream_call_state','outcome_unknown');
END;
$$;
REVOKE ALL ON FUNCTION public.rr_mark_upstream_unknown(uuid, text, text, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_upstream_unknown(uuid, text, text, int, text) TO service_role;

-- ---------------------------------------------------------------------
-- 5. rr_mark_local_persist_failed — фиксирует upstream_call_state='completed_unpersisted'.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.rr_mark_local_persist_failed(uuid, text, text, text);

CREATE FUNCTION public.rr_mark_local_persist_failed(
  _order_id uuid, _payment_url text, _rr_request_id text, _error_text text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_meta jsonb; v_provider text; v_flow text; v_status text; v_prev_pf boolean;
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
  v_prev_pf := COALESCE((v_meta#>>'{rr,local_persist_failed}')::boolean, false);

  IF v_status = 'created' OR v_status = 'failed' THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal','initiation_status', v_status);
  END IF;
  IF v_prev_pf THEN
    RETURN jsonb_build_object('ok', true, 'state','already_persist_failed','idempotent', true);
  END IF;

  v_meta := jsonb_set(
    COALESCE(v_meta,'{}'::jsonb),'{rr}',
    COALESCE(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status','pending',
      'local_persist_failed', true,
      'rr_payment_url_recovered', _payment_url,
      'rr_request_id_recovered',  _rr_request_id,
      'local_persist_error', LEFT(COALESCE(_error_text,''), 500),
      'local_persist_failed_at', to_jsonb(now()),
      'upstream_call_state','completed_unpersisted'
    ), true
  );
  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  RETURN jsonb_build_object('ok', true, 'state','persist_failed_marked',
    'local_persist_failed', true, 'has_recovered_url', true,
    'upstream_call_state','completed_unpersisted');
END;
$$;
REVOKE ALL ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- Артефакт runtime proof: снимок функций и grants после миграции.
-- ---------------------------------------------------------------------
COMMENT ON FUNCTION public.rr_finalize_created_order_internal(uuid, text, text, text, jsonb, text, text)
  IS 'Gate A.1 v3.1 internal: единственный writer canonical success-state RR. Внешний EXECUTE запрещён.';
COMMENT ON FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text)
  IS 'Gate A.1 v3.1: canonical wrapper с ambiguous-guard, делегирует internal.';
COMMENT ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text)
  IS 'Gate A.1 v3.1: единственный вход ambiguous → created, делегирует internal.';
