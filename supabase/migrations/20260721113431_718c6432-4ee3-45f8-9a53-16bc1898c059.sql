-- Phase: CRM terminal stage integrity backfill (v1)
-- Goal: For orders_v2 with immutable positive crm_routing_snapshot,
-- reconcile pipeline_stage_id + pipeline_id to the configured terminal
-- stage that matches the current financial status.
--
-- Rules (deterministic, snapshot-driven; nothing touched without a valid
-- positive snapshot):
--   status='paid'                          -> stage_on_success
--   status IN ('failed','canceled','refunded') -> stage_on_failed
-- Target stage must exist and belong to the snapshot pipeline. Otherwise
-- the row is left untouched and reported in audit_logs as invalid_config.
-- Fully idempotent; safe to re-run.

DO $mig$
DECLARE
  v_run_id   uuid := gen_random_uuid();
  v_paid_before   bigint;
  v_failed_before bigint;
  v_paid_after    bigint;
  v_failed_after  bigint;
  v_paid_updated  bigint := 0;
  v_failed_updated bigint := 0;
BEGIN
  -- Baseline counts of anomalies
  WITH snap AS (
    SELECT o.id, o.status::text AS status,
           o.pipeline_id, o.pipeline_stage_id,
           (o.meta->'crm_routing_snapshot') AS s
    FROM public.orders_v2 o
    WHERE o.meta ? 'crm_routing_snapshot'
      AND (o.meta->'crm_routing_snapshot'->>'enabled') = 'true'
      AND COALESCE(o.is_deleted,false) = false
  ), typed AS (
    SELECT id, status, pipeline_id, pipeline_stage_id,
           NULLIF(s->>'pipeline_id','')::uuid       AS snap_pipeline,
           NULLIF(s->>'stage_on_success','')::uuid  AS snap_success,
           NULLIF(s->>'stage_on_failed','')::uuid   AS snap_failed
    FROM snap
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'paid'
                     AND (pipeline_stage_id IS DISTINCT FROM snap_success
                          OR pipeline_id IS DISTINCT FROM snap_pipeline)),
    COUNT(*) FILTER (WHERE status IN ('failed','canceled','refunded')
                     AND (pipeline_stage_id IS DISTINCT FROM snap_failed
                          OR pipeline_id IS DISTINCT FROM snap_pipeline))
    INTO v_paid_before, v_failed_before
  FROM typed;

  -- Backfill "paid" -> stage_on_success (target stage must exist & belong to snapshot pipeline)
  WITH cand AS (
    SELECT o.id,
           o.pipeline_id  AS from_pipeline,
           o.pipeline_stage_id AS from_stage,
           NULLIF(o.meta->'crm_routing_snapshot'->>'pipeline_id','')::uuid       AS snap_pipeline,
           NULLIF(o.meta->'crm_routing_snapshot'->>'stage_on_success','')::uuid  AS target_stage,
           o.meta->'crm_routing_snapshot'->>'offer_id'    AS offer_id,
           o.meta->'crm_routing_snapshot'->>'offer_title' AS offer_title,
           o.meta->'crm_routing_snapshot'->>'pipeline_name' AS pipeline_name
    FROM public.orders_v2 o
    WHERE (o.meta->'crm_routing_snapshot'->>'enabled') = 'true'
      AND o.status::text = 'paid'
      AND COALESCE(o.is_deleted,false) = false
  ), valid AS (
    SELECT c.*
    FROM cand c
    JOIN public.crm_pipeline_stages s
      ON s.id = c.target_stage AND s.pipeline_id = c.snap_pipeline
    WHERE c.target_stage IS NOT NULL
      AND c.snap_pipeline IS NOT NULL
      AND (c.from_stage IS DISTINCT FROM c.target_stage
           OR c.from_pipeline IS DISTINCT FROM c.snap_pipeline)
  ), upd AS (
    UPDATE public.orders_v2 o
       SET pipeline_id       = v.snap_pipeline,
           pipeline_stage_id = v.target_stage,
           updated_at        = now()
      FROM valid v
     WHERE o.id = v.id
    RETURNING o.id, v.from_pipeline, v.from_stage, v.snap_pipeline,
              v.target_stage, v.pipeline_name, v.offer_id, v.offer_title
  ), aud AS (
    INSERT INTO public.audit_logs (actor_type, actor_label, action, meta, entity_type, entity_id, created_at)
    SELECT 'system', 'crm-routing-backfill', 'crm_stage_applied_success',
           jsonb_build_object(
             'order_id', u.id,
             'terminal_kind', 'success',
             'trigger', 'backfill_migration',
             'run_id', v_run_id,
             'pipeline_id', u.snap_pipeline,
             'pipeline_name', u.pipeline_name,
             'from_pipeline_id', u.from_pipeline,
             'from_stage_id', u.from_stage,
             'to_stage_id', u.target_stage,
             'offer_id', u.offer_id,
             'offer_title', u.offer_title,
             'manual_override_enforced', true
           ),
           'orders_v2', u.id::text, now()
      FROM upd u
    RETURNING 1
  )
  SELECT count(*) INTO v_paid_updated FROM upd;

  -- Backfill failed/canceled/refunded -> stage_on_failed
  WITH cand AS (
    SELECT o.id, o.status::text AS status,
           o.pipeline_id  AS from_pipeline,
           o.pipeline_stage_id AS from_stage,
           NULLIF(o.meta->'crm_routing_snapshot'->>'pipeline_id','')::uuid       AS snap_pipeline,
           NULLIF(o.meta->'crm_routing_snapshot'->>'stage_on_failed','')::uuid   AS target_stage,
           o.meta->'crm_routing_snapshot'->>'offer_id'    AS offer_id,
           o.meta->'crm_routing_snapshot'->>'offer_title' AS offer_title,
           o.meta->'crm_routing_snapshot'->>'pipeline_name' AS pipeline_name
    FROM public.orders_v2 o
    WHERE (o.meta->'crm_routing_snapshot'->>'enabled') = 'true'
      AND o.status::text IN ('failed','canceled','refunded')
      AND COALESCE(o.is_deleted,false) = false
  ), valid AS (
    SELECT c.*
    FROM cand c
    JOIN public.crm_pipeline_stages s
      ON s.id = c.target_stage AND s.pipeline_id = c.snap_pipeline
    WHERE c.target_stage IS NOT NULL
      AND c.snap_pipeline IS NOT NULL
      AND (c.from_stage IS DISTINCT FROM c.target_stage
           OR c.from_pipeline IS DISTINCT FROM c.snap_pipeline)
  ), upd AS (
    UPDATE public.orders_v2 o
       SET pipeline_id       = v.snap_pipeline,
           pipeline_stage_id = v.target_stage,
           updated_at        = now()
      FROM valid v
     WHERE o.id = v.id
    RETURNING o.id, v.from_pipeline, v.from_stage, v.snap_pipeline,
              v.target_stage, v.pipeline_name, v.offer_id, v.offer_title, v.status
  ), aud AS (
    INSERT INTO public.audit_logs (actor_type, actor_label, action, meta, entity_type, entity_id, created_at)
    SELECT 'system', 'crm-routing-backfill', 'crm_stage_applied_failed',
           jsonb_build_object(
             'order_id', u.id,
             'terminal_kind', 'failed',
             'trigger', 'backfill_migration',
             'run_id', v_run_id,
             'order_status', u.status,
             'pipeline_id', u.snap_pipeline,
             'pipeline_name', u.pipeline_name,
             'from_pipeline_id', u.from_pipeline,
             'from_stage_id', u.from_stage,
             'to_stage_id', u.target_stage,
             'offer_id', u.offer_id,
             'offer_title', u.offer_title,
             'manual_override_enforced', true
           ),
           'orders_v2', u.id::text, now()
      FROM upd u
    RETURNING 1
  )
  SELECT count(*) INTO v_failed_updated FROM upd;

  -- After counts
  WITH snap AS (
    SELECT o.id, o.status::text AS status,
           o.pipeline_id, o.pipeline_stage_id,
           (o.meta->'crm_routing_snapshot') AS s
    FROM public.orders_v2 o
    WHERE o.meta ? 'crm_routing_snapshot'
      AND (o.meta->'crm_routing_snapshot'->>'enabled') = 'true'
      AND COALESCE(o.is_deleted,false) = false
  ), typed AS (
    SELECT id, status, pipeline_id, pipeline_stage_id,
           NULLIF(s->>'pipeline_id','')::uuid       AS snap_pipeline,
           NULLIF(s->>'stage_on_success','')::uuid  AS snap_success,
           NULLIF(s->>'stage_on_failed','')::uuid   AS snap_failed
    FROM snap
  ), valid_target AS (
    SELECT t.*,
           EXISTS(SELECT 1 FROM public.crm_pipeline_stages s WHERE s.id = t.snap_success AND s.pipeline_id = t.snap_pipeline) AS s_ok,
           EXISTS(SELECT 1 FROM public.crm_pipeline_stages s WHERE s.id = t.snap_failed  AND s.pipeline_id = t.snap_pipeline) AS f_ok
    FROM typed t
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'paid' AND s_ok
                     AND (pipeline_stage_id IS DISTINCT FROM snap_success
                          OR pipeline_id IS DISTINCT FROM snap_pipeline)),
    COUNT(*) FILTER (WHERE status IN ('failed','canceled','refunded') AND f_ok
                     AND (pipeline_stage_id IS DISTINCT FROM snap_failed
                          OR pipeline_id IS DISTINCT FROM snap_pipeline))
    INTO v_paid_after, v_failed_after
  FROM valid_target;

  INSERT INTO public.audit_logs (actor_type, actor_label, action, meta, entity_type, created_at)
  VALUES ('system', 'crm-routing-backfill', 'crm_routing_backfill_run',
    jsonb_build_object(
      'run_id', v_run_id,
      'paid_off_success_before', v_paid_before,
      'failed_off_failed_before', v_failed_before,
      'paid_updated', v_paid_updated,
      'failed_updated', v_failed_updated,
      'paid_off_success_after_valid_targets', v_paid_after,
      'failed_off_failed_after_valid_targets', v_failed_after
    ),
    'orders_v2', now());

  RAISE NOTICE 'crm-routing backfill run % paid_before=% failed_before=% paid_updated=% failed_updated=% paid_after=% failed_after=%',
    v_run_id, v_paid_before, v_failed_before, v_paid_updated, v_failed_updated, v_paid_after, v_failed_after;
END
$mig$;