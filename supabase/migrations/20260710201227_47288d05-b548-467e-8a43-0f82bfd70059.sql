-- Gate A.1 hardening: durable recovery, working reconciliation contract,
-- atomic terminal finalizers, operator resolution enum, SECURITY DEFINER hardening.
-- Sprint B follow-up. All new RPCs — service_role only.

-- 1. Hardening существующих SECURITY DEFINER функций.
ALTER FUNCTION public.rr_finalize_created_order(uuid, text, text, text, jsonb, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.rr_mark_local_persist_failed(uuid, text, text, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.rr_get_or_create_pending_order(
  uuid, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb
) SET search_path = public, pg_temp;

-- 2. rr_get_or_create_pending_order — расширяем кандидаты reuse без смены сигнатуры.
--    Identity: offer_id + user_id + email_norm + phone_norm.
--    Add-only reuse ветки (без временных окон): local_persist_failed / upstream_outcome=unknown /
--    reconciliation в состоянии, блокирующем новый заказ.
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
BEGIN
  v_lock_key := hashtextextended(
    coalesce(_offer_id::text,'') || '|' ||
    coalesce(_user_id::text,'') || '|' ||
    coalesce(_email_norm,'') || '|' ||
    coalesce(_phone_norm,''),
    42
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Приоритет:
  --  1) durable-blocking (без временных окон):
  --     а) local_persist_failed = true                        — recovery ветка
  --     b) upstream_outcome = 'unknown' и recon в блокирующем — reconciliation-pending
  --     c) resolved + operator_resolution in (keep_blocked, confirm_created) — оператор
  --  2) обычный concurrency reuse: created + payment_url ИЛИ pending < 120s.
  SELECT * INTO v_row
    FROM public.orders_v2 o
   WHERE o.offer_id = _offer_id
     AND o.provider = 'rr'
     AND (o.meta->>'flow') = 'rr_installment'
     AND (o.user_id IS NOT DISTINCT FROM _user_id)
     AND (_email_norm IS NULL OR lower(trim(coalesce(o.customer_email,''))) = _email_norm)
     AND (_phone_norm IS NULL OR regexp_replace(coalesce(o.customer_phone,''), '\D', '', 'g') = _phone_norm)
     AND (
       -- durable-block: recovery
       (
         o.status = 'pending'::order_status
         AND (o.meta->'rr'->>'local_persist_failed') = 'true'
       )
       OR
       -- durable-block: ambiguous upstream, требует reconciliation
       (
         o.status = 'pending'::order_status
         AND (o.meta->'rr'->>'upstream_outcome') = 'unknown'
         AND coalesce(o.meta->'rr'->>'reconciliation_status','pending')
             IN ('pending','operator_required')
       )
       OR
       -- durable-block: operator resolved, но не allow_new_order
       (
         o.status = 'pending'::order_status
         AND (o.meta->'rr'->>'reconciliation_status') = 'resolved'
         AND coalesce(o.meta->'rr'->>'operator_resolution','')
             IN ('keep_blocked','confirm_created')
       )
       OR
       -- обычный reuse (window)
       (
         o.status = 'pending'::order_status
         AND o.created_at >= now() - interval '30 minutes'
         AND (
              ((o.meta->'rr'->>'initiation_status') = 'created'
                 AND coalesce(o.meta->'rr'->>'payment_url','') <> '')
           OR ((o.meta->'rr'->>'initiation_status') = 'pending'
                 AND o.created_at >= now() - interval '120 seconds'
                 AND (o.meta->'rr'->>'local_persist_failed') IS DISTINCT FROM 'true'
                 AND (o.meta->'rr'->>'upstream_outcome') IS DISTINCT FROM 'unknown')
         )
       )
     )
   ORDER BY
     -- сначала durable-block, потом created+url, потом свежие pending
     CASE
       WHEN (o.meta->'rr'->>'local_persist_failed') = 'true' THEN 0
       WHEN (o.meta->'rr'->>'upstream_outcome') = 'unknown' THEN 1
       WHEN (o.meta->'rr'->>'reconciliation_status') = 'resolved' THEN 2
       WHEN (o.meta->'rr'->>'initiation_status') = 'created' THEN 3
       ELSE 4
     END,
     o.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    order_id := v_row.id;
    was_reused := true;
    order_number := v_row.order_number;
    RETURN NEXT;
    RETURN;
  END IF;

  v_order_number := public.generate_order_number();
  INSERT INTO public.orders_v2(
    order_number, product_id, tariff_id, offer_id,
    base_price, final_price, currency,
    status, provider, customer_email, customer_phone, customer_ip,
    user_id, meta
  ) VALUES (
    v_order_number, _product_id, _tariff_id, _offer_id,
    _amount, _amount, _currency,
    'pending'::order_status,
    'rr', _customer_email, _customer_phone, _customer_ip,
    _user_id, _meta
  ) RETURNING * INTO v_row;

  order_id := v_row.id;
  was_reused := false;
  order_number := v_row.order_number;
  RETURN NEXT;
