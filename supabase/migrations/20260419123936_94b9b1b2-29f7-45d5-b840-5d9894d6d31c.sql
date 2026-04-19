-- ============================================================
-- PATCH 1.1 — Migration 3: B1 partial UNIQUE для ManyChat ingress dedup
-- Способ: tool migration без CONCURRENTLY (fresh decision: 131 row, 136 kB).
-- НЕ перенос fallback Migration 2/2.1 — независимое решение по фактам.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_logs_ingress_idempotency
  ON public.integration_logs (
    instance_id,
    event_type,
    (payload_meta->>'idempotency_hash')
  )
  WHERE event_type = 'manychat.external_request'
    AND payload_meta ? 'idempotency_hash';

-- ============================================================
-- Verify 1: index inventory
-- ============================================================
DO $$
DECLARE
  has_idx boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public'
      AND indexname='uq_integration_logs_ingress_idempotency'
  ) INTO has_idx;

  IF NOT has_idx THEN
    RAISE EXCEPTION 'Migration 3 check failed: uq_integration_logs_ingress_idempotency missing';
  END IF;

  RAISE NOTICE 'Migration 3 inventory passed: B1 partial UNIQUE active';
END $$;

-- ============================================================
-- Verify 2: write-contract smoke (Smoke A + Smoke B)
-- result='success' — фактическое разрешённое значение (CHECK отсутствует,
-- в данных встречаются только 'success'/'error')
-- ============================================================
DO $$
DECLARE
  test_instance_id uuid;
  run_id text := 'smoke_3_' || replace(gen_random_uuid()::text, '-', '');
  smoke_a_failed_as_expected boolean := false;
  smoke_b_failed_unexpectedly boolean := false;
BEGIN
  SELECT instance_id INTO test_instance_id
  FROM public.integration_logs
  LIMIT 1;

  IF test_instance_id IS NULL THEN
    RAISE NOTICE 'Migration 3 smoke skipped: no existing instance_id for FK';
    RETURN;
  END IF;

  -- Smoke A: дубликат внутри manychat.external_request должен упасть
  INSERT INTO public.integration_logs
    (instance_id, event_type, result, payload_meta)
  VALUES
    (test_instance_id, 'manychat.external_request', 'success',
     jsonb_build_object('idempotency_hash', run_id || '_hash_1', 'smoke', 'A1'));

  BEGIN
    INSERT INTO public.integration_logs
      (instance_id, event_type, result, payload_meta)
    VALUES
      (test_instance_id, 'manychat.external_request', 'success',
       jsonb_build_object('idempotency_hash', run_id || '_hash_1', 'smoke', 'A2'));
  EXCEPTION WHEN unique_violation THEN
    smoke_a_failed_as_expected := true;
  END;

  IF NOT smoke_a_failed_as_expected THEN
    DELETE FROM public.integration_logs
    WHERE event_type IN ('manychat.external_request', 'apixdrive.test')
      AND payload_meta->>'idempotency_hash' LIKE run_id || '%';
    RAISE EXCEPTION 'write-contract drift: UNIQUE manychat ingress dedup not enforced';
  END IF;

  -- Smoke B: тот же hash, другой event_type — не должен конфликтовать
  INSERT INTO public.integration_logs
    (instance_id, event_type, result, payload_meta)
  VALUES
    (test_instance_id, 'apixdrive.test', 'success',
     jsonb_build_object('idempotency_hash', run_id || '_hash_1', 'smoke', 'B1'));

  BEGIN
    INSERT INTO public.integration_logs
      (instance_id, event_type, result, payload_meta)
    VALUES
      (test_instance_id, 'apixdrive.test', 'success',
       jsonb_build_object('idempotency_hash', run_id || '_hash_1', 'smoke', 'B2'));
  EXCEPTION WHEN unique_violation THEN
    smoke_b_failed_unexpectedly := true;
  END;

  -- Cleanup safe: scoped по run_id
  DELETE FROM public.integration_logs
  WHERE event_type IN ('manychat.external_request', 'apixdrive.test')
    AND payload_meta->>'idempotency_hash' LIKE run_id || '%';

  IF smoke_b_failed_unexpectedly THEN
    RAISE EXCEPTION 'write-contract drift: index leaks beyond manychat.external_request';
  END IF;

  RAISE NOTICE 'Migration 3 write-contract smoke passed (run_id=%): Smoke A enforced, Smoke B isolated', run_id;
END $$;