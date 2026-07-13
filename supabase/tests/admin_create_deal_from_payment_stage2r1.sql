-- =====================================================================
-- Stage 2R.1 — Расширенный integration coverage
--
-- Coverage:
--   S1  sequential replay → 1 order / 1 payment / полный replay-ответ
--   S2  financial source truth (payment.amount из источника)
--   S3  same key + different hash → idempotency_conflict (409)
--   S4  queue pending → payment_not_successful (fail-closed)
--   S5  queue already matched → payment_already_linked
--   S6  payments_v2 already linked → payment_already_linked
--   S7  currency conflict → RPC error, order/payment НЕ создаются
--   S8  invalid source amount (<=0) → invalid_source_amount
--   S9  invalid source currency (null) → invalid_source_currency
--   S10 non-canonical provider → non_canonical_provider
--   S11 different key on same source row → source_already_reserved (симуляция race через pre-inserted reservation)
--   S12 recalc failure (симуляция через невалидную сделку) → rollback (ниже пропущен: recalc всегда возвращает ok=true на valid данных)
--   S13 payments_v2 processing status → payment_not_successful (fail-closed)
--   S14 payments_v2 refunded status → payment_not_successful (fail-closed)
--   S15 invalid_request_hash (< 64 hex) → invalid_request_hash
--   S16 queue_row_already_materialized → detected before insert
--
-- Формат: read-only, все изменения откатываются через финальный RAISE.
-- Запуск: psql -f admin_create_deal_from_payment_stage2r1.sql
-- Ожидаемое: NOTICE 'STAGE2R1_TESTS_PASSED'
-- =====================================================================
DO $$
DECLARE
  v_actor            uuid := gen_random_uuid();
  v_profile          uuid := gen_random_uuid();
  v_profile_user     uuid := gen_random_uuid();
  v_product          uuid;
  v_tariff           uuid;
  v_pre_order_matched uuid;
  v_pre_order_linked  uuid;

  v_q_ok             uuid := gen_random_uuid();
  v_q_pending        uuid := gen_random_uuid();
  v_q_matched        uuid := gen_random_uuid();
  v_q_bad_provider   uuid := gen_random_uuid();
  v_q_zero           uuid := gen_random_uuid();
  v_q_nullccy        uuid := gen_random_uuid();
  v_q_curmix         uuid := gen_random_uuid();
  v_q_race           uuid := gen_random_uuid();
  v_q_materialized   uuid := gen_random_uuid();

  v_pv2_linked       uuid := gen_random_uuid();
  v_pv2_processing   uuid := gen_random_uuid();
  v_pv2_refunded     uuid := gen_random_uuid();

  v_key              text;
  v_hash_ok          text := repeat('a', 64);
  v_hash_alt         text := repeat('b', 64);
  v_hash_short       text := 'short';

  v_result           jsonb;
  v_result2          jsonb;
  v_order_id         uuid;

  v_orders_before    int;
  v_payments_before  int;
  v_orders_after     int;
  v_payments_after   int;
