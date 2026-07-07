
DO $$
DECLARE
  gc_pipeline uuid := 'a0000001-0000-0000-0000-000000000001';
  default_won uuid := 'b0000001-0001-0000-0000-000000000003';
  default_lost uuid := 'b0000001-0001-0000-0000-000000000004';
  moved_count integer;
BEGIN
  WITH gc AS (
    SELECT o.id order_id, o.offer_id, o.pipeline_stage_id, o.meta->'crm_routing' AS order_r
    FROM orders_v2 o
    WHERE o.pipeline_id = gc_pipeline
  ),
  p AS (
    SELECT order_id,
      bool_or(status='succeeded' AND coalesce(transaction_type,'payment')<>'refund' AND amount>0) AS has_success,
      bool_or(status IN ('failed','canceled')) AS has_failed
    FROM payments_v2
    WHERE order_id IN (SELECT order_id FROM gc)
    GROUP BY order_id
  ),
  resolved AS (
    SELECT gc.order_id, gc.pipeline_stage_id,
      coalesce(p.has_success,false) AS has_success,
      coalesce(p.has_failed,false) AS has_failed,
      coalesce(gc.order_r->>'stage_on_success', tf.meta->'crm_routing'->>'stage_on_success', default_won::text)::uuid AS stage_success,
      coalesce(gc.order_r->>'stage_on_failed',  tf.meta->'crm_routing'->>'stage_on_failed',  default_lost::text)::uuid AS stage_failed
    FROM gc LEFT JOIN p USING(order_id) LEFT JOIN tariff_offers tf ON tf.id = gc.offer_id
  ),
  plan AS (
    SELECT order_id, pipeline_stage_id AS from_stage,
      CASE WHEN has_success THEN stage_success
           WHEN has_failed  THEN stage_failed END AS target_stage,
      CASE WHEN has_success THEN 'paid' ELSE 'failed' END AS reason
    FROM resolved
    WHERE has_success OR has_failed
  ),
  to_move AS (
    SELECT * FROM plan WHERE target_stage IS NOT NULL AND target_stage <> from_stage
  ),
  upd AS (
    UPDATE orders_v2 o
    SET pipeline_stage_id = m.target_stage,
        status = CASE
          WHEN m.reason='paid'   AND o.status IN ('draft','pending','failed','canceled','needs_mapping','lead') THEN 'paid'::order_status
          WHEN m.reason='failed' AND o.status IN ('draft','pending','paid') THEN 'failed'::order_status
          ELSE o.status
        END,
        updated_at = now()
    FROM to_move m
    WHERE o.id = m.order_id
    RETURNING o.id, m.from_stage, m.target_stage, m.reason
  ),
  logged AS (
    INSERT INTO audit_logs (actor_type, actor_label, action, entity_type, entity_id, meta)
    SELECT 'system', 'roadmap:gc-funnel-cleanup-2026-07-07', 'crm.deal.stage_reassigned',
           'orders_v2', upd.id::text,
           jsonb_build_object(
             'pipeline_id', gc_pipeline,
             'from_stage', upd.from_stage,
             'to_stage', upd.target_stage,
             'reason', upd.reason,
             'source', 'bulk-reconciliation'
           )
    FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO moved_count FROM logged;

  RAISE NOTICE 'GC funnel reconciliation: moved % deals', moved_count;
END $$;
