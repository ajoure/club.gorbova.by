-- Cleanup script for RR test-fixture orders and their provider events.
--
-- SAFETY:
--   * DEFAULT MODE: dry-run — set FIXTURE_OFFER_ID / RUN_MARKER, run SELECTs only,
--     verify the exact UUIDs and row counts, THEN uncomment the DELETE block.
--   * Never widen the WHERE clause. `meta.test_fixture=true` alone is NOT enough —
--     always combine with exact offer_id AND test_fixture_run marker.
--   * `webhook_bad_signature` / `webhook_unknown_order` events for audit are NOT
--     removed here; delete them separately after archiving proof artifacts.
--   * Must run manually. Never wired into CI.

BEGIN;

-- ---- CONFIGURE (edit these two lines per run) --------------------------------
-- Placeholder UUIDs. Replace with actual fixture id and run marker before running.
-- \set FIXTURE_OFFER_ID '00000000-0000-0000-0000-000000000000'
-- \set RUN_MARKER       'rr-sprint-b-fixture-run-<yyyy-mm-dd-hhmm>'

-- Fallback vars if not set via -v:
DO $$
BEGIN
  PERFORM set_config('rr_cleanup.offer_id', current_setting('rr_cleanup.offer_id', true), false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ---- DRY-RUN: list what would be affected -----------------------------------

WITH candidate_orders AS (
  SELECT o.id, o.created_at, o.status, o.offer_id, o.meta->'rr' AS rr
    FROM public.orders_v2 o
   WHERE o.offer_id = :'FIXTURE_OFFER_ID'
     AND o.meta->>'test_fixture_run' = :'RUN_MARKER'
     AND (o.meta->>'test_fixture')::boolean IS TRUE
)
SELECT 'orders_v2' AS scope, count(*) AS rows_to_delete FROM candidate_orders
UNION ALL
SELECT 'provider_events (child)' AS scope, count(*) AS rows_to_delete
  FROM public.provider_events pe
 WHERE pe.related_order_id IN (SELECT id FROM candidate_orders);

-- Explicit sample listing (max 50) — sanity check UUIDs before deletion.
SELECT id, created_at, status, offer_id, meta->'rr'->>'initiation_status' AS init_status
  FROM public.orders_v2
 WHERE offer_id = :'FIXTURE_OFFER_ID'
   AND meta->>'test_fixture_run' = :'RUN_MARKER'
 ORDER BY created_at DESC
 LIMIT 50;

-- ---- DELETE BLOCK (uncomment only after verifying the dry-run output) --------

-- WITH candidate_orders AS (
--   SELECT o.id
--     FROM public.orders_v2 o
--    WHERE o.offer_id = :'FIXTURE_OFFER_ID'
--      AND o.meta->>'test_fixture_run' = :'RUN_MARKER'
--      AND (o.meta->>'test_fixture')::boolean IS TRUE
-- )
-- DELETE FROM public.provider_events
--  WHERE related_order_id IN (SELECT id FROM candidate_orders)
--    AND event_type IN (
--      'create_order_requested',
--      'create_order_succeeded',
--      'create_order_failed',
--      'create_order_persist_failed',
--      'webhook_notification_received',
--      'webhook_not_rr_installment'
--    );
--
-- DELETE FROM public.orders_v2
--  WHERE offer_id = :'FIXTURE_OFFER_ID'
--    AND meta->>'test_fixture_run' = :'RUN_MARKER'
--    AND (meta->>'test_fixture')::boolean IS TRUE;

-- Rollback by default — force explicit COMMIT if intent is real deletion.
ROLLBACK;
