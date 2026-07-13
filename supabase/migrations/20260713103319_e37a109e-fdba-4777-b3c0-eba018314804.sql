-- =====================================================================
-- Stage 2R.1 — atomic reservation + currency fail-closed + search_path hardening
-- =====================================================================

DROP FUNCTION IF EXISTS public.admin_create_deal_from_payment(
  uuid, text, uuid, uuid, uuid, uuid, numeric, text,
  timestamptz, timestamptz, text, boolean, text, text
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_provider           text;
  v_status_raw         text;
  v_status_normalized  text;
  v_source_amount      numeric;
  v_source_currency    text;
  v_matched_order_id   uuid;
  v_existing_canonical uuid;
  v_profile_user_id    uuid;
  v_is_ghost           boolean;
  v_deal_only          boolean;
  v_product_active     boolean;
  v_tariff_product     uuid;
  v_order_id           uuid;
  v_order_number       text;
  v_canonical_payment_id uuid;
  v_recalc             jsonb;
  v_reservation        public.admin_deal_reservations%ROWTYPE;
  v_inserted_key       text;
  v_final_currency     text;
  v_source_currency_u  text;
  v_currencies         text[] := ARRAY['BYN','RUB','USD','EUR','KZT','UAH','PLN'];
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
  -- request_hash must be a lowercase SHA-256 (64 hex chars)
  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request_hash');
  END IF;
  IF p_final_amount IS NULL OR p_final_amount < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  v_final_currency := upper(coalesce(p_final_currency,''));
  IF NOT (v_final_currency = ANY(v_currencies)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_currency');
  END IF;
  IF p_access_start IS NULL OR p_access_end IS NULL OR p_access_start > p_access_end THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_access_range');
  END IF;

  ---------------------------------------------------------------------
  -- 1. Reservation-first idempotency (ATOMIC via ON CONFLICT DO NOTHING)
  ---------------------------------------------------------------------
  INSERT INTO public.admin_deal_reservations
    (idempotency_key, source, source_row_id, request_hash, state, created_by)
  VALUES
    (p_idempotency_key, p_raw_source, p_payment_id, p_request_hash, 'processing', p_actor_user_id)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING idempotency_key INTO v_inserted_key;

  IF v_inserted_key IS NULL THEN
    -- Row already exists under this idempotency_key. Lock and classify.
    SELECT * INTO v_reservation
      FROM public.admin_deal_reservations
     WHERE idempotency_key = p_idempotency_key
     FOR UPDATE;

    IF NOT FOUND THEN
      -- Race edge case: row deleted between conflict and select. Retry insert once.
      INSERT INTO public.admin_deal_reservations
        (idempotency_key, source, source_row_id, request_hash, state, created_by)
      VALUES
        (p_idempotency_key, p_raw_source, p_payment_id, p_request_hash, 'processing', p_actor_user_id);
    ELSE
      IF v_reservation.request_hash <> p_request_hash THEN
        RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict',
                                  'existing_hash', v_reservation.request_hash);
      END IF;
      IF v_reservation.source <> p_raw_source OR v_reservation.source_row_id <> p_payment_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'idempotency_conflict',
                                  'reason', 'source_mismatch');
      END IF;
      IF v_reservation.state = 'completed' AND v_reservation.order_id IS NOT NULL THEN
        -- Replay: возврат существующего результата с полными полями (для audit/UI)
        DECLARE
          v_row_provider text;
          v_row_amount   numeric;
          v_row_currency text;
          v_row_payment  uuid;
          v_row_isghost  boolean;
          v_row_dealonly boolean;
        BEGIN
          SELECT lower(coalesce(p2.provider,'')), p2.amount, upper(coalesce(p2.currency,'')),
                 p2.id,
                 coalesce((o.meta->>'is_ghost')::boolean, false),
                 coalesce((o.meta->>'deal_only')::boolean, false)
            INTO v_row_provider, v_row_amount, v_row_currency, v_row_payment,
                 v_row_isghost, v_row_dealonly
            FROM public.orders_v2 o
            LEFT JOIN public.payments_v2 p2 ON p2.order_id = o.id AND coalesce(p2.is_deleted,false)=false
           WHERE o.id = v_reservation.order_id
           LIMIT 1;

          RETURN jsonb_build_object(
            'ok', true, 'idempotent_replay', true,
            'order_id', v_reservation.order_id,
            'reservation_state', 'completed',
            'payment_id', v_row_payment,
            'provider', v_row_provider,
            'is_ghost', v_row_isghost,
            'deal_only', v_row_dealonly,
            'source_amount', v_row_amount,
            'source_currency', v_row_currency
          );
        END;
      ELSIF v_reservation.state = 'processing' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'reservation_processing');
      ELSIF v_reservation.state = 'failed' THEN
        UPDATE public.admin_deal_reservations
           SET state = 'processing', error_code = NULL, completed_at = NULL
         WHERE idempotency_key = p_idempotency_key;
      END IF;
    END IF;
  END IF;

  -- Проверка "same source row занят другим ключом"
  -- (partial unique index на (source, source_row_id) WHERE state IN ('processing','completed'))
  -- INSERT выше уже прошёл под нашим idempotency_key, поэтому conflict on source_row
  -- невозможен на этой стадии. Явная проверка на случай, если UI сгенерировал новый ключ:
  IF EXISTS (
    SELECT 1 FROM public.admin_deal_reservations
     WHERE source = p_raw_source
       AND source_row_id = p_payment_id
       AND idempotency_key <> p_idempotency_key
       AND state IN ('processing','completed')
  ) THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='source_already_reserved', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'source_already_reserved');
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

  IF v_matched_order_id IS NOT NULL THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='payment_already_linked', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'payment_already_linked',
                              'existing_order_id', v_matched_order_id);
  END IF;

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
  -- 2b. FAIL-CLOSED currency & amount validation on source
  ---------------------------------------------------------------------
  IF v_source_amount IS NULL OR v_source_amount <= 0 THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='invalid_source_amount', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_source_amount',
                              'source_amount', v_source_amount);
  END IF;

  v_source_currency_u := upper(coalesce(v_source_currency,''));
  IF v_source_currency_u = '' OR NOT (v_source_currency_u = ANY(v_currencies)) THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='invalid_source_currency', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_source_currency',
                              'source_currency', v_source_currency);
  END IF;

  IF v_source_currency_u <> v_final_currency THEN
    UPDATE public.admin_deal_reservations
       SET state='failed', error_code='currency_conflict', completed_at=now()
     WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('ok', false, 'error', 'currency_conflict',
                              'source_currency', v_source_currency_u,
                              'order_currency', v_final_currency);
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
    v_final_currency,
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
  -- 5. Canonical payment: amount/currency ИЗ ИСТОЧНИКА (currency уже == order)
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
      v_source_currency_u,
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
    'source_currency', v_source_currency_u,
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