-- Stage 2: admin_create_deal_from_payment
-- Атомарное создание сделки из платежа с reservation-first идемпотентностью.
-- Провайдер выводится СЕРВЕРНО из источника платежа (queue.provider или payments_v2.provider).
-- Никаких клиентских provider='admin' записей.

CREATE OR REPLACE FUNCTION public.admin_create_deal_from_payment(
  p_payment_id uuid,
  p_raw_source text,           -- 'queue' | 'payments_v2'
  p_actor_user_id uuid,
  p_profile_id uuid,
  p_contact_user_id uuid,      -- user_id заказа (для ghost = profile_id)
  p_product_id uuid,
  p_tariff_id uuid,
  p_final_amount numeric,
  p_final_currency text,
  p_access_start timestamptz,
  p_access_end timestamptz,
  p_customer_email text,
  p_deal_only boolean,
  p_idempotency_key text,
  p_is_ghost boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider text;
  v_status text;
  v_source_amount numeric;
  v_source_currency text;
  v_existing_order_id uuid;
  v_existing_order_number text;
  v_order_id uuid;
  v_order_number text;
  v_canonical_payment_id uuid;
  v_recalc jsonb;
  v_canonical_providers text[] := ARRAY['bepaid','stripe','rr','bank'];
  v_failed_statuses text[] := ARRAY['failed','declined','error','cancelled','expired','incomplete'];
BEGIN
  -- 0. Basic validation
  IF p_raw_source NOT IN ('queue','payments_v2') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_raw_source');
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_idempotency_key');
  END IF;

  -- 1. Reservation-first idempotency: если такой ключ уже создал ордер — вернуть его
  SELECT id, order_number
    INTO v_existing_order_id, v_existing_order_number
    FROM public.orders_v2
   WHERE meta->>'idempotency_key' = p_idempotency_key
   LIMIT 1;

  IF v_existing_order_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent_replay', true,
      'order_id', v_existing_order_id,
      'order_number', v_existing_order_number,
      'payment_id', p_payment_id
    );
  END IF;

  -- 2. Lock source payment row FOR UPDATE и вывести canonical provider
  IF p_raw_source = 'queue' THEN
    SELECT lower(coalesce(provider,'')), lower(coalesce(status,'')), amount, currency
      INTO v_provider, v_status, v_source_amount, v_source_currency
      FROM public.payment_reconcile_queue
     WHERE id = p_payment_id
     FOR UPDATE;
  ELSE
    SELECT lower(coalesce(provider,'')), lower(coalesce(status::text,'')), amount, currency
      INTO v_provider, v_status, v_source_amount, v_source_currency
      FROM public.payments_v2
     WHERE id = p_payment_id
       AND coalesce(is_deleted, false) = false
       AND deleted_at IS NULL
     FOR UPDATE;
  END IF;

  IF v_provider IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_found');
  END IF;

  IF v_status = ANY(v_failed_statuses) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_not_successful', 'status', v_status);
  END IF;

  IF NOT (v_provider = ANY(v_canonical_providers)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'non_canonical_provider', 'provider', v_provider);
  END IF;

  -- 3. Guard: payments_v2 row не должен быть уже привязан к другой сделке
  IF p_raw_source = 'payments_v2' THEN
    PERFORM 1 FROM public.payments_v2
      WHERE id = p_payment_id AND order_id IS NOT NULL;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_already_linked');
    END IF;
  END IF;

  -- 4. Generate order number
  v_order_number := 'PAY-' || to_char(now(), 'YY') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  -- 5. Insert order (paid_amount=0; будет пересчитан recalc)
  INSERT INTO public.orders_v2 (
    order_number, user_id, profile_id, product_id, tariff_id,
    customer_email, base_price, final_price, paid_amount, currency,
    status, is_trial, created_at, deal_date, meta
  ) VALUES (
    v_order_number,
    p_contact_user_id,
    p_profile_id,
    p_product_id,
    p_tariff_id,
    p_customer_email,
    p_final_amount,
    p_final_amount,
    0,
    p_final_currency,
    'pending',
    false,
    p_access_start,
    p_access_start,
    jsonb_build_object(
      'source', 'admin_from_payment',
      'created_by', p_actor_user_id,
      'payment_id', p_payment_id,
      'payment_source', p_raw_source,
      'is_ghost', p_is_ghost,
      'deal_only', p_deal_only,
      'idempotency_key', p_idempotency_key,
      'access_start', p_access_start,
      'access_end', p_access_end
    )
  )
  RETURNING id INTO v_order_id;

  -- 6. Привязать/создать canonical payment
  IF p_raw_source = 'queue' THEN
    -- канонический платёж в payments_v2 с provider из очереди
    INSERT INTO public.payments_v2 (
      order_id, user_id, profile_id, amount, currency, status, provider,
      paid_at, created_at, meta
    ) VALUES (
      v_order_id,
      p_contact_user_id,
      p_profile_id,
      p_final_amount,
      p_final_currency,
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
           user_id = p_contact_user_id
     WHERE id = p_payment_id;
    v_canonical_payment_id := p_payment_id;
  END IF;

  -- 7. Reason-aware recalc
  v_recalc := public.recalc_order_totals(v_order_id, 'payment_added', v_canonical_payment_id);

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent_replay', false,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'payment_id', v_canonical_payment_id,
    'provider', v_provider,
    'recalc', v_recalc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_deal_from_payment(uuid,text,uuid,uuid,uuid,uuid,uuid,numeric,text,timestamptz,timestamptz,text,boolean,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_deal_from_payment(uuid,text,uuid,uuid,uuid,uuid,uuid,numeric,text,timestamptz,timestamptz,text,boolean,text,boolean) TO service_role;

-- Idempotency index (partial: только когда ключ есть)
CREATE INDEX IF NOT EXISTS idx_orders_v2_idempotency_key
  ON public.orders_v2 ((meta->>'idempotency_key'))
  WHERE meta ? 'idempotency_key';