END;
$function$;

-- 3. rr_mark_upstream_unknown — атомарная маркировка неопределённого исхода createOrder.
CREATE OR REPLACE FUNCTION public.rr_mark_upstream_unknown(
  _order_id uuid,
  _provider_request_id text,
  _failure_kind text,
  _http_status int,
  _correlation_id text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_meta jsonb;
  v_provider text;
  v_flow text;
  v_current_status text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_unknown_order_not_found' USING ERRCODE='P0002';
  END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_unknown_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;

  v_current_status := v_meta#>>'{rr,initiation_status}';
  -- Не перезаписывать terminal state.
  IF v_current_status = 'created' OR v_current_status = 'failed' THEN
    RETURN;
  END IF;

  v_meta := jsonb_set(
    coalesce(v_meta,'{}'::jsonb),
    '{rr}',
    coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status',       'pending',
      'upstream_outcome',        'unknown',
      'reconciliation_status',   'pending',
      'reconciliation_attempts', 0,
      'failure_kind',            _failure_kind,
      'http_status_last',        _http_status,
      'provider_request_id',     _provider_request_id,
      'marked_unknown_at',       to_jsonb(now())
    ),
    true
  );

  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;

  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr', 'rr', true,
    _order_id::text || ':create_order_outcome_unknown',
    'create_order_outcome_unknown',
    _order_id::text || ':create_order_outcome_unknown',
    jsonb_build_object(
      'failure_kind',        _failure_kind,
      'http_status',         _http_status,
      'provider_request_id', _provider_request_id,
      'correlation_id',      _correlation_id
    ),
    'pending', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- 4. rr_finalize_order_rejected — АТОМАРНЫЙ terminal для документированного отказа РР.
