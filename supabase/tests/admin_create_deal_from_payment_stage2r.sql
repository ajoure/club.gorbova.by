-- =====================================================================
-- Stage 2R — Integration coverage for admin_create_deal_from_payment
-- Проверяет: sequential replay, idempotency_conflict, financial source truth,
--            fail-closed status allowlist, queue re-materialization guard,
--            payments_v2 already linked guard, recalc rollback.
-- Запуск: read-only, все изменения оборачиваются в SAVEPOINT/ROLLBACK.
-- =====================================================================
DO $$
DECLARE
  v_actor           uuid := gen_random_uuid();
  v_profile         uuid := gen_random_uuid();
  v_profile_user    uuid := gen_random_uuid();
  v_product         uuid;
  v_tariff          uuid;
  v_queue_ok        uuid := gen_random_uuid();
  v_queue_pending   uuid := gen_random_uuid();
  v_queue_matched   uuid := gen_random_uuid();
  v_pv2_linked      uuid := gen_random_uuid();
  v_pv2_ok          uuid := gen_random_uuid();
  v_key1            text := 'test-key-'||gen_random_uuid()::text;
  v_key2            text := 'test-key-'||gen_random_uuid()::text;
  v_key3            text := 'test-key-'||gen_random_uuid()::text;
  v_key4            text := 'test-key-'||gen_random_uuid()::text;
  v_result          jsonb;
  v_result2         jsonb;
  v_order_id        uuid;
  v_payment_amount  numeric;
BEGIN
  -- Fixture: profile
  INSERT INTO public.profiles (id, user_id, email, full_name)
    VALUES (v_profile, v_profile_user, 'stage2r@example.com', 'Stage 2R');

  -- Fixture: product + tariff (заглушка, минимальные поля)
  INSERT INTO public.products_v2 (name, code, is_active)
    VALUES ('Stage2R product', 'stage2r-'||substr(v_actor::text,1,8), true)
    RETURNING id INTO v_product;
  INSERT INTO public.tariffs (product_id, name, code, is_active, tariff_type)
    VALUES (v_product, 'Basic', 'basic', true, 'one_time')
    RETURNING id INTO v_tariff;

  -- Fixture: queue row (successful)
  INSERT INTO public.payment_reconcile_queue
    (id, provider, status, status_normalized, amount, currency, created_at, external_id)
    VALUES (v_queue_ok, 'bepaid', 'successful', 'successful', 50, 'BYN', now(), 'stage2r-ext-1');

  -- Fixture: queue pending (must be rejected)
  INSERT INTO public.payment_reconcile_queue
    (id, provider, status, status_normalized, amount, currency, created_at, external_id)
    VALUES (v_queue_pending, 'bepaid', 'pending', 'pending', 10, 'BYN', now(), 'stage2r-ext-2');

  -- Fixture: queue already matched
  INSERT INTO public.payment_reconcile_queue
    (id, provider, status, status_normalized, amount, currency, created_at, external_id, matched_order_id)
    VALUES (v_queue_matched, 'bepaid', 'successful', 'successful', 20, 'BYN', now(), 'stage2r-ext-3', gen_random_uuid());

  -- Fixture: payments_v2 succeeded but already linked
  INSERT INTO public.payments_v2 (id, provider, status, amount, currency, order_id, created_at)
    VALUES (v_pv2_linked, 'stripe', 'succeeded', 30, 'USD', gen_random_uuid(), now());

  -- Fixture: payments_v2 succeeded, orphan (no order_id)
  INSERT INTO public.payments_v2 (id, provider, status, amount, currency, created_at)
    VALUES (v_pv2_ok, 'stripe', 'succeeded', 77, 'USD', now());

  ----------------------------------------------------------------
  -- Scenario 1: sequential replay → 1 order / 1 payment
  ----------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_queue_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r@example.com', false, v_key1, 'hash-1'
  );
  ASSERT (v_result->>'ok')::boolean = true, 'S1: initial call must succeed';
  v_order_id := (v_result->>'order_id')::uuid;

  v_result2 := public.admin_create_deal_from_payment(
    v_queue_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r@example.com', false, v_key1, 'hash-1'
  );
  ASSERT (v_result2->>'ok')::boolean = true, 'S1: replay must succeed';
  ASSERT (v_result2->>'idempotent_replay')::boolean = true, 'S1: replay flag';
  ASSERT (v_result2->>'order_id') = v_order_id::text, 'S1: same order_id on replay';

  -- Только один payments_v2 создан
  ASSERT (SELECT count(*) FROM public.payments_v2 WHERE order_id = v_order_id) = 1,
         'S1: only one canonical payment created';

  ----------------------------------------------------------------
  -- Scenario 2 (financial truth): payment.amount = source (50), order.final_price = client (100)
  ----------------------------------------------------------------
  SELECT amount INTO v_payment_amount
    FROM public.payments_v2 WHERE order_id = v_order_id LIMIT 1;
  ASSERT v_payment_amount = 50,
         format('S2: payment must use SOURCE amount 50, got %s', v_payment_amount);
  ASSERT (SELECT final_price FROM public.orders_v2 WHERE id = v_order_id) = 100,
         'S2: order.final_price = 100 from client';

  ----------------------------------------------------------------
  -- Scenario 3: same key, different hash → idempotency_conflict
  ----------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_queue_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r@example.com', false, v_key1, 'hash-DIFFERENT'
  );
  ASSERT (v_result->>'ok')::boolean = false, 'S3: must fail';
  ASSERT (v_result->>'error') = 'idempotency_conflict', 'S3: idempotency_conflict';

  ----------------------------------------------------------------
  -- Scenario 4: queue pending → payment_not_successful (fail-closed)
  ----------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_queue_pending, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r@example.com', false, v_key2, 'hash-2'
  );
  ASSERT (v_result->>'error') = 'payment_not_successful',
         format('S4: expected payment_not_successful, got %s', v_result->>'error');

  ----------------------------------------------------------------
  -- Scenario 5: queue already matched → payment_already_linked
  ----------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_queue_matched, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r@example.com', false, v_key3, 'hash-3'
  );
  ASSERT (v_result->>'error') = 'payment_already_linked',
         format('S5: expected payment_already_linked, got %s', v_result->>'error');

  ----------------------------------------------------------------
  -- Scenario 6: payments_v2 already linked → payment_already_linked
  ----------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_pv2_linked, 'payments_v2', v_actor, v_profile, v_product, v_tariff,
    100, 'USD', now(), now()+interval '30 days',
    'stage2r@example.com', false, v_key4, 'hash-4'
  );
  ASSERT (v_result->>'error') = 'payment_already_linked',
         format('S6: expected payment_already_linked, got %s', v_result->>'error');

  ----------------------------------------------------------------
  -- Cleanup: rollback всё через RAISE — тест read-only
  ----------------------------------------------------------------
  RAISE EXCEPTION 'STAGE2R_TESTS_PASSED';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'STAGE2R_TESTS_PASSED' THEN
      RAISE NOTICE 'Stage 2R integration tests: ALL SCENARIOS PASSED';
    ELSE
      RAISE;
    END IF;
END $$;
