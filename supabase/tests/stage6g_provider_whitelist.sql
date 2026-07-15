-- ============================================================
-- Stage 6.G — provider whitelist trigger regression tests
-- ROLLBACK-wrapped: не оставляет побочных эффектов.
--
-- Триггер: trg_payments_v2_provider_whitelist
-- Функция: public.tg_payments_v2_provider_whitelist()
-- Whitelist: bepaid|stripe|rr|bank
--
-- Runtime-эквивалент этих тестов уже выполнен 2026-07-15 через
-- edge-tool insert (см. .lovable/discovery/stage6_sprint_closeout.md).
-- Этот файл — для локальной регрессии и CI.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_fixture_id uuid := 'c6c6c6c6-6666-6666-6666-c6c6c6c6c6c6';
  v_thrown text;
BEGIN
  -- T1: INSERT provider='bepaid' → OK
  INSERT INTO public.payments_v2 (id, provider, amount, currency, status, is_deleted)
  VALUES (v_fixture_id, 'bepaid', 0.01, 'BYN', 'pending', false);
  ASSERT (SELECT provider FROM public.payments_v2 WHERE id=v_fixture_id) = 'bepaid',
    'T1 failed: bepaid insert not applied';

  -- T2: INSERT provider='admin' → EXCEPTION
  BEGIN
    INSERT INTO public.payments_v2 (provider, amount) VALUES ('admin', 0.01);
    RAISE EXCEPTION 'T2 failed: admin insert was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_thrown = MESSAGE_TEXT;
    ASSERT v_thrown LIKE 'stage6g_provider_not_allowed%', 'T2 wrong error: '||v_thrown;
  END;

  -- T3: INSERT provider='admin_test' → EXCEPTION
  BEGIN
    INSERT INTO public.payments_v2 (provider, amount) VALUES ('admin_test', 0.01);
    RAISE EXCEPTION 'T3 failed: admin_test insert was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- T4: INSERT provider='bank_transfer' → EXCEPTION
  BEGIN
    INSERT INTO public.payments_v2 (provider, amount) VALUES ('bank_transfer', 0.01);
    RAISE EXCEPTION 'T4 failed: bank_transfer insert was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- T5: UPDATE meta (не provider) → OK
  UPDATE public.payments_v2
     SET meta = coalesce(meta,'{}'::jsonb) || '{"stage6g_test":true}'::jsonb
   WHERE id = v_fixture_id;
  ASSERT (SELECT meta->>'stage6g_test' FROM public.payments_v2 WHERE id=v_fixture_id) = 'true',
    'T5 failed: meta update rejected';

  -- T6: UPDATE provider='bepaid' на 'bepaid' (не меняется) → OK
  UPDATE public.payments_v2 SET provider='bepaid' WHERE id=v_fixture_id;

  -- T7: UPDATE provider на другой whitelist ('bank') → OK
  UPDATE public.payments_v2 SET provider='bank' WHERE id=v_fixture_id;
  ASSERT (SELECT provider FROM public.payments_v2 WHERE id=v_fixture_id) = 'bank',
    'T7 failed: whitelist→whitelist update rejected';

  -- T8: UPDATE provider вне whitelist → EXCEPTION
  BEGIN
    UPDATE public.payments_v2 SET provider='admin' WHERE id=v_fixture_id;
    RAISE EXCEPTION 'T8 failed: provider→admin update was accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_thrown = MESSAGE_TEXT;
    ASSERT v_thrown LIKE 'stage6g_provider_update_not_allowed%', 'T8 wrong error: '||v_thrown;
  END;

  -- T9: UPDATE provider на NULL → EXCEPTION (защита от 3VL)
  BEGIN
    UPDATE public.payments_v2 SET provider=NULL WHERE id=v_fixture_id;
    RAISE EXCEPTION 'T9 failed: provider→NULL update was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'Stage 6.G: все 9 тестов прошли';
END $$;

ROLLBACK;
