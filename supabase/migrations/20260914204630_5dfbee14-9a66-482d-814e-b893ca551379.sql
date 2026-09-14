-- A positive orders_v2.paid_amount is a denormalized hint, not proof that
-- money settled. Route terminal success from a settled order status only.
-- Correct the four reviewed historic failed attempts that were routed to
-- success solely because of the stale amount. The exact count is a drift gate.
DO $$
DECLARE correction_count integer;
BEGIN
  SELECT count(*) INTO correction_count
  FROM public.crm_deal_routing_repairs r
  JOIN public.orders_v2 o ON o.id=r.order_id
  WHERE r.restored_at IS NULL
    AND r.source_status='failed'
    AND coalesce(r.source_paid_amount,0)>0
    AND o.status='failed'
    AND o.pipeline_stage_id=r.applied_stage_id
    AND r.applied_stage_id=(r.applied_snapshot->>'stage_on_success')::uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.payments_v2 p
      WHERE p.order_id=o.id AND NOT coalesce(p.is_deleted,false)
        AND p.status IN ('succeeded','refunded','partially_refunded')
        AND (coalesce(p.amount,0)<>0 OR coalesce(p.refunded_amount,0)<>0)
        AND coalesce(p.transaction_type,'payment') NOT IN ('void','Отмена','authorization','tokenization')
    );
  IF correction_count<>4 THEN
    RAISE EXCEPTION 'crm_unconfirmed_failed_route_count_drift:%',correction_count;
  END IF;

  UPDATE public.orders_v2 o
  SET pipeline_stage_id=(r.applied_snapshot->>'stage_on_failed')::uuid
  FROM public.crm_deal_routing_repairs r
  WHERE r.order_id=o.id AND r.restored_at IS NULL
    AND r.source_status='failed' AND coalesce(r.source_paid_amount,0)>0
    AND o.status='failed' AND o.pipeline_stage_id=r.applied_stage_id
    AND r.applied_stage_id=(r.applied_snapshot->>'stage_on_success')::uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.payments_v2 p
      WHERE p.order_id=o.id AND NOT coalesce(p.is_deleted,false)
        AND p.status IN ('succeeded','refunded','partially_refunded')
        AND (coalesce(p.amount,0)<>0 OR coalesce(p.refunded_amount,0)<>0)
        AND coalesce(p.transaction_type,'payment') NOT IN ('void','Отмена','authorization','tokenization')
    );

  UPDATE public.crm_deal_routing_repairs r
  SET applied_stage_id=(r.applied_snapshot->>'stage_on_failed')::uuid
  FROM public.orders_v2 o
  WHERE r.order_id=o.id AND r.restored_at IS NULL
    AND r.source_status='failed' AND coalesce(r.source_paid_amount,0)>0
    AND o.status='failed'
    AND o.pipeline_stage_id=(r.applied_snapshot->>'stage_on_failed')::uuid
    AND NOT EXISTS (
      SELECT 1 FROM public.payments_v2 p
      WHERE p.order_id=o.id AND NOT coalesce(p.is_deleted,false)
        AND p.status IN ('succeeded','refunded','partially_refunded')
        AND (coalesce(p.amount,0)<>0 OR coalesce(p.refunded_amount,0)<>0)
        AND coalesce(p.transaction_type,'payment') NOT IN ('void','Отмена','authorization','tokenization')
    );

  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
  SELECT 'system','crm.routing.unconfirmed_amount_corrected','orders_v2',r.order_id,
    jsonb_build_object('previous_stage','success','applied_stage_id',r.applied_stage_id)
  FROM public.crm_deal_routing_repairs r
  WHERE r.restored_at IS NULL AND r.source_status='failed'
    AND coalesce(r.source_paid_amount,0)>0
    AND r.applied_stage_id=(r.applied_snapshot->>'stage_on_failed')::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_apply_reviewed_routes(p_batch_id uuid,p_config_fingerprint text,p_candidates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE n integer:=0; expected integer; r record; o public.orders_v2%ROWTYPE; target uuid; pipeline uuid;
BEGIN
  IF p_batch_id IS NULL OR jsonb_typeof(p_candidates)<>'array' THEN RAISE EXCEPTION 'invalid_routing_batch'; END IF;
  expected:=jsonb_array_length(p_candidates);
  IF expected<1 OR expected>25 OR (SELECT count(DISTINCT value->>'order_id') FROM jsonb_array_elements(p_candidates))<>expected
    THEN RAISE EXCEPTION 'invalid_routing_batch_size'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm_routing_repair:'||p_batch_id,0));
  IF EXISTS(SELECT 1 FROM public.crm_deal_routing_repairs WHERE batch_id=p_batch_id) THEN
    IF (SELECT count(*) FROM public.crm_deal_routing_repairs WHERE batch_id=p_batch_id AND restored_at IS NULL)=expected
      AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(p_candidates) AS x(order_id uuid,row_fingerprint text,snapshot jsonb,target_stage_id uuid)
        WHERE NOT EXISTS(SELECT 1 FROM public.crm_deal_routing_repairs a WHERE a.batch_id=p_batch_id
          AND a.order_id=x.order_id AND a.source_fingerprint=x.row_fingerprint
          AND a.applied_snapshot=x.snapshot AND a.applied_stage_id=x.target_stage_id)) THEN
      RETURN jsonb_build_object('repaired',expected,'already_applied',true); END IF;
    RAISE EXCEPTION 'routing_batch_conflict';
  END IF;
  LOCK TABLE public.crm_pipelines,public.crm_pipeline_stages,public.crm_pipeline_product_bindings,public.tariff_offers,
    public.crm_pipeline_automation_rules IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_pipeline_automation_rules WHERE status='active') THEN RAISE EXCEPTION 'routing_automation_requires_review'; END IF;
  IF public.crm_routing_config_fingerprint() IS DISTINCT FROM p_config_fingerprint THEN RAISE EXCEPTION 'routing_configuration_changed'; END IF;
  PERFORM id FROM public.orders_v2 WHERE id IN(SELECT (value->>'order_id')::uuid FROM jsonb_array_elements(p_candidates)) ORDER BY id FOR UPDATE;
  FOR r IN SELECT * FROM jsonb_to_recordset(p_candidates) AS x(order_id uuid,row_fingerprint text,snapshot jsonb,target_stage_id uuid) LOOP
    SELECT * INTO o FROM public.orders_v2 WHERE id=r.order_id;
    IF NOT FOUND OR coalesce(o.is_deleted,false) OR md5(to_jsonb(o)::text) IS DISTINCT FROM r.row_fingerprint
      OR r.snapshot->>'enabled' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'routing_candidate_changed'; END IF;
    pipeline:=(r.snapshot->>'pipeline_id')::uuid;
    target:=CASE WHEN o.status='refunded' THEN (r.snapshot->>'stage_on_failed')::uuid
      WHEN o.status IN('paid','partial') THEN (r.snapshot->>'stage_on_success')::uuid
      WHEN o.status IN('failed','canceled') THEN (r.snapshot->>'stage_on_failed')::uuid
      ELSE coalesce(CASE WHEN o.pipeline_id=pipeline THEN o.pipeline_stage_id END,(r.snapshot->>'stage_on_pending')::uuid) END;
    IF target IS DISTINCT FROM r.target_stage_id OR NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages WHERE id=target AND pipeline_id=pipeline)
      THEN RAISE EXCEPTION 'routing_target_mismatch'; END IF;
    IF o.meta#>>'{crm_routing_snapshot,enabled}'='true' AND o.meta->'crm_routing_snapshot' IS DISTINCT FROM r.snapshot
      THEN RAISE EXCEPTION 'immutable_routing_snapshot_changed'; END IF;
    INSERT INTO public.crm_deal_routing_repairs(order_id,batch_id,previous_pipeline_id,previous_stage_id,previous_snapshot,
      applied_snapshot,applied_stage_id,source_status,source_paid_amount,source_fingerprint,config_fingerprint)
      VALUES(o.id,p_batch_id,o.pipeline_id,o.pipeline_stage_id,o.meta->'crm_routing_snapshot',r.snapshot,target,o.status::text,o.paid_amount,r.row_fingerprint,p_config_fingerprint);
    UPDATE public.orders_v2 SET pipeline_id=pipeline,pipeline_stage_id=target,
      meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('crm_routing_snapshot',r.snapshot) WHERE id=o.id;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','crm.routing.repaired','orders_v2',o.id,jsonb_build_object('batch_id',p_batch_id,'pipeline_id',pipeline,'stage_id',target));
    n:=n+1;
  END LOOP;
  IF n<>expected THEN RAISE EXCEPTION 'routing_count_mismatch'; END IF;
  RETURN jsonb_build_object('repaired',n,'already_applied',false);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_apply_reviewed_routes(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_reviewed_routes(uuid,text,jsonb) TO service_role;