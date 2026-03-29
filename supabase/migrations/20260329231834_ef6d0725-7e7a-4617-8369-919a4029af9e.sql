-- PATCH v22.2: fix missing UNIQUE + watermark key

-- 1. Add missing UNIQUE constraint on source_event_key (idempotency guard)
ALTER TABLE public.access_grant_ledger
  ADD CONSTRAINT uq_ledger_source_event_key UNIQUE (source_event_key);

-- 2. Fix watermark: rename nested JSONB key inside 'system' row
UPDATE public.app_settings
SET value = (value - 'phase1_ledger_enabled_at') || jsonb_build_object('phase1_ledger_schema_ready_at', value->'phase1_ledger_enabled_at')
WHERE key = 'system'
  AND value ? 'phase1_ledger_enabled_at';