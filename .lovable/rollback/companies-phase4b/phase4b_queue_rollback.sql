-- Phase 4B rollback (reverse order of migration 20260720-062948-307712).
-- Idempotent. Removes only Phase 4B additions. Does NOT touch Phase 3 canonical
-- data or the pre-existing company_sync_queue table.

DROP FUNCTION IF EXISTS public.crm_company_sync_worker_complete(uuid, text, text);
DROP FUNCTION IF EXISTS public.crm_company_sync_worker_claim(int, int);
DROP FUNCTION IF EXISTS public.crm_company_sync_enqueue(uuid, text);

DROP INDEX IF EXISTS public.csq_deadletter_idx;

ALTER TABLE public.company_sync_queue
  DROP CONSTRAINT IF EXISTS company_sync_queue_status_check;
ALTER TABLE public.company_sync_queue
  ADD CONSTRAINT company_sync_queue_status_check
  CHECK (status = ANY (ARRAY['queued','running','done','failed','skipped']));

ALTER TABLE public.company_sync_queue
  DROP COLUMN IF EXISTS first_attempted_at;

-- Postflight guard
DO $$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM pg_proc
   WHERE proname IN ('crm_company_sync_enqueue',
                     'crm_company_sync_worker_claim',
                     'crm_company_sync_worker_complete');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'rollback FAIL: helper functions still present (%)', v_bad;
  END IF;
END $$;
