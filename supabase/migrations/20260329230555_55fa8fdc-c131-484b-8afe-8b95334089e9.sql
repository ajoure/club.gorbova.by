
-- PATCH v22.1: ledger migration hardening

-- 1. Watermark: rename existing key to schema_ready_at, leave cutover_at for later
UPDATE public.app_settings
SET key = 'phase1_ledger_schema_ready_at'
WHERE key = 'phase1_ledger_enabled_at';

-- 2. RLS: recreate policy with explicit WITH CHECK
DROP POLICY IF EXISTS "Service role full access" ON public.access_grant_ledger;

CREATE POLICY "Service role full access" ON public.access_grant_ledger
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 3. Drop redundant index (UNIQUE already creates btree)
DROP INDEX IF EXISTS idx_ledger_source_event_key;
