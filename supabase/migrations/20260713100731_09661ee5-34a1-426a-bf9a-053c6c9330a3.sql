-- =====================================================================
-- Stage 2R (PATCH-PAYMENTS-MANAGEMENT-V2)
-- Reservation-first idempotency, financial source truth, fail-closed status,
-- server-side validation, atomic rollback on recalc failure.
-- =====================================================================

-- 1. Reservation table --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_deal_reservations (
  idempotency_key text PRIMARY KEY,
  source          text NOT NULL CHECK (source IN ('queue','payments_v2')),
  source_row_id   uuid NOT NULL,
  request_hash    text NOT NULL,
  state           text NOT NULL CHECK (state IN ('processing','completed','failed')),
  order_id        uuid,
  created_by      uuid NOT NULL,
  error_code      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

GRANT SELECT, INSERT, UPDATE ON public.admin_deal_reservations TO authenticated;
GRANT ALL ON public.admin_deal_reservations TO service_role;

ALTER TABLE public.admin_deal_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_deal_reservations_service_all"
  ON public.admin_deal_reservations FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "admin_deal_reservations_admin_read"
  ON public.admin_deal_reservations FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'payments', 'manage'));

-- Одна queue/payments_v2 строка → не более одного completed ордера.
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_deal_reservations_source_row
  ON public.admin_deal_reservations (source, source_row_id)
  WHERE state IN ('processing','completed');

-- 2. Sunset the old idempotency-by-meta index (kept read-only for legacy replay lookup) --
-- (idx_orders_v2_idempotency_key from Stage 2 остаётся — used for legacy migration replay)

-- 3. Rewritten RPC ------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_create_deal_from_payment(
  uuid, text, uuid, uuid, uuid, uuid, uuid, numeric, text,
  timestamptz, timestamptz, text, boolean, text, boolean
);