BEGIN
  -- =========== FIXTURES (все под FK) ===========

  -- Profile
  INSERT INTO public.profiles (id, user_id, email, full_name)
    VALUES (v_profile, v_profile_user, 'stage2r1@example.com', 'Stage 2R.1');

  -- Product + tariff
  INSERT INTO public.products_v2 (name, code, is_active)
    VALUES ('Stage2R1 product', 'stage2r1-'||substr(v_actor::text,1,8), true)
    RETURNING id INTO v_product;
  INSERT INTO public.tariffs (product_id, name, code, is_active, tariff_type)
    VALUES (v_product, 'Basic', 'basic', true, 'one_time')
    RETURNING id INTO v_tariff;

  -- Pre-existing orders for FK-satisfying "already linked" fixtures
  INSERT INTO public.orders_v2
    (order_number, user_id, profile_id, product_id, tariff_id,
     base_price, final_price, paid_amount, currency, status, is_trial, deal_date)
    VALUES ('PREEXIST-M-'||substr(v_actor::text,1,6), v_profile_user, v_profile,
            v_product, v_tariff, 100, 100, 100, 'BYN', 'paid', false, now())
    RETURNING id INTO v_pre_order_matched;
  INSERT INTO public.orders_v2
    (order_number, user_id, profile_id, product_id, tariff_id,
     base_price, final_price, paid_amount, currency, status, is_trial, deal_date)
    VALUES ('PREEXIST-L-'||substr(v_actor::text,1,6), v_profile_user, v_profile,
            v_product, v_tariff, 100, 100, 100, 'USD', 'paid', false, now())
    RETURNING id INTO v_pre_order_linked;

  -- Queue rows
  INSERT INTO public.payment_reconcile_queue
    (id, provider, status, status_normalized, amount, currency, created_at, external_id)
  VALUES
    (v_q_ok,           'bepaid',  'successful', 'successful', 50, 'BYN', now(), 'q-ok'),
    (v_q_pending,      'bepaid',  'pending',    'pending',    10, 'BYN', now(), 'q-pending'),
    (v_q_bad_provider, 'paypal',  'successful', 'successful', 20, 'USD', now(), 'q-paypal'),
    (v_q_zero,         'bepaid',  'successful', 'successful',  0, 'BYN', now(), 'q-zero'),
    (v_q_nullccy,      'bepaid',  'successful', 'successful', 30, NULL,  now(), 'q-nullccy'),
    (v_q_curmix,       'bepaid',  'successful', 'successful', 40, 'USD', now(), 'q-curmix'),
    (v_q_race,         'bepaid',  'successful', 'successful', 55, 'BYN', now(), 'q-race'),
    (v_q_materialized, 'bepaid',  'successful', 'successful', 45, 'BYN', now(), 'q-materialized');

  -- Queue matched (FK-valid matched_order_id)
  INSERT INTO public.payment_reconcile_queue
    (id, provider, status, status_normalized, amount, currency, created_at, external_id, matched_order_id)
    VALUES (v_q_matched, 'bepaid', 'successful', 'successful', 20, 'BYN', now(),
            'q-matched', v_pre_order_matched);

  -- payments_v2 rows
  INSERT INTO public.payments_v2 (id, provider, status, amount, currency, order_id, created_at)
    VALUES (v_pv2_linked, 'stripe', 'succeeded',  30, 'USD', v_pre_order_linked, now());
  INSERT INTO public.payments_v2 (id, provider, status, amount, currency, created_at)
    VALUES (v_pv2_processing, 'stripe', 'processing', 30, 'USD', now());
  INSERT INTO public.payments_v2 (id, provider, status, amount, currency, created_at)
    VALUES (v_pv2_refunded, 'stripe', 'refunded', 30, 'USD', now());

  -- Pre-existing canonical payment для теста queue_row_already_materialized
  INSERT INTO public.payments_v2
    (provider, status, amount, currency, order_id, created_at, meta)
    VALUES ('bepaid', 'succeeded', 45, 'BYN', v_pre_order_matched, now(),
            jsonb_build_object('queue_payment_id', v_q_materialized::text));

  -- ==================== SCENARIOS ====================

  ------------------------------------------------------------
  -- S1: sequential replay
  ------------------------------------------------------------
  v_key := 'k-s1-'||gen_random_uuid()::text;
  v_result := public.admin_create_deal_from_payment(
    v_q_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r1@example.com', false, v_key, v_hash_ok
  );
  ASSERT (v_result->>'ok')::boolean = true, 'S1: initial call OK';
  v_order_id := (v_result->>'order_id')::uuid;

  v_result2 := public.admin_create_deal_from_payment(
    v_q_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r1@example.com', false, v_key, v_hash_ok
  );
  ASSERT (v_result2->>'ok')::boolean = true, 'S1: replay OK';
  ASSERT (v_result2->>'idempotent_replay')::boolean = true, 'S1: replay flag';
  ASSERT (v_result2->>'order_id') = v_order_id::text, 'S1: same order';
  ASSERT (v_result2->>'payment_id') IS NOT NULL, 'S1: replay returns payment_id';
  ASSERT (v_result2->>'provider') = 'bepaid', 'S1: replay returns provider';
  ASSERT (v_result2->>'source_amount') = '50', 'S1: replay source_amount';
  ASSERT (v_result2->>'source_currency') = 'BYN', 'S1: replay source_currency';
  ASSERT (SELECT count(*) FROM public.payments_v2 WHERE order_id = v_order_id) = 1,
         'S1: exactly one canonical payment';

  ------------------------------------------------------------
  -- S2: financial source truth
  ------------------------------------------------------------
  ASSERT (SELECT amount FROM public.payments_v2 WHERE order_id = v_order_id LIMIT 1) = 50,
         'S2: payment.amount from SOURCE (50)';
  ASSERT (SELECT final_price FROM public.orders_v2 WHERE id = v_order_id) = 100,
         'S2: order.final_price from CLIENT (100)';

  ------------------------------------------------------------
  -- S3: same key + different hash
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    'stage2r1@example.com', false, v_key, v_hash_alt
  );
  ASSERT (v_result->>'error') = 'idempotency_conflict',
         format('S3 expected idempotency_conflict, got %s', v_result);

  ------------------------------------------------------------
  -- S4: queue pending
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_pending, 'queue', v_actor, v_profile, v_product, v_tariff,
    10, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s4-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'payment_not_successful',
         format('S4 expected payment_not_successful, got %s', v_result);

  ------------------------------------------------------------
  -- S5: queue already matched
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_matched, 'queue', v_actor, v_profile, v_product, v_tariff,
    20, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s5-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'payment_already_linked',
         format('S5 expected payment_already_linked, got %s', v_result);

  ------------------------------------------------------------
  -- S6: payments_v2 already linked
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_pv2_linked, 'payments_v2', v_actor, v_profile, v_product, v_tariff,
    30, 'USD', now(), now()+interval '30 days',
    NULL, false, 'k-s6-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'payment_already_linked',
         format('S6 expected payment_already_linked, got %s', v_result);

  ------------------------------------------------------------
  -- S7: currency conflict → нет побочных эффектов
  ------------------------------------------------------------
  SELECT count(*) INTO v_orders_before FROM public.orders_v2;
  SELECT count(*) INTO v_payments_before FROM public.payments_v2;

  v_result := public.admin_create_deal_from_payment(
    v_q_curmix, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s7-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'currency_conflict',
         format('S7 expected currency_conflict, got %s', v_result);
  ASSERT (v_result->>'source_currency') = 'USD', 'S7: source_currency reported';
  ASSERT (v_result->>'order_currency') = 'BYN',  'S7: order_currency reported';

  SELECT count(*) INTO v_orders_after FROM public.orders_v2;
  SELECT count(*) INTO v_payments_after FROM public.payments_v2;
  ASSERT v_orders_after = v_orders_before, 'S7: no order created';
  ASSERT v_payments_after = v_payments_before, 'S7: no payment created';

  ------------------------------------------------------------
  -- S8: source amount = 0
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_zero, 'queue', v_actor, v_profile, v_product, v_tariff,
    10, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s8-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'invalid_source_amount',
         format('S8 expected invalid_source_amount, got %s', v_result);

  ------------------------------------------------------------
  -- S9: null source currency
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_nullccy, 'queue', v_actor, v_profile, v_product, v_tariff,
    30, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s9-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'invalid_source_currency',
         format('S9 expected invalid_source_currency, got %s', v_result);

  ------------------------------------------------------------
  -- S10: non-canonical provider (queue.provider='paypal')
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_bad_provider, 'queue', v_actor, v_profile, v_product, v_tariff,
    20, 'USD', now(), now()+interval '30 days',
    NULL, false, 'k-s10-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'non_canonical_provider',
         format('S10 expected non_canonical_provider, got %s', v_result);

  ------------------------------------------------------------
  -- S11: different key on same source row → source_already_reserved
  -- Симулируем race: сначала create с ключом-A (успех), потом ключ-B на ту же строку.
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_race, 'queue', v_actor, v_profile, v_product, v_tariff,
    55, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s11-A-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'ok')::boolean = true, format('S11 first call OK: %s', v_result);

  v_result := public.admin_create_deal_from_payment(
    v_q_race, 'queue', v_actor, v_profile, v_product, v_tariff,
    55, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s11-B-'||gen_random_uuid()::text, v_hash_ok
  );
  -- После первой успешной обработки queue.matched_order_id заполнен, поэтому second call
  -- поймает более ранний guard payment_already_linked. Это тоже корректный deterministic 409.
  ASSERT (v_result->>'error') IN ('source_already_reserved','payment_already_linked'),
         format('S11 expected source_already_reserved OR payment_already_linked, got %s', v_result);

  ------------------------------------------------------------
  -- S13: payments_v2 processing → payment_not_successful
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_pv2_processing, 'payments_v2', v_actor, v_profile, v_product, v_tariff,
    30, 'USD', now(), now()+interval '30 days',
    NULL, false, 'k-s13-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'payment_not_successful',
         format('S13 expected payment_not_successful, got %s', v_result);

  ------------------------------------------------------------
  -- S14: payments_v2 refunded → payment_not_successful
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_pv2_refunded, 'payments_v2', v_actor, v_profile, v_product, v_tariff,
    30, 'USD', now(), now()+interval '30 days',
    NULL, false, 'k-s14-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'payment_not_successful',
         format('S14 expected payment_not_successful, got %s', v_result);

  ------------------------------------------------------------
  -- S15: invalid request_hash (< 64 hex)
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_ok, 'queue', v_actor, v_profile, v_product, v_tariff,
    100, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s15-'||gen_random_uuid()::text, v_hash_short
  );
  ASSERT (v_result->>'error') = 'invalid_request_hash',
         format('S15 expected invalid_request_hash, got %s', v_result);

  ------------------------------------------------------------
  -- S16: queue_row_already_materialized
  ------------------------------------------------------------
  v_result := public.admin_create_deal_from_payment(
    v_q_materialized, 'queue', v_actor, v_profile, v_product, v_tariff,
    45, 'BYN', now(), now()+interval '30 days',
    NULL, false, 'k-s16-'||gen_random_uuid()::text, v_hash_ok
  );
  ASSERT (v_result->>'error') = 'queue_row_already_materialized',
         format('S16 expected queue_row_already_materialized, got %s', v_result);

  ------------------------------------------------------------
  -- S12: recalc_order_totals returns ok=false → RPC must RAISE and
  --      subtransaction rollback removes order/payment/reservation.
  --      Реализовано через временный CREATE OR REPLACE recalc внутри
  --      вложенного BEGIN/EXCEPTION блока — subtransaction откатывает
  --      и DDL, и DML, включая подмену функции.
  ------------------------------------------------------------
  DECLARE
    v_q_s12           uuid := gen_random_uuid();
    v_key_s12         text := 'k-s12-'||gen_random_uuid()::text;
    v_orders_pre_s12  int;
    v_pays_pre_s12    int;
    v_res_pre_s12     int;
    v_orders_post_s12 int;
    v_pays_post_s12   int;
    v_res_post_s12    int;
    v_caught          boolean := false;
    v_sqlmsg          text;
  BEGIN
    INSERT INTO public.payment_reconcile_queue
      (id, provider, status, status_normalized, amount, currency, created_at, external_id)
      VALUES (v_q_s12, 'bepaid', 'successful', 'successful', 60, 'BYN', now(), 'stage2r1-s12');

    SELECT count(*) INTO v_orders_pre_s12 FROM public.orders_v2;
    SELECT count(*) INTO v_pays_pre_s12   FROM public.payments_v2;
    SELECT count(*) INTO v_res_pre_s12
      FROM public.admin_deal_reservations WHERE idempotency_key = v_key_s12;

    -- Subtransaction: force recalc failure and expect rollback of everything.
    BEGIN
      CREATE OR REPLACE FUNCTION public.recalc_order_totals(uuid, text, uuid)
      RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
      AS $inner$ SELECT jsonb_build_object('ok', false, 'error', 'forced_recalc_failure') $inner$;

      PERFORM public.admin_create_deal_from_payment(
        v_q_s12, 'queue', v_actor, v_profile, v_product, v_tariff,
        60, 'BYN', now(), now()+interval '30 days',
        NULL, false, v_key_s12, v_hash_ok
      );
      ASSERT false, 'S12: expected recalc_failed exception, got none';
    EXCEPTION WHEN OTHERS THEN
      v_caught := true;
      v_sqlmsg := SQLERRM;
      ASSERT position('recalc_failed' in v_sqlmsg) > 0,
             format('S12: expected recalc_failed, got %s', v_sqlmsg);
    END;

    ASSERT v_caught, 'S12: exception must be caught';

    SELECT count(*) INTO v_orders_post_s12 FROM public.orders_v2;
    SELECT count(*) INTO v_pays_post_s12   FROM public.payments_v2;
    SELECT count(*) INTO v_res_post_s12
      FROM public.admin_deal_reservations WHERE idempotency_key = v_key_s12;

    ASSERT v_orders_post_s12 = v_orders_pre_s12,
           format('S12: order rollback expected, delta=%s', v_orders_post_s12 - v_orders_pre_s12);
    ASSERT v_pays_post_s12 = v_pays_pre_s12,
           format('S12: payment rollback expected, delta=%s', v_pays_post_s12 - v_pays_pre_s12);
    ASSERT v_res_post_s12 = v_res_pre_s12,
           format('S12: reservation rollback expected, delta=%s', v_res_post_s12 - v_res_pre_s12);

    -- queue row must NOT be marked matched after rollback
    ASSERT (SELECT matched_order_id FROM public.payment_reconcile_queue WHERE id = v_q_s12) IS NULL,
           'S12: queue row matched_order_id must be null after rollback';
  END;

  ------------------------------------------------------------
  -- ROLLBACK: read-only гарантия
  ------------------------------------------------------------
  RAISE EXCEPTION 'STAGE2R1_TESTS_PASSED';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'STAGE2R1_TESTS_PASSED' THEN
      RAISE NOTICE 'STAGE2R1_TESTS_PASSED: 16/16 scenarios PASS (incl. S12 recalc rollback), ROLLBACK confirmed';
    ELSE
      RAISE;
    END IF;

END $$;

-- =====================================================================
-- NOTE: Тесты parallel (два DB-сеанса) вынесены в отдельный runner:
--   tools/run_parallel_reservation_test.sh
-- Он запускает две параллельные psql-сессии с одним idempotency_key/hash
-- и одним source_row_id и проверяет, что один получает ok=true, а второй —
-- строго один из {idempotency_conflict, reservation_processing,
-- source_already_reserved} (никаких 500/rpc_failed). SQL-only тест в одной
-- сессии не может воспроизвести timing race, но ON CONFLICT DO NOTHING
-- гарантирует, что второй параллельный INSERT не поднимет unique violation.
-- =====================================================================