--    Используется ТОЛЬКО когда РР явно отклонил запрос (upstream_rejected).
CREATE OR REPLACE FUNCTION public.rr_finalize_order_rejected(
  _order_id uuid,
  _reason_code text,
  _http_status int,
  _response_snippet jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_meta jsonb;
  v_provider text;
  v_flow text;
  v_status text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_reject_order_not_found' USING ERRCODE='P0002';
  END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_reject_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;

  v_status := v_meta#>>'{rr,initiation_status}';
  -- Идемпотентность: если уже rejected — ничего не делать.
  IF v_status = 'failed' AND (v_meta#>>'{rr,upstream_outcome}') = 'rejected' THEN
    RETURN;
  END IF;
  IF v_status = 'created' THEN
    RAISE EXCEPTION 'rr_reject_conflict_already_created' USING ERRCODE='22023';
  END IF;

  v_meta := jsonb_set(
    coalesce(v_meta,'{}'::jsonb),
    '{rr}',
    coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status', 'failed',
      'upstream_outcome',  'rejected',
      'reject_reason',     _reason_code,
      'http_status',       _http_status,
      'raw_last',          _response_snippet,
      'rejected_at',       to_jsonb(now())
    ),
    true
  );

  UPDATE public.orders_v2
     SET meta = v_meta, status = 'failed'::order_status, updated_at = now()
   WHERE id = _order_id;

  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr', 'rr', true,
    _order_id::text || ':create_order_rejected',
    'create_order_rejected',
    _order_id::text || ':create_order_rejected',
    jsonb_build_object(
      'reason_code', _reason_code,
      'http_status', _http_status,
      'raw_last',    _response_snippet
    ),
    'rejected', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- 5. rr_finalize_order_not_created — АТОМАРНЫЙ terminal для случая, когда reconciler
--    достоверно подтвердил ОТСУТСТВИЕ заявки у РР (не путать с rejected).
CREATE OR REPLACE FUNCTION public.rr_finalize_order_not_created(
  _order_id uuid,
  _evidence jsonb
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_meta jsonb;
  v_provider text;
  v_flow text;
  v_status text;
  v_upstream text;
BEGIN
  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_not_created_order_not_found' USING ERRCODE='P0002';
  END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_not_created_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;

  v_status := v_meta#>>'{rr,initiation_status}';
  v_upstream := v_meta#>>'{rr,upstream_outcome}';

  -- Идемпотентность
  IF v_status = 'failed' AND v_upstream = 'not_created' THEN
    RETURN;
  END IF;
  IF v_status = 'created' THEN
    RAISE EXCEPTION 'rr_not_created_conflict_already_created' USING ERRCODE='22023';
  END IF;

  v_meta := jsonb_set(
    coalesce(v_meta,'{}'::jsonb),
    '{rr}',
    coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status',     'failed',
      'upstream_outcome',      'not_created',
      'reconciliation_status', 'not_found',
      'reconciled_at',         to_jsonb(now()),
      'reconciliation_evidence', _evidence
    ),
    true
  );

  UPDATE public.orders_v2
     SET meta = v_meta, status = 'failed'::order_status, updated_at = now()
   WHERE id = _order_id;

  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr', 'rr', true,
    _order_id::text || ':create_order_confirmed_not_created',
    'create_order_confirmed_not_created',
    _order_id::text || ':create_order_confirmed_not_created',
    jsonb_build_object('evidence', _evidence),
    'processed', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- 6. rr_reconcile_confirm_created — АТОМАРНО: canonical финализация + reconciliation audit.
--    Единая транзакция: сбой любой части откатывает всё.
CREATE OR REPLACE FUNCTION public.rr_reconcile_confirm_created(
  _order_id uuid,
  _payment_url text,
  _rr_request_id text,
  _rr_status_raw text,
  _raw_last jsonb,
  _correlation_id text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_meta jsonb;
  v_provider text;
  v_flow text;
BEGIN
  IF _order_id IS NULL OR _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
    RAISE EXCEPTION 'rr_recon_invalid_input' USING ERRCODE='22023';
  END IF;

  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_recon_order_not_found' USING ERRCODE='P0002';
  END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_recon_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;

  -- Мержим канонический payment_url и снимаем блокирующие маркеры.
  v_meta := jsonb_set(
    coalesce(v_meta,'{}'::jsonb),
    '{rr}',
    coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
      'initiation_status',      'created',
      'payment_url',            _payment_url,
      'rr_request_id',          _rr_request_id,
      'rr_status_raw',          _rr_status_raw,
      'raw_last',               _raw_last,
      'finalized_at',           to_jsonb(now()),
      'local_persist_failed',   false,
      'upstream_outcome',       'created',
      'reconciliation_status',  'confirmed_created',
      'reconciled_at',          to_jsonb(now())
    ),
    true
  );

  UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;

  -- Canonical событие успеха (идемпотентно).
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr', 'rr', true,
    _order_id::text || ':create_order_succeeded',
    'create_order_succeeded',
    _order_id::text || ':create_order_succeeded',
    jsonb_build_object(
      'payment_url',    _payment_url,
      'rr_request_id',  _rr_request_id,
      'rr_status_raw',  _rr_status_raw,
      'raw_last',       _raw_last,
      'correlation_id', _correlation_id,
      'source',         'reconciler'
    ),
    'processed', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  -- Audit-событие reconciliation (идемпотентно).
  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr', 'rr', true,
    _order_id::text || ':reconciliation_confirmed_created',
    'reconciliation_confirmed_created',
    _order_id::text || ':reconciliation_confirmed_created',
    jsonb_build_object(
      'payment_url',    _payment_url,
      'rr_request_id',  _rr_request_id,
      'correlation_id', _correlation_id
    ),
    'processed', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- 7. rr_operator_resolve — enum-based, атомарный, идемпотентный.
--    Разрешённые действия: confirm_created / keep_blocked / allow_new_order.
CREATE OR REPLACE FUNCTION public.rr_operator_resolve(
  _order_id uuid,
  _resolution text,         -- 'confirm_created' | 'keep_blocked' | 'allow_new_order'
  _actor text,              -- audit: кто выполнил
  _payment_url text,        -- обязателен только для confirm_created
  _rr_request_id text,
  _note text
) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_meta jsonb;
  v_provider text;
  v_flow text;
BEGIN
  IF _resolution NOT IN ('confirm_created','keep_blocked','allow_new_order') THEN
    RAISE EXCEPTION 'rr_operator_invalid_resolution' USING ERRCODE='22023';
  END IF;

  SELECT provider, meta INTO v_provider, v_meta
    FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_operator_order_not_found' USING ERRCODE='P0002';
  END IF;
  v_flow := v_meta->>'flow';
  IF v_provider IS DISTINCT FROM 'rr' OR v_flow IS DISTINCT FROM 'rr_installment' THEN
    RAISE EXCEPTION 'rr_operator_wrong_provider_or_flow' USING ERRCODE='22023';
  END IF;

  IF _resolution = 'confirm_created' THEN
    IF _payment_url IS NULL OR length(trim(_payment_url)) = 0 THEN
      RAISE EXCEPTION 'rr_operator_confirm_requires_url' USING ERRCODE='22023';
    END IF;
    -- Делегируем canonical reconcile (атомарно).
    PERFORM public.rr_reconcile_confirm_created(
      _order_id, _payment_url, _rr_request_id, NULL,
      jsonb_build_object('source','operator','actor',_actor,'note',_note),
      'operator:'||_actor
    );
    v_meta := (SELECT meta FROM public.orders_v2 WHERE id = _order_id FOR UPDATE);
    v_meta := jsonb_set(v_meta,'{rr,operator_resolution}', to_jsonb('confirm_created'::text));
    v_meta := jsonb_set(v_meta,'{rr,operator_actor}',      to_jsonb(_actor));
    v_meta := jsonb_set(v_meta,'{rr,operator_note}',       to_jsonb(coalesce(_note,'')));
    v_meta := jsonb_set(v_meta,'{rr,operator_resolved_at}',to_jsonb(now()));
    UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  ELSIF _resolution = 'allow_new_order' THEN
    -- Старый заказ становится terminal 'failed' с operator_resolved=allow_new_order.
    v_meta := jsonb_set(
      coalesce(v_meta,'{}'::jsonb),
      '{rr}',
      coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
        'initiation_status',     'failed',
        'reconciliation_status', 'resolved',
        'operator_resolution',   'allow_new_order',
        'operator_actor',        _actor,
        'operator_note',         coalesce(_note,''),
        'operator_resolved_at',  to_jsonb(now())
      ),
      true
    );
    UPDATE public.orders_v2
       SET meta = v_meta, status = 'failed'::order_status, updated_at = now()
     WHERE id = _order_id;
  ELSE -- keep_blocked
    v_meta := jsonb_set(
      coalesce(v_meta,'{}'::jsonb),
      '{rr}',
      coalesce(v_meta->'rr','{}'::jsonb) || jsonb_build_object(
        'reconciliation_status', 'resolved',
        'operator_resolution',   'keep_blocked',
        'operator_actor',        _actor,
        'operator_note',         coalesce(_note,''),
        'operator_resolved_at',  to_jsonb(now())
      ),
      true
    );
    UPDATE public.orders_v2 SET meta = v_meta, updated_at = now() WHERE id = _order_id;
  END IF;

  INSERT INTO public.provider_events(
    provider, account_code, signature_valid,
    event_id, event_type, idempotency_key,
    payload, processing_status, processed_at, related_order_id
  ) VALUES (
    'rr','rr',true,
    _order_id::text || ':operator_intervention:' || _resolution,
    'operator_intervention',
    _order_id::text || ':operator_intervention:' || _resolution,
    jsonb_build_object('resolution',_resolution,'actor',_actor,'note',coalesce(_note,'')),
    'processed', now(), _order_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END;
$function$;

-- 8. Grants: все новые RPC — service_role only.
REVOKE ALL ON FUNCTION public.rr_mark_upstream_unknown(uuid, text, text, int, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rr_finalize_order_rejected(uuid, text, int, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rr_finalize_order_not_created(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rr_operator_resolve(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rr_mark_upstream_unknown(uuid, text, text, int, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rr_finalize_order_rejected(uuid, text, int, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rr_finalize_order_not_created(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rr_reconcile_confirm_created(uuid, text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rr_operator_resolve(uuid, text, text, text, text, text) TO service_role;