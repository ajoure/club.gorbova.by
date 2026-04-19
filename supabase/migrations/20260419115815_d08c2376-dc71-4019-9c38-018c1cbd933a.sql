-- ============================================================
-- PATCH 1.1 — Migration 1: schema add-only (A1, A2, A3 cols, A4)
-- Rerun-safe; safe order для A4: ADD col → verify → preflight → DROP old → ADD new
-- ============================================================

-- A1: integration_instances.config_secrets
ALTER TABLE public.integration_instances
  ADD COLUMN IF NOT EXISTS config_secrets jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A2: instagram_accounts.provider_kind
ALTER TABLE public.instagram_accounts
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'apixdrive'
    CHECK (provider_kind IN ('apixdrive','manychat'));

-- A3: instagram_messages — 6 колонок (без индексов; индексы в Migration 2 CONCURRENTLY)
ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'apixdrive'
    CHECK (provider_kind IN ('apixdrive','manychat'));

ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS thread_key text,
  ADD COLUMN IF NOT EXISTS idempotency_hash text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- ============================================================
-- A4: instagram_contacts.provider_kind + UNIQUE swap (safe order, rerun-safe)
-- ============================================================

-- Шаг 1: ADD COLUMN с DEFAULT (legacy backfill = 'apixdrive')
ALTER TABLE public.instagram_contacts
  ADD COLUMN IF NOT EXISTS provider_kind text NOT NULL DEFAULT 'apixdrive'
    CHECK (provider_kind IN ('apixdrive','manychat'));

-- Шаг 1b: Guard — колонка provider_kind должна существовать перед DROP/ADD
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'instagram_contacts'
      AND column_name = 'provider_kind'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'A4 guard failed: instagram_contacts.provider_kind missing or nullable';
  END IF;
END $$;

-- Шаг 2: Verify backfill полностью применён (должно быть 0 NULL)
DO $$
DECLARE
  null_count integer;
BEGIN
  SELECT COUNT(*) INTO null_count
  FROM public.instagram_contacts
  WHERE provider_kind IS NULL;

  IF null_count > 0 THEN
    RAISE EXCEPTION
      'A4 backfill failed: % rows have provider_kind IS NULL after ADD COLUMN', null_count;
  END IF;
END $$;

-- Шаг 3: Preflight по ЦЕЛЕВОМУ composite UNIQUE
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT COUNT(*) INTO conflict_count
  FROM (
    SELECT instagram_account_id, provider_kind, instagram_user_id
    FROM public.instagram_contacts
    GROUP BY instagram_account_id, provider_kind, instagram_user_id
    HAVING COUNT(*) > 1
  ) dupes;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION
      'A4 preflight failed: % duplicate (account, provider_kind, user_id) groups found. HARD STOP.', conflict_count;
  END IF;
END $$;

-- Шаг 4: DROP старого UNIQUE по ЯВНОМУ имени
ALTER TABLE public.instagram_contacts
  DROP CONSTRAINT IF EXISTS instagram_contacts_instagram_account_id_instagram_user_id_key;

-- Шаг 5: ADD нового composite UNIQUE (idempotent guard)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.instagram_contacts'::regclass
      AND conname = 'instagram_contacts_account_provider_user_unique'
  ) THEN
    ALTER TABLE public.instagram_contacts
      ADD CONSTRAINT instagram_contacts_account_provider_user_unique
        UNIQUE (instagram_account_id, provider_kind, instagram_user_id);
  END IF;
END $$;

-- ============================================================
-- Post-migration machine-check (rerun-safe, 3 ассерта)
-- ============================================================
DO $$
DECLARE
  old_unique_exists boolean;
  new_unique_exists boolean;
  null_provider_count integer;
  non_canonical_legacy_count integer;
BEGIN
  -- 1. Старый UNIQUE отсутствует
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.instagram_contacts'::regclass
      AND conname = 'instagram_contacts_instagram_account_id_instagram_user_id_key'
  ) INTO old_unique_exists;

  IF old_unique_exists THEN
    RAISE EXCEPTION 'A4 check failed: old UNIQUE still exists';
  END IF;

  -- 2. Новый UNIQUE существует
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.instagram_contacts'::regclass
      AND conname = 'instagram_contacts_account_provider_user_unique'
  ) INTO new_unique_exists;

  IF NOT new_unique_exists THEN
    RAISE EXCEPTION 'A4 check failed: new composite UNIQUE missing';
  END IF;

  -- 3. provider_kind IS NULL = 0 (rerun-safe — не зависит от появления manychat-строк)
  SELECT COUNT(*) INTO null_provider_count
    FROM public.instagram_contacts WHERE provider_kind IS NULL;

  IF null_provider_count > 0 THEN
    RAISE EXCEPTION 'A4 check failed: % rows with provider_kind IS NULL', null_provider_count;
  END IF;

  -- 4. Sanity: значения только из allowed set (CHECK уже это гарантирует, но дублируем явно)
  SELECT COUNT(*) INTO non_canonical_legacy_count
    FROM public.instagram_contacts
    WHERE provider_kind NOT IN ('apixdrive','manychat');

  IF non_canonical_legacy_count > 0 THEN
    RAISE EXCEPTION 'A4 check failed: % rows with non-canonical provider_kind', non_canonical_legacy_count;
  END IF;

  RAISE NOTICE 'A4 machine-check passed (rerun-safe): old UNIQUE dropped, new UNIQUE active, no NULL provider_kind';
END $$;