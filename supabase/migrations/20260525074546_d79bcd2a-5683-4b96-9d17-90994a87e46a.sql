-- Удалить 2 синтетические provider_subscriptions без какой-либо истории платежей,
-- созданные admin-bepaid-backfill в 07:44 UTC. Без last_charge_at они триггерят INV-22 active_no_dates.
-- Сохраняем audit.

DO $$
DECLARE
  removed_ids jsonb;
BEGIN
  WITH del AS (
    DELETE FROM provider_subscriptions ps
    WHERE ps.id IN (
      'a828f9bd-b75d-49a4-8ffe-7c7e642287e2',
      '234745c9-14bc-4ea2-82ed-7b15567c2f17'
    )
    AND ps.meta->>'synthetic' = 'true'
    AND ps.last_charge_at IS NULL
    AND ps.provider = 'bepaid'
    RETURNING ps.id, ps.subscription_v2_id, ps.user_id
  )
  SELECT jsonb_agg(jsonb_build_object('id', id, 'subscription_v2_id', subscription_v2_id, 'user_id', user_id))
  INTO removed_ids
  FROM del;

  INSERT INTO audit_logs(action, meta, created_at)
  VALUES (
    'inv22_repair_remove_baseless_synthetic_ps',
    jsonb_build_object(
      'context', 'PATCH-NIGHTLY-2026-05-25-FINALIZE',
      'reason', 'synthetic ps without any payment history caused INV-22 active_no_dates regression',
      'removed', removed_ids,
      'source_backfill_run_at', '2026-05-25T07:45:02Z'
    ),
    now()
  );
END $$;