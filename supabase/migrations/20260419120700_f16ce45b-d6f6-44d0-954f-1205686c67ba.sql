-- ============================================================
-- PATCH 1.1 — Migration 2 (fallback A, corrected column name)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ig_msg_manychat_provider
  ON public.instagram_messages (instagram_account_id, provider_kind, created_at DESC)
  WHERE provider_kind = 'manychat';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ig_msg_provider_idempotency
  ON public.instagram_messages (instagram_account_id, provider_kind, idempotency_hash)
  WHERE idempotency_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ig_msg_thread_key
  ON public.instagram_messages (instagram_account_id, thread_key, created_at DESC)
  WHERE thread_key IS NOT NULL;

DO $$
DECLARE
  idx1 boolean; idx2 boolean; idx3 boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='instagram_messages' AND indexname='idx_ig_msg_manychat_provider') INTO idx1;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='instagram_messages' AND indexname='uq_ig_msg_provider_idempotency') INTO idx2;
  SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='instagram_messages' AND indexname='idx_ig_msg_thread_key') INTO idx3;

  IF NOT idx1 THEN RAISE EXCEPTION 'Migration 2 check failed: idx_ig_msg_manychat_provider missing'; END IF;
  IF NOT idx2 THEN RAISE EXCEPTION 'Migration 2 check failed: uq_ig_msg_provider_idempotency missing'; END IF;
  IF NOT idx3 THEN RAISE EXCEPTION 'Migration 2 check failed: idx_ig_msg_thread_key missing'; END IF;

  RAISE NOTICE 'Migration 2 verify passed: 3 partial indexes created';
END $$;