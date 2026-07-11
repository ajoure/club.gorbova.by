-- =====================================================================
-- DRAFT MIGRATION: Gate A.1 v3.1a
-- Файл: docs/audit/2026-07-10-sprint-b-runtime-proof/gate_a1_v3_1a/draft/migration_gate_a1_v3_1a.sql
-- Статус: DRAFT — НЕ применять в production до создания preview/test environment.
--
-- Реализует пункты A1–A5 плана:
--   A1. rr_is_safe_payment_url + использование во всех writer'ах URL
--   A2. hardening rr_finalize_created_order_internal (allowlist _source, guards, REVOKE)
--   A3. нормализация legacy markers + controlled backfill
--   A4. синхронизация candidate priority в rr_get_or_create_pending_order
--   A5. compatibility payload для already_* ответов
-- =====================================================================

-- ---------- A1. Валидатор безопасного URL ----------
CREATE OR REPLACE FUNCTION public.rr_is_safe_payment_url(_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trim text;
  v_after_scheme text;
  v_authority text;
BEGIN
  IF _url IS NULL THEN RETURN false; END IF;
  v_trim := btrim(_url);
  IF v_trim = '' THEN RETURN false; END IF;
  IF length(v_trim) > 2048 THEN RETURN false; END IF;
  -- запрет CR/LF/control chars
  IF v_trim ~ '[[:cntrl:]]' THEN RETURN false; END IF;
  -- обязательный https://
  IF left(v_trim, 8) <> 'https://' THEN RETURN false; END IF;
  v_after_scheme := substr(v_trim, 9);
  -- authority = до первого '/'
  v_authority := split_part(v_after_scheme, '/', 1);
  IF v_authority = '' THEN RETURN false; END IF;
  -- запрет user-info (userinfo@host)
  IF position('@' in v_authority) > 0 THEN RETURN false; END IF;
  -- запрет пробелов внутри URL
  IF v_trim ~ '\s' THEN RETURN false; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.rr_is_safe_payment_url(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_is_safe_payment_url(text) TO service_role;

-- ---------- A2. Internal helper canonical success-state ----------
-- Только internal writer canonical success. Недоступен ни одной API-роли.
CREATE OR REPLACE FUNCTION public.rr_finalize_created_order_internal(
  _order_id uuid,
  _payment_url text,
  _rr_request_id text,
  _rr_status_raw text,
  _raw_last jsonb,
  _correlation_id text,
  _source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.orders_v2%ROWTYPE;
  v_new_meta jsonb;
BEGIN
  IF _source IS NULL OR _source NOT IN ('canonical','reconciler') THEN
    RAISE EXCEPTION 'rr_finalize_internal_invalid_source' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.provider <> 'rr' THEN
    RAISE EXCEPTION 'rr_finalize_wrong_provider' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_row.meta->>'flow','') <> 'rr_installment' THEN
    RAISE EXCEPTION 'rr_finalize_wrong_flow' USING ERRCODE = 'P0001';
  END IF;

  -- Terminal-guard.
  IF v_row.initiation_status IN ('created','failed') THEN
    IF v_row.payment_url IS NOT NULL AND v_row.payment_url <> _payment_url THEN
      RAISE EXCEPTION 'rr_finalize_url_conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN jsonb_build_object(
      'ok', true,
      'state', 'already_created',
      'payment_url', v_row.payment_url,
      'same_payment_url', (v_row.payment_url = _payment_url)
    );
  END IF;

  -- Source-state guard (в зависимости от источника).
  IF _source = 'canonical' THEN
    IF v_row.initiation_status <> 'pending'
       OR COALESCE((v_row.meta->'rr'->>'upstream_outcome'),'') <> ''
       OR COALESCE((v_row.meta->'rr'->>'local_persist_failed')::boolean, false) = true THEN
      RAISE EXCEPTION 'rr_finalize_ambiguous_source_forbidden' USING ERRCODE = 'P0001';
    END IF;
  ELSIF _source = 'reconciler' THEN
    IF COALESCE((v_row.meta->'rr'->>'upstream_outcome'),'') <> 'unknown' THEN
      RAISE EXCEPTION 'rr_finalize_reconciler_source_required_unknown' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_new_meta := COALESCE(v_row.meta, '{}'::jsonb);
  v_new_meta := jsonb_set(v_new_meta, '{rr,upstream_outcome}', 'null'::jsonb, true);
  v_new_meta := v_new_meta #- '{rr,upstream_outcome}';
  v_new_meta := v_new_meta #- '{rr,local_persist_failed}';
  v_new_meta := v_new_meta #- '{rr,reconciliation_status}';
  v_new_meta := jsonb_set(v_new_meta, '{rr,upstream_call_state}', to_jsonb('completed'::text), true);
  v_new_meta := jsonb_set(v_new_meta, '{rr,finalized_source}', to_jsonb(_source), true);
  IF _rr_request_id IS NOT NULL THEN
    v_new_meta := jsonb_set(v_new_meta, '{rr,rr_request_id}', to_jsonb(_rr_request_id), true);
  END IF;
  IF _rr_status_raw IS NOT NULL THEN
    v_new_meta := jsonb_set(v_new_meta, '{rr,rr_status_raw}', to_jsonb(_rr_status_raw), true);
  END IF;
  IF _raw_last IS NOT NULL THEN
    v_new_meta := jsonb_set(v_new_meta, '{rr,raw_last}', _raw_last, true);
  END IF;
  IF _correlation_id IS NOT NULL THEN
    v_new_meta := jsonb_set(v_new_meta, '{rr,correlation_id}', to_jsonb(_correlation_id), true);
  END IF;

  UPDATE public.orders_v2
     SET initiation_status = 'created',
         payment_url = _payment_url,
         meta = v_new_meta,
         updated_at = now()
   WHERE id = _order_id;

  RETURN jsonb_build_object(
    'ok', true,
    'state', 'created',
    'payment_url', _payment_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rr_finalize_created_order_internal(uuid,text,text,text,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rr_finalize_created_order_internal(uuid,text,text,text,jsonb,text,text) FROM anon, authenticated, service_role;
-- Owner фиксируется в runtime_proof/owner_security_matrix.txt.

-- ---------- A1 продолжение: обёртки, которые пишут URL, обязаны валидировать ----------
-- Public canonical wrapper (единственный вызывается edge public-rr-installment-initiate).
CREATE OR REPLACE FUNCTION public.rr_finalize_created_order(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.rr_finalize_created_order_internal(
    _order_id, _payment_url, _rr_request_id, _rr_status_raw, _raw_last, _correlation_id, 'canonical'
  );
END;
$$;

-- Reconciler wrapper.
CREATE OR REPLACE FUNCTION public.rr_reconcile_confirm_created(
  _order_id uuid, _payment_url text, _rr_request_id text,
  _rr_status_raw text, _raw_last jsonb, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.rr_finalize_created_order_internal(
    _order_id, _payment_url, _rr_request_id, _rr_status_raw, _raw_last, _correlation_id, 'reconciler'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rr_finalize_created_order(uuid,text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_finalize_created_order(uuid,text,text,text,jsonb,text) TO service_role;

REVOKE ALL ON FUNCTION public.rr_reconcile_confirm_created(uuid,text,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_reconcile_confirm_created(uuid,text,text,text,jsonb,text) TO service_role;

-- ---------- A3. Нормализация legacy markers ----------
-- rr_mark_upstream_unknown: идемпотентно нормализовать старые состояния.
CREATE OR REPLACE FUNCTION public.rr_mark_upstream_unknown(
  _order_id uuid, _provider_request_id text, _failure_kind text,
  _http_status integer, _correlation_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.orders_v2%ROWTYPE; v_meta jsonb;
BEGIN
  SELECT * INTO v_row FROM public.orders_v2 WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_row.initiation_status IN ('created','failed') THEN
    RETURN jsonb_build_object('ok', true, 'state','terminal_order_unchanged');
  END IF;
  v_meta := COALESCE(v_row.meta,'{}'::jsonb);
  IF COALESCE(v_meta->'rr'->>'upstream_outcome','') = 'unknown' THEN
    -- Нормализация legacy: гарантировать поля, даже если marker уже был.
    v_meta := jsonb_set(v_meta, '{rr,upstream_call_state}', to_jsonb('outcome_unknown'::text), true);
    v_meta := jsonb_set(v_meta, '{rr,reconciliation_status}',
      to_jsonb(COALESCE(v_meta->'rr'->>'reconciliation_status','pending')), true);
    UPDATE public.orders_v2 SET meta = v_meta, initiation_status='pending', updated_at=now() WHERE id=_order_id;
    RETURN jsonb_build_object('ok',true,'state','already_unknown',
      'upstream_call_state','outcome_unknown');
  END IF;
  v_meta := jsonb_set(v_meta, '{rr,upstream_outcome}', to_jsonb('unknown'::text), true);
  v_meta := jsonb_set(v_meta, '{rr,upstream_call_state}', to_jsonb('outcome_unknown'::text), true);
  v_meta := jsonb_set(v_meta, '{rr,reconciliation_status}', to_jsonb('pending'::text), true);
  IF _provider_request_id IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,rr_request_id}', to_jsonb(_provider_request_id), true);
  END IF;
  IF _failure_kind IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,failure_kind}', to_jsonb(_failure_kind), true);
  END IF;
  IF _http_status IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,http_status}', to_jsonb(_http_status), true);
  END IF;
  IF _correlation_id IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,correlation_id}', to_jsonb(_correlation_id), true);
  END IF;
  UPDATE public.orders_v2 SET meta=v_meta, initiation_status='pending', updated_at=now() WHERE id=_order_id;
  RETURN jsonb_build_object('ok',true,'state','unknown_marked','upstream_call_state','outcome_unknown');
END;
$$;

-- rr_mark_local_persist_failed: идемпотентная нормализация.
CREATE OR REPLACE FUNCTION public.rr_mark_local_persist_failed(
  _order_id uuid, _payment_url text, _rr_request_id text, _error_text text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.orders_v2%ROWTYPE; v_meta jsonb; v_existing text;
BEGIN
  IF _payment_url IS NOT NULL AND NOT public.rr_is_safe_payment_url(_payment_url) THEN
    RAISE EXCEPTION 'rr_payment_url_invalid' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_row FROM public.orders_v2 WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE='P0002'; END IF;
  IF v_row.initiation_status IN ('created','failed') THEN
    RETURN jsonb_build_object('ok',true,'state','terminal_order_unchanged');
  END IF;
  v_meta := COALESCE(v_row.meta,'{}'::jsonb);
  v_existing := v_meta->'rr'->>'rr_payment_url_recovered';
  IF COALESCE((v_meta->'rr'->>'local_persist_failed')::boolean,false) = true THEN
    v_meta := jsonb_set(v_meta, '{rr,upstream_call_state}', to_jsonb('completed_unpersisted'::text), true);
    UPDATE public.orders_v2 SET meta=v_meta, updated_at=now() WHERE id=_order_id;
    RETURN jsonb_build_object('ok',true,'state','already_persist_failed',
      'same_payment_url', (v_existing IS NOT DISTINCT FROM _payment_url),
      'upstream_call_state','completed_unpersisted');
  END IF;
  v_meta := jsonb_set(v_meta, '{rr,local_persist_failed}', 'true'::jsonb, true);
  v_meta := jsonb_set(v_meta, '{rr,upstream_call_state}', to_jsonb('completed_unpersisted'::text), true);
  IF _payment_url IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,rr_payment_url_recovered}', to_jsonb(_payment_url), true);
  END IF;
  IF _rr_request_id IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,rr_request_id_recovered}', to_jsonb(_rr_request_id), true);
  END IF;
  IF _error_text IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,persist_error}', to_jsonb(_error_text), true);
  END IF;
  UPDATE public.orders_v2 SET meta=v_meta, updated_at=now() WHERE id=_order_id;
  RETURN jsonb_build_object('ok',true,'state','persist_failed_marked',
    'upstream_call_state','completed_unpersisted');
END;
$$;

REVOKE ALL ON FUNCTION public.rr_mark_upstream_unknown(uuid,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_mark_upstream_unknown(uuid,text,text,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.rr_mark_local_persist_failed(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_mark_local_persist_failed(uuid,text,text,text) TO service_role;

-- ---------- A3. Controlled backfill ----------
-- Только provider='rr' AND meta.flow='rr_installment' AND status='pending'
-- + upstream_outcome='unknown' и upstream_call_state='started' → outcome_unknown
-- + local_persist_failed=true и upstream_call_state='started' → completed_unpersisted
--
-- Перед выполнением сохранить SELECT в legacy_backfill_before.txt.

WITH candidates_unknown AS (
  SELECT id FROM public.orders_v2
   WHERE provider='rr'
     AND COALESCE(meta->>'flow','') = 'rr_installment'
     AND status='pending'
     AND COALESCE(meta->'rr'->>'upstream_outcome','') = 'unknown'
     AND COALESCE(meta->'rr'->>'upstream_call_state','') = 'started'
)
UPDATE public.orders_v2 o
   SET meta = jsonb_set(o.meta, '{rr,upstream_call_state}', to_jsonb('outcome_unknown'::text), true),
       updated_at = now()
  FROM candidates_unknown c
 WHERE o.id = c.id;

WITH candidates_persist AS (
  SELECT id FROM public.orders_v2
   WHERE provider='rr'
     AND COALESCE(meta->>'flow','') = 'rr_installment'
     AND status='pending'
     AND COALESCE((meta->'rr'->>'local_persist_failed')::boolean,false) = true
     AND COALESCE(meta->'rr'->>'upstream_call_state','') = 'started'
)
UPDATE public.orders_v2 o
   SET meta = jsonb_set(o.meta, '{rr,upstream_call_state}', to_jsonb('completed_unpersisted'::text), true),
       updated_at = now()
  FROM candidates_persist c
 WHERE o.id = c.id;

-- После backfill сохранить SELECT в legacy_backfill_after.txt.

-- ---------- A4. Candidate priority в rr_get_or_create_pending_order ----------
-- Приоритет (state weight):
--  1 created + valid payment_url
--  2 local_persist_failed=true
--  3 upstream_outcome='unknown'
--  4 operator_resolution='keep_blocked'
--  5 upstream_call_state='started'
--  6 обычный fresh pending
--  7 создание нового заказа
-- Tie-break: (state_weight ASC, updated_at DESC, created_at DESC, id ASC).

CREATE OR REPLACE FUNCTION public.rr_get_or_create_pending_order(
  _offer_id uuid, _user_id uuid, _email_norm text, _phone_norm text,
  _product_id uuid, _tariff_id uuid, _amount numeric, _currency text,
  _customer_email text, _customer_phone text, _customer_ip text, _meta jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_id uuid;
  v_new_id uuid;
  v_row public.orders_v2%ROWTYPE;
BEGIN
  SELECT id INTO v_candidate_id FROM (
    SELECT id,
      CASE
        WHEN initiation_status='created' AND public.rr_is_safe_payment_url(payment_url) THEN 1
        WHEN COALESCE((meta->'rr'->>'local_persist_failed')::boolean,false) = true THEN 2
        WHEN COALESCE(meta->'rr'->>'upstream_outcome','') = 'unknown' THEN 3
        WHEN COALESCE(meta->'rr'->>'operator_resolution','') = 'keep_blocked' THEN 4
        WHEN COALESCE(meta->'rr'->>'upstream_call_state','') = 'started' THEN 5
        WHEN initiation_status='pending' THEN 6
        ELSE NULL
      END AS weight,
      updated_at, created_at
    FROM public.orders_v2
    WHERE provider='rr'
      AND COALESCE(meta->>'flow','') = 'rr_installment'
      AND offer_id = _offer_id
      AND COALESCE(user_id::text,'') = COALESCE(_user_id::text,'')
      AND COALESCE(meta->'identity'->>'email_norm','') = COALESCE(_email_norm,'')
      AND COALESCE(meta->'identity'->>'phone_norm','') = COALESCE(_phone_norm,'')
      AND initiation_status NOT IN ('failed')
      AND NOT (COALESCE(meta->'rr'->>'operator_resolution','') = 'allow_new_order')
  ) c
  WHERE weight IS NOT NULL
  ORDER BY weight ASC, updated_at DESC, created_at DESC, id ASC
  LIMIT 1
  FOR UPDATE;

  IF v_candidate_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.orders_v2 WHERE id = v_candidate_id;
    RETURN jsonb_build_object(
      'ok', true,
      'state', 'reused',
      'order_id', v_row.id,
      'initiation_status', v_row.initiation_status,
      'upstream_call_state', COALESCE(v_row.meta->'rr'->>'upstream_call_state','not_started'),
      'upstream_outcome', v_row.meta->'rr'->>'upstream_outcome',
      'local_persist_failed', COALESCE((v_row.meta->'rr'->>'local_persist_failed')::boolean,false),
      'payment_url', v_row.payment_url,
      'meta_rr', v_row.meta->'rr'
    );
  END IF;

  -- Создание нового заказа. upstream_call_state='not_started' явно.
  INSERT INTO public.orders_v2(
    id, provider, offer_id, user_id, product_id, tariff_id,
    amount, status, initiation_status, meta, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), 'rr', _offer_id, _user_id, _product_id, _tariff_id,
    _amount, 'pending', 'pending',
    jsonb_build_object(
      'flow','rr_installment',
      'identity', jsonb_build_object('email_norm',_email_norm,'phone_norm',_phone_norm),
      'customer', jsonb_build_object('email',_customer_email,'phone',_customer_phone,'ip',_customer_ip),
      'rr', jsonb_build_object('upstream_call_state','not_started')
    ) || COALESCE(_meta,'{}'::jsonb),
    now(), now()
  ) RETURNING id INTO v_new_id;

  SELECT * INTO v_row FROM public.orders_v2 WHERE id = v_new_id;
  RETURN jsonb_build_object(
    'ok', true,
    'state', 'created_new',
    'order_id', v_row.id,
    'initiation_status', v_row.initiation_status,
    'upstream_call_state','not_started'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rr_get_or_create_pending_order(uuid,uuid,text,text,uuid,uuid,numeric,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_get_or_create_pending_order(uuid,uuid,text,text,uuid,uuid,numeric,text,text,text,text,jsonb) TO service_role;

-- ---------- A5. Compatibility payload для already_* ответов ----------
-- Уже включено выше в rr_finalize_created_order_internal (already_created),
-- rr_mark_upstream_unknown (already_unknown), rr_mark_local_persist_failed (already_persist_failed).
-- rr_finalize_order_rejected (already_rejected) добавляется здесь.

CREATE OR REPLACE FUNCTION public.rr_finalize_order_rejected(
  _order_id uuid, _reason_code text, _http_status integer, _response_snippet jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.orders_v2%ROWTYPE; v_meta jsonb; v_existing text;
BEGIN
  SELECT * INTO v_row FROM public.orders_v2 WHERE id=_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rr_order_not_found' USING ERRCODE='P0002'; END IF;
  v_meta := COALESCE(v_row.meta,'{}'::jsonb);
  v_existing := v_meta->'rr'->>'provider_error_code';
  IF v_row.initiation_status = 'failed' THEN
    RETURN jsonb_build_object('ok',true,'state','already_rejected',
      'provider_error_code', v_existing,
      'same_reason', (v_existing IS NOT DISTINCT FROM _reason_code));
  END IF;
  IF v_row.initiation_status = 'created' THEN
    RAISE EXCEPTION 'rr_reject_after_created_forbidden' USING ERRCODE='P0001';
  END IF;
  v_meta := jsonb_set(v_meta, '{rr,provider_error_code}', to_jsonb(COALESCE(_reason_code,'unknown')), true);
  IF _http_status IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,provider_http_status}', to_jsonb(_http_status), true);
  END IF;
  IF _response_snippet IS NOT NULL THEN
    v_meta := jsonb_set(v_meta, '{rr,provider_response_snippet}', _response_snippet, true);
  END IF;
  UPDATE public.orders_v2
     SET initiation_status='failed', status='failed', meta=v_meta, updated_at=now()
   WHERE id=_order_id;
  RETURN jsonb_build_object('ok',true,'state','rejected',
    'provider_error_code', COALESCE(_reason_code,'unknown'));
END;
$$;

REVOKE ALL ON FUNCTION public.rr_finalize_order_rejected(uuid,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rr_finalize_order_rejected(uuid,text,integer,jsonb) TO service_role;

-- =====================================================================
-- КОНЕЦ DRAFT MIGRATION. Runtime proof см. gate_a1_v3_1a/runtime_proof/.
-- =====================================================================
