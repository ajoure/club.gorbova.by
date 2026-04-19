-- ============================================================
-- PATCH 1.1 — Migration 2.1: drift correction
-- Fallback A (без CONCURRENTLY) как локальное исключение,
-- по тем же причинам, что и Migration 2:
--   - migration tool transaction wrapper
--   - direct PG exec без ownership
--   - маленький объём таблицы (29 строк)
-- Короткая блокировка, допустимая на текущем объёме и в low-risk window.
-- ============================================================

-- DROP scope-creep индекса (не было в плане A3)
DROP INDEX IF EXISTS public.idx_ig_msg_manychat_provider;

-- DROP UNIQUE на idempotency_hash (план требовал INDEX, не UNIQUE)
DROP INDEX IF EXISTS public.uq_ig_msg_provider_idempotency;

-- Recreate idempotency_hash как обычный partial INDEX (per plan A3)
CREATE INDEX IF NOT EXISTS idx_ig_msg_idempotency_hash
  ON public.instagram_messages (instagram_account_id, provider_kind, idempotency_hash)
  WHERE idempotency_hash IS NOT NULL;

-- ADD missing UNIQUE по provider_message_id (per plan A3, primary ingress idempotency)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_msg_provider_message_id
  ON public.instagram_messages (instagram_account_id, provider_kind, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ============================================================
-- Verify 1: index inventory
-- ============================================================
DO $$
DECLARE
  has_drop1 boolean; has_drop2 boolean;
  has_idem boolean; has_pmid boolean; has_thread boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ig_msg_manychat_provider') INTO has_drop1;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_ig_msg_provider_idempotency') INTO has_drop2;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ig_msg_idempotency_hash') INTO has_idem;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_ig_msg_provider_message_id') INTO has_pmid;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_ig_msg_thread_key') INTO has_thread;

  IF has_drop1 THEN RAISE EXCEPTION 'drift: idx_ig_msg_manychat_provider still exists'; END IF;
  IF has_drop2 THEN RAISE EXCEPTION 'drift: uq_ig_msg_provider_idempotency still exists'; END IF;
  IF NOT has_idem THEN RAISE EXCEPTION 'missing: idx_ig_msg_idempotency_hash'; END IF;
  IF NOT has_pmid THEN RAISE EXCEPTION 'missing: uq_ig_msg_provider_message_id'; END IF;
  IF NOT has_thread THEN RAISE EXCEPTION 'missing: idx_ig_msg_thread_key'; END IF;

  RAISE NOTICE 'Migration 2.1 inventory passed: 3 plan-aligned indexes active';
END $$;

-- ============================================================
-- Verify 2: write-contract smoke (Smoke A + Smoke B)
-- subtransaction (BEGIN ... EXCEPTION) внутри DO $$ + явная очистка по run-id
-- Реальные NOT NULL колонки instagram_messages (без default):
--   instagram_account_id, sender_id, direction, peer_id
-- ============================================================
DO $$
DECLARE
  test_account_id uuid;
  run_id text := 'smoke_2_1_' || replace(gen_random_uuid()::text, '-', '');
  smoke_a_failed_as_expected boolean := false;
  smoke_b_failed_unexpectedly boolean := false;
BEGIN
  SELECT instagram_account_id INTO test_account_id
  FROM public.instagram_messages
  LIMIT 1;

  IF test_account_id IS NULL THEN
    RAISE NOTICE 'Migration 2.1 smoke skipped: no existing account_id for FK';
    RETURN;
  END IF;

  -- Smoke A: UNIQUE provider_message_id должен enforced
  INSERT INTO public.instagram_messages
    (instagram_account_id, sender_id, peer_id, direction,
     provider_kind, provider_message_id, idempotency_hash, message_text)
  VALUES
    (test_account_id, 'smoke_sender', 'smoke_peer', 'inbound',
     'manychat', run_id || '_pmid_1', run_id || '_hash_A', 'smoke A1');

  BEGIN
    INSERT INTO public.instagram_messages
      (instagram_account_id, sender_id, peer_id, direction,
       provider_kind, provider_message_id, idempotency_hash, message_text)
    VALUES
      (test_account_id, 'smoke_sender', 'smoke_peer', 'inbound',
       'manychat', run_id || '_pmid_1', run_id || '_hash_B', 'smoke A2');
  EXCEPTION WHEN unique_violation THEN
    smoke_a_failed_as_expected := true;
  END;

  IF NOT smoke_a_failed_as_expected THEN
    DELETE FROM public.instagram_messages
    WHERE provider_kind = 'manychat'
      AND idempotency_hash LIKE run_id || '%';
    RAISE EXCEPTION 'write-contract drift: UNIQUE provider_message_id not enforced';
  END IF;

  -- Smoke B: idempotency_hash НЕ должен быть UNIQUE сам по себе
  INSERT INTO public.instagram_messages
    (instagram_account_id, sender_id, peer_id, direction,
     provider_kind, provider_message_id, idempotency_hash, message_text)
  VALUES
    (test_account_id, 'smoke_sender', 'smoke_peer', 'inbound',
     'manychat', run_id || '_pmid_2', run_id || '_hash_shared', 'smoke B1');

  BEGIN
    INSERT INTO public.instagram_messages
      (instagram_account_id, sender_id, peer_id, direction,
       provider_kind, provider_message_id, idempotency_hash, message_text)
    VALUES
      (test_account_id, 'smoke_sender', 'smoke_peer', 'inbound',
       'manychat', run_id || '_pmid_3', run_id || '_hash_shared', 'smoke B2');
  EXCEPTION WHEN unique_violation THEN
    smoke_b_failed_unexpectedly := true;
  END;

  DELETE FROM public.instagram_messages
  WHERE provider_kind = 'manychat'
    AND idempotency_hash LIKE run_id || '%';

  IF smoke_b_failed_unexpectedly THEN
    RAISE EXCEPTION 'write-contract drift: idempotency_hash should not be UNIQUE alone';
  END IF;

  RAISE NOTICE 'Migration 2.1 write-contract smoke passed (run_id=%): Smoke A enforced, Smoke B permissive', run_id;
END $$;