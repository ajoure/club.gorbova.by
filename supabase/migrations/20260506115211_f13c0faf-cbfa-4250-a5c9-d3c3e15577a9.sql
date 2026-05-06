
DO $$
DECLARE
  v_run_id   text := 'entitlement_tariff_id_backfill_2026_05_' || to_char(now(),'YYYYMMDD_HH24MISS');
  v_backup   bigint;
  v_updated  bigint;
  v_audit    bigint;
  v_bonus_touched bigint;
BEGIN
  CREATE TABLE IF NOT EXISTS public._backup_entitlement_tariff_id_backfill_2026_05 (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backfill_run_id text NOT NULL,
    entitlement_id  uuid NOT NULL,
    user_id         uuid NOT NULL,
    product_id      uuid NOT NULL,
    old_meta        jsonb NOT NULL,
    resolved_tariff_id uuid NOT NULL,
    resolution_source text NOT NULL CHECK (resolution_source IN ('P1','P2')),
    created_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_backup_ent_tariff_run
    ON public._backup_entitlement_tariff_id_backfill_2026_05 (backfill_run_id);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_backup_ent_tariff_run_eid
    ON public._backup_entitlement_tariff_id_backfill_2026_05 (backfill_run_id, entitlement_id);

  WITH cohort AS (
    SELECT e.id AS entitlement_id, e.user_id, e.product_id, COALESCE(e.meta, '{}'::jsonb) AS meta
    FROM entitlements e
    WHERE e.status='active'
      AND e.product_id IS NOT NULL
      AND (COALESCE(e.meta,'{}'::jsonb)->>'tariff_id') IS NULL
      AND COALESCE(COALESCE(e.meta,'{}'::jsonb)->>'source_type','')           NOT IN ('rule_engine','retroapply')
      AND COALESCE(COALESCE(e.meta,'{}'::jsonb)->>'scope_resolution_mode','') NOT IN ('module_scope_only','no_scope','union_scope')
  ),
  p1 AS (
    SELECT c.entitlement_id, array_agg(DISTINCT o.tariff_id) AS tids
    FROM cohort c
    JOIN orders_v2 o
      ON o.user_id=c.user_id AND o.product_id=c.product_id AND o.tariff_id IS NOT NULL
     AND (o.status='paid' OR o.meta->>'source'='admin_grant' OR o.order_number LIKE 'GIFT-%')
    GROUP BY c.entitlement_id
  ),
  p2 AS (
    SELECT c.entitlement_id, array_agg(DISTINCT s.tariff_id) AS tids
    FROM cohort c
    JOIN subscriptions_v2 s
      ON s.user_id=c.user_id AND s.product_id=c.product_id AND s.tariff_id IS NOT NULL
     AND s.status IN ('active','trial','canceled','past_due')
    GROUP BY c.entitlement_id
  ),
  resolved AS (
    SELECT c.entitlement_id, c.user_id, c.product_id, c.meta AS old_meta,
      CASE
        WHEN p1.tids IS NOT NULL AND array_length(p1.tids,1)=1 THEN p1.tids[1]
        WHEN p1.tids IS NULL AND p2.tids IS NOT NULL AND array_length(p2.tids,1)=1 THEN p2.tids[1]
      END AS resolved_tid,
      CASE
        WHEN p1.tids IS NOT NULL AND array_length(p1.tids,1)=1 THEN 'P1'
        WHEN p1.tids IS NULL AND p2.tids IS NOT NULL AND array_length(p2.tids,1)=1 THEN 'P2'
      END AS source
    FROM cohort c LEFT JOIN p1 USING(entitlement_id) LEFT JOIN p2 USING(entitlement_id)
  )
  INSERT INTO public._backup_entitlement_tariff_id_backfill_2026_05
    (backfill_run_id, entitlement_id, user_id, product_id, old_meta, resolved_tariff_id, resolution_source)
  SELECT v_run_id, entitlement_id, user_id, product_id, old_meta, resolved_tid, source
  FROM resolved
  WHERE resolved_tid IS NOT NULL;

  GET DIAGNOSTICS v_backup = ROW_COUNT;
  IF v_backup <> 336 THEN
    RAISE EXCEPTION 'Backup count mismatch: expected 336, got %', v_backup;
  END IF;

  UPDATE entitlements e
  SET meta = jsonb_set(
               jsonb_set(
                 jsonb_set(COALESCE(e.meta,'{}'::jsonb), '{tariff_id}', to_jsonb(b.resolved_tariff_id::text)),
                 '{tariff_id_backfilled_at}', to_jsonb(now())
               ),
               '{tariff_id_backfill_source}', to_jsonb(b.resolution_source)
             ),
      updated_at = now()
  FROM public._backup_entitlement_tariff_id_backfill_2026_05 b
  WHERE b.backfill_run_id = v_run_id
    AND e.id = b.entitlement_id
    AND (COALESCE(e.meta,'{}'::jsonb)->>'tariff_id') IS NULL
    AND COALESCE(COALESCE(e.meta,'{}'::jsonb)->>'source_type','')           NOT IN ('rule_engine','retroapply')
    AND COALESCE(COALESCE(e.meta,'{}'::jsonb)->>'scope_resolution_mode','') NOT IN ('module_scope_only','no_scope','union_scope');

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 336 THEN
    RAISE EXCEPTION 'Update rowcount mismatch: expected 336, got %', v_updated;
  END IF;

  SELECT COUNT(*) INTO v_bonus_touched
  FROM entitlements
  WHERE meta->>'tariff_id_backfill_source' IN ('P1','P2')
    AND (
      meta->>'source_type' IN ('rule_engine','retroapply')
      OR meta->>'scope_resolution_mode' IN ('module_scope_only','no_scope','union_scope')
    );
  IF v_bonus_touched <> 0 THEN
    RAISE EXCEPTION 'Bonus/scope-limited entitlements were touched: %', v_bonus_touched;
  END IF;

  INSERT INTO audit_logs (action, actor_type, actor_label, meta)
  SELECT
    'training_content.entitlement_tariff_id_backfilled',
    'system',
    'entitlement_tariff_id_backfill_2026_05',
    jsonb_build_object(
      'backfill_run_id', v_run_id,
      'entitlement_id',  b.entitlement_id,
      'user_id',         b.user_id,
      'product_id',      b.product_id,
      'tariff_id',       b.resolved_tariff_id,
      'source',          b.resolution_source,
      'old_meta',        b.old_meta
    )
  FROM public._backup_entitlement_tariff_id_backfill_2026_05 b
  WHERE b.backfill_run_id = v_run_id;

  GET DIAGNOSTICS v_audit = ROW_COUNT;
  IF v_audit <> 336 THEN
    RAISE EXCEPTION 'Audit rowcount mismatch: expected 336, got %', v_audit;
  END IF;

  RAISE NOTICE 'PATCH 1 backfill OK: run_id=%, backup=%, updated=%, audit=%', v_run_id, v_backup, v_updated, v_audit;
END $$;