CREATE OR REPLACE FUNCTION public.admin_create_deal_from_payment(
  p_payment_id       uuid,
  p_raw_source       text,
  p_actor_user_id    uuid,
  p_profile_id       uuid,
  p_product_id       uuid,
  p_tariff_id        uuid,
  p_final_amount     numeric,
  p_final_currency   text,
  p_access_start     timestamptz,
  p_access_end       timestamptz,
  p_customer_email   text,
  p_grant_access     boolean,
  p_idempotency_key  text,
  p_request_hash     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider          text;
  v_status_raw        text;
  v_status_normalized text;
  v_source_amount     numeric;
  v_source_currency   text;
  v_matched_order_id  uuid;
  v_existing_canonical uuid;
  v_profile_user_id   uuid;
  v_is_ghost          boolean;
  v_deal_only         boolean;
  v_product_active    boolean;
  v_tariff_product    uuid;
  v_order_id          uuid;
  v_order_number      text;
  v_canonical_payment_id uuid;
  v_recalc            jsonb;
  v_reservation       public.admin_deal_reservations%ROWTYPE;
  v_currencies text[] := ARRAY['BYN','RUB','USD','EUR','KZT','UAH','PLN'];
  v_canonical_providers text[] := ARRAY['bepaid','stripe','rr','bank'];
BEGIN
  ---------------------------------------------------------------------
  -- 0. Sanity of arguments
  ---------------------------------------------------------------------
  IF p_raw_source NOT IN ('queue','payments_v2') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_raw_source');
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_idempotency_key');
  END IF;
  IF p_request_hash IS NULL OR length(p_request_hash) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_request_hash');
  END IF;
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF NOT (upper(coalesce(p_final_currency,'')) = ANY(v_currencies)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_currency');
  END IF;
  IF p_access_start IS NULL OR p_access_end IS NULL OR p_access_start > p_access_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_access_range');
  END IF;

  ---------------------------------------------------------------------
  -- 1. Reservation-first idempotency
  ---------------------------------------------------------------------
  SELECT * INTO v_reservation
    FROM public.admin_deal_reservations
   WHERE idempotency_key = p_idempotency_key
   FOR UPDATE;

  IF FOUND THEN
    IF v_reservation.request_hash <> p_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict',
                                'existing_hash', v_reservation.request_hash);
    END IF;
    IF v_reservation.state = 'completed' AND v_reservation.order_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true, 'idempotent_replay', true,
        'order_id', v_reservation.order_id,
        'reservation_state', 'completed'
      );
    ELSIF v_reservation.state = 'processing' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'reservation_processing');
    ELSIF v_reservation.state = 'failed' THEN
      -- allow retry: reset state to processing и продолжить
      UPDATE public.admin_deal_reservations
         SET state = 'processing', error_code = NULL, completed_at = NULL
       WHERE idempotency_key = p_idempotency_key;
    END IF;
  ELSE
    -- placeholder source_row_id at this moment is p_payment_id (validated below)
    INSERT INTO public.admin_deal_reservations
      (idempotency_key, source, source_row_id, request_hash, state, created_by)
    VALUES
      (p_idempotency_key, p_raw_source, p_payment_id, p_request_hash, 'processing', p_actor_user_id);
  END IF;

  ---------------------------------------------------------------------
  -- 2. Lock source payment row + provider + REAL amount/currency
  ---------------------------------------------------------------------
  IF p_raw_source = 'queue' THEN
    SELECT lower(coalesce(provider,'')), lower(coalesce(status,'')),
           lower(coalesce(status_normalized,'')),
           amount, currency, matched_order_id
      INTO v_provider, v_status_raw, v_status_normalized,
           v_source_amount, v_source_currency, v_matched_order_id
      FROM public.payment_reconcile_queue
     WHERE id = p_payment_id
     FOR UPDATE;
  ELSE
    SELECT lower(coalesce(provider,'')), lower(coalesce(status::text,'')),
           lower(coalesce(status::text,'')),
           amount, currency, order_id
      INTO v_provider, v_status_raw, v_status_normalized,
           v_source_amount, v_source_currency, v_matched_order_id
      FROM public.payments_v2
     WHERE id = p_payment_id
       AND coalesce(is_deleted, false) = false
       AND deleted_at IS NULL
     FOR UPDATE;
  END IF;

  IF v_provider IS NULL THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='payment_not_found', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  -- Fail-closed allowlist. Никаких pending/processing/refunded/unknown.
  IF p_raw_source = 'queue' THEN
    IF v_status_normalized <> 'successful' THEN
      UPDATE public.admin_deal_reservations
         SET state='failed', error_code='payment_not_successful', completed_at=now()
       WHERE idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('ok', false, 'error', 'payment_not_successful',
                                'status', v_status_raw,
                                'status_normalized', v_status_normalized);
    END IF;
  ELSE
    IF v_status_raw <> 'succeeded' THEN
      UPDATE public.admin_deal_reservations
         SET state='failed', error_code='payment_not_successful', completed_at=now()
       WHERE idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('ok', false, 'error', 'payment_not_successful',
                                'status', v_status_raw);
    END IF;
  END IF;

  IF NOT (v_provider = ANY(v_canonical_providers)) THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='non_canonical_provider', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'non_canonical_provider', 'provider', v_provider);
  END IF;

  -- Уже привязано к другой сделке?
  IF v_matched_order_id IS NOT NULL THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='payment_already_linked', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'payment_already_linked',
                              'existing_order_id', v_matched_order_id);
  END IF;

  -- Для queue: проверить, что нет ранее созданного canonical payment по queue_payment_id
  IF p_raw_source = 'queue' THEN
    SELECT id INTO v_existing_canonical
      FROM public.payments_v2
     WHERE meta->>'queue_payment_id' = p_payment_id::text
       AND coalesce(is_deleted,false) = false
       AND deleted_at IS NULL
     LIMIT 1;
    IF v_existing_canonical IS NOT NULL THEN
      UPDATE public.admin_deal_reservations
         SET state='failed', error_code='queue_row_already_materialized', completed_at=now()
       WHERE idempotency_key = p_idempotency_key;
      RETURN jsonb_build_object('ok', false, 'error', 'queue_row_already_materialized',
                                'canonical_payment_id', v_existing_canonical);
    END IF;
  END IF;

  ---------------------------------------------------------------------
  -- 3. Server-side validation of profile / product / tariff
  ---------------------------------------------------------------------
  SELECT user_id INTO v_profile_user_id
    FROM public.profiles
   WHERE id = p_profile_id;
  IF NOT FOUND THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='profile_not_found', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
  END IF;
  v_is_ghost  := v_profile_user_id IS NULL;
  v_deal_only := NOT coalesce(p_grant_access, false);

  IF v_is_ghost AND NOT v_deal_only THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='ghost_cannot_grant', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'ghost_cannot_grant');
  END IF;

  SELECT is_active INTO v_product_active
    FROM public.products_v2
   WHERE id = p_product_id;
  IF NOT FOUND OR NOT coalesce(v_product_active,false) THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='product_invalid', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'product_invalid');
  END IF;

  SELECT product_id INTO v_tariff_product
    FROM public.tariffs
   WHERE id = p_tariff_id AND coalesce(is_active,false) = true;
  IF NOT FOUND OR v_tariff_product IS DISTINCT FROM p_product_id THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='tariff_invalid', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'tariff_invalid');
  END IF;

  ---------------------------------------------------------------------
  -- 4. Insert order (paid_amount=0; recalc заполнит)
  ---------------------------------------------------------------------
  v_order_number := 'PAY-' || to_char(now(), 'YY') || '-' ||
                    upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  INSERT INTO public.orders_v2 (
    order_number, user_id, profile_id, product_id, tariff_id,
    customer_email, base_price, final_price, paid_amount, currency,
    status, is_trial, created_at, deal_date, meta
  ) VALUES (
    v_order_number,
    CASE WHEN v_is_ghost THEN p_profile_id ELSE v_profile_user_id END,
    p_profile_id,
    p_product_id,
    p_tariff_id,
    p_customer_email,
    p_final_amount,
    p_final_amount,
    0,
    upper(p_final_currency),
    'pending',
    false,
    p_access_start,
    p_access_start,
    jsonb_build_object(
      'source', 'admin_from_payment',
      'created_by', p_actor_user_id,
      'payment_id', p_payment_id,
      'payment_source', p_raw_source,
      'is_ghost', v_is_ghost,
      'deal_only', v_deal_only,
      'idempotency_key', p_idempotency_key,
      'request_hash', p_request_hash,
      'access_start', p_access_start,
      'access_end', p_access_end
    )
  )
  RETURNING id INTO v_order_id;

  ---------------------------------------------------------------------
  -- 5. Canonical payment: сумма и валюта — из ИСТОЧНИКА, не из клиента
  ---------------------------------------------------------------------
  IF p_raw_source = 'queue' THEN
    INSERT INTO public.payments_v2 (
      order_id, user_id, profile_id, amount, currency, status, provider,
      paid_at, created_at, meta
    ) VALUES (
      v_order_id,
      CASE WHEN v_is_ghost THEN p_profile_id ELSE v_profile_user_id END,
      p_profile_id,
      v_source_amount,
      upper(coalesce(v_source_currency, p_final_currency)),
      'succeeded',
      v_provider,
      p_access_start,
      p_access_start,
      jsonb_build_object(
        'source', 'admin_from_payment',
        'queue_payment_id', p_payment_id,
        'derived_provider', v_provider,
        'idempotency_key', p_idempotency_key
      )
    )
    RETURNING id INTO v_canonical_payment_id;

    UPDATE public.payment_reconcile_queue
       SET matched_order_id = v_order_id,
           matched_profile_id = p_profile_id
     WHERE id = p_payment_id;
  ELSE
    UPDATE public.payments_v2
       SET order_id = v_order_id,
           profile_id = p_profile_id,
           user_id = CASE WHEN v_is_ghost THEN p_profile_id ELSE v_profile_user_id END
     WHERE id = p_payment_id;
    v_canonical_payment_id := p_payment_id;
  END IF;

  ---------------------------------------------------------------------
  -- 6. Reason-aware recalc — падение откатывает всю транзакцию
  ---------------------------------------------------------------------
  v_recalc := public.recalc_order_totals(v_order_id, 'payment_added', v_canonical_payment_id);

  IF coalesce((v_recalc->>'ok')::boolean, false) IS NOT TRUE THEN
    -- reservation тоже должен уйти в failed, но RAISE откатит INSERT reservation тоже.
    -- Поэтому пишем маркер до RAISE через отдельный NOTICE и полагаемся на клиента для retry.
    RAISE EXCEPTION 'recalc_failed:%', coalesce(v_recalc::text, '{}')
      USING ERRCODE = 'P0001';
  END IF;

  ---------------------------------------------------------------------
  -- 7. Reservation → completed
  ---------------------------------------------------------------------
  UPDATE public.admin_deal_reservations
     SET state='completed', order_id=v_order_id, completed_at=now()
   WHERE idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'payment_id', v_canonical_payment_id,
    'provider', v_provider,
    'is_ghost', v_is_ghost,
    'deal_only', v_deal_only,
    'source_amount', v_source_amount,
    'source_currency', v_source_currency,
    'recalc', v_recalc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_deal_from_payment(
  uuid, text, uuid, uuid, uuid, uuid, numeric, text,
  timestamptz, timestamptz, text, boolean, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_deal_from_payment(
  uuid, text, uuid, uuid, uuid, uuid, numeric, text,
  timestamptz, timestamptz, text, boolean, text, text
) TO service_role;