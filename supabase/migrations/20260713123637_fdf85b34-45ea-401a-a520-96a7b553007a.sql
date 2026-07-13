-- Stage 3R.2 — server-side guards for admin_create_manual_payment_v1
-- 1) order currency conflict when linked to existing order
-- 2) missing receiving_bank_name for provider=bank
-- 3) receiving_bank_name length cap (120 chars)

CREATE OR REPLACE FUNCTION public.admin_create_manual_payment_v1(
  p_actor_user_id          uuid,
  p_provider               text,
  p_amount                 numeric,
  p_currency               text,
  p_paid_at                timestamptz,
  p_profile_id             uuid,
  p_related_order_id       uuid,
  p_receiving_bank_name    text,
  p_comment                text,
  p_contact_name_snapshot  text,
  p_order_number_snapshot  text,
  p_idempotency_key        text,
  p_request_hash           text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currencies         text[] := ARRAY['BYN','RUB','USD','EUR','KZT','UAH','PLN'];
  v_providers          text[] := ARRAY['bepaid','stripe','rr','bank'];
  v_currency_u         text;
  v_provider_l         text;
  v_existing_id        uuid;
  v_existing_hash      text;
  v_existing_amount    numeric;
  v_existing_currency  text;
  v_existing_provider  text;
  v_existing_paid_at   timestamptz;
  v_existing_order_id  uuid;
  v_new_id             uuid;
  v_profile_user_id    uuid;
  v_effective_profile  uuid;
  v_effective_user     uuid;
  v_order_profile_id   uuid;
  v_order_number       text;
  v_order_currency     text;
  v_recv_bank          text;
  v_meta               jsonb;
  v_recalc             jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_idempotency_key');
  END IF;
  IF p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_request_hash');
  END IF;
  v_provider_l := lower(coalesce(p_provider,''));
  IF NOT (v_provider_l = ANY(v_providers)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider');
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  v_currency_u := upper(coalesce(p_currency,''));
  IF NOT (v_currency_u = ANY(v_currencies)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_currency');
  END IF;
  IF p_paid_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_paid_at');
  END IF;

  -- Receiving bank name only for provider='bank', REQUIRED, capped at 120 chars.
  IF v_provider_l = 'bank' THEN
    v_recv_bank := nullif(trim(coalesce(p_receiving_bank_name,'')), '');
    IF v_recv_bank IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'missing_receiving_bank_name');
    END IF;
    IF length(v_recv_bank) > 120 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'receiving_bank_name_too_long');
    END IF;
  ELSE
    v_recv_bank := NULL;
  END IF;

  v_effective_profile := p_profile_id;

  IF v_effective_profile IS NOT NULL THEN
    SELECT user_id INTO v_profile_user_id
      FROM public.profiles
     WHERE id = v_effective_profile;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'profile_not_found');
    END IF;
  END IF;

  -- Mode C: existing order attached — lock, validate profile AND currency
  IF p_related_order_id IS NOT NULL THEN
    SELECT profile_id, order_number, currency
      INTO v_order_profile_id, v_order_number, v_order_currency
      FROM public.orders_v2
     WHERE id = p_related_order_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
    END IF;

    IF v_effective_profile IS NULL THEN
      v_effective_profile := v_order_profile_id;
      IF v_effective_profile IS NOT NULL THEN
        SELECT user_id INTO v_profile_user_id
          FROM public.profiles WHERE id = v_effective_profile;
      END IF;
    ELSIF v_order_profile_id IS DISTINCT FROM v_effective_profile THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'order_profile_conflict',
        'order_profile_id', v_order_profile_id,
        'selected_profile_id', v_effective_profile
      );
    END IF;

    IF v_order_currency IS NOT NULL
       AND upper(v_order_currency) IS DISTINCT FROM v_currency_u THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'order_currency_conflict',
        'order_currency', upper(v_order_currency),
        'payment_currency', v_currency_u
      );
    END IF;
  END IF;

  v_effective_user := v_profile_user_id;

  v_meta := jsonb_build_object(
    'source', 'admin_manual',
    'created_by', p_actor_user_id,
    'idempotency_key', p_idempotency_key,
    'request_hash', p_request_hash,
    'manual_details', jsonb_strip_nulls(jsonb_build_object(
      'receiving_bank_name', v_recv_bank,
      'comment', nullif(trim(coalesce(p_comment,'')), ''),
      'contact_name_snapshot', nullif(trim(coalesce(p_contact_name_snapshot,'')), ''),
      'order_number_snapshot',
        coalesce(nullif(trim(coalesce(p_order_number_snapshot,'')), ''), v_order_number),
      'related_order_id', p_related_order_id
    ))
  );

  INSERT INTO public.payments_v2 (
    order_id, user_id, profile_id, amount, currency,
    status, provider, origin, paid_at, meta, transaction_type
  ) VALUES (
    p_related_order_id,
    v_effective_user,
    v_effective_profile,
    p_amount,
    v_currency_u,
    'succeeded',
    v_provider_l,
    'manual_admin',
    p_paid_at,
    v_meta,
    'payment'
  )
  ON CONFLICT ((meta->>'idempotency_key'))
    WHERE origin = 'manual_admin' AND coalesce(is_deleted,false) = false
  DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    IF p_related_order_id IS NOT NULL THEN
      v_recalc := public.recalc_order_totals(
        p_related_order_id, 'payment_added', v_new_id
      );
      IF v_recalc IS NULL OR (v_recalc->>'ok')::boolean IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'manual_payment_recalc_failed: %', coalesce(v_recalc::text,'null');
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', false,
      'payment_id', v_new_id,
      'provider', v_provider_l,
      'amount', p_amount,
      'currency', v_currency_u,
      'paid_at', p_paid_at,
      'order_id', p_related_order_id,
      'profile_id', v_effective_profile,
      'origin', 'manual_admin',
      'recalc', v_recalc
    );
  END IF;

  SELECT id, meta->>'request_hash', amount, currency, provider, paid_at, order_id
    INTO v_existing_id, v_existing_hash, v_existing_amount, v_existing_currency,
         v_existing_provider, v_existing_paid_at, v_existing_order_id
    FROM public.payments_v2
   WHERE origin = 'manual_admin'
     AND coalesce(is_deleted,false) = false
     AND meta->>'idempotency_key' = p_idempotency_key
   LIMIT 1;

  IF v_existing_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_race');
  END IF;

  IF v_existing_hash IS DISTINCT FROM p_request_hash THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'idempotency_conflict',
      'existing_payment_id', v_existing_id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', true,
    'payment_id', v_existing_id,
    'provider', v_existing_provider,
    'amount', v_existing_amount,
    'currency', v_existing_currency,
    'paid_at', v_existing_paid_at,
    'order_id', v_existing_order_id,
    'origin', 'manual_admin'
  );
END;
$$;

COMMENT ON FUNCTION public.admin_create_manual_payment_v1(
  uuid, text, numeric, text, timestamptz, uuid, uuid, text, text, text, text, text, text
) IS
'Stage 3R.2: adds server-side guards — order_currency_conflict, missing_receiving_bank_name, receiving_bank_name_too_long (>120).';