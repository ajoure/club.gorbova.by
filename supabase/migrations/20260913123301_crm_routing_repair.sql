-- Exact configuration omissions confirmed by read-only production discovery.
-- No orders are backfilled by this migration; maintenance requires reviewed batches.
DO $$
DECLARE p uuid:='a0000001-0000-0000-0000-000000000002'; x uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages WHERE id='b0000001-0002-0000-0000-000000000001'
    AND pipeline_id=p AND name='Новая' AND stage_type='open' AND order_index=0)
    OR EXISTS(SELECT 1 FROM public.crm_pipeline_stages WHERE pipeline_id=p AND is_default
      AND id<>'b0000001-0002-0000-0000-000000000001') THEN RAISE EXCEPTION 'crm_initial_stage_config_drift'; END IF;
  UPDATE public.crm_pipeline_stages SET is_default=true WHERE id='b0000001-0002-0000-0000-000000000001' AND NOT is_default;
  FOREACH x IN ARRAY ARRAY['aa11cb00-0000-4000-8000-000000000001'::uuid,'2b7bf6d4-ad8d-46ad-9399-7f96c307c596'::uuid] LOOP
    IF NOT EXISTS(SELECT 1 FROM public.products_v2 WHERE id=x AND name LIKE 'Ценный бухгалтер | 1 ступень 2.0%')
      OR EXISTS(SELECT 1 FROM public.crm_pipeline_product_bindings WHERE product_id=x AND pipeline_id<>p)
      THEN RAISE EXCEPTION 'crm_product_binding_config_drift'; END IF;
    INSERT INTO public.crm_pipeline_product_bindings(pipeline_id,product_id,metadata)
      VALUES(p,x,'{"source":"crm_sprint_20260913","reason":"missing_cb1_product_binding"}')
      ON CONFLICT(pipeline_id,product_id) DO NOTHING;
  END LOOP;
  INSERT INTO public.audit_logs(actor_type,action,entity_type,meta)
    VALUES('system','crm.routing_config.completed','crm_pipelines',jsonb_build_object('pipeline_id',p,'migration','20260913123301'));
END;
$$;

CREATE TABLE public.crm_deal_routing_repairs (
  order_id uuid PRIMARY KEY REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  previous_pipeline_id uuid,
  previous_stage_id uuid,
  previous_snapshot jsonb,
  applied_snapshot jsonb NOT NULL,
  applied_stage_id uuid NOT NULL,
  source_status text NOT NULL,
  source_paid_amount numeric,
  source_fingerprint text NOT NULL,
  config_fingerprint text NOT NULL,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);
ALTER TABLE public.crm_deal_routing_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_deal_routing_repairs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.crm_deal_routing_repairs TO service_role;

CREATE OR REPLACE FUNCTION public.crm_routing_config_fingerprint()
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT md5(jsonb_build_object(
  'pipelines',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.crm_pipelines p),
  'stages',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.crm_pipeline_stages s),
  'bindings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM public.crm_pipeline_product_bindings b),
  'offers',(SELECT jsonb_agg(jsonb_build_object('id',id,'tariff_id',tariff_id,'active',is_active,'type',offer_type,'routing',meta->'crm_routing') ORDER BY id) FROM public.tariff_offers)
 )::text);
$$;
REVOKE ALL ON FUNCTION public.crm_routing_config_fingerprint() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_routing_config_fingerprint() TO service_role;

-- A review page contains no customer data, only route inputs + row digest.
CREATE OR REPLACE FUNCTION public.crm_routing_review_page(p_after uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS TABLE(order_id uuid,status text,paid_amount numeric,product_id uuid,tariff_id uuid,offer_id uuid,
  pipeline_id uuid,pipeline_stage_id uuid,snapshot jsonb,row_fingerprint text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT o.id,o.status::text,o.paid_amount,o.product_id,o.tariff_id,o.offer_id,o.pipeline_id,o.pipeline_stage_id,
   o.meta->'crm_routing_snapshot',md5(to_jsonb(o)::text)
 FROM public.orders_v2 o WHERE NOT coalesce(o.is_deleted,false) AND (p_after IS NULL OR o.id>p_after)
 ORDER BY o.id LIMIT greatest(1,least(p_limit,100));
$$;
REVOKE ALL ON FUNCTION public.crm_routing_review_page(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_routing_review_page(uuid,integer) TO service_role;

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
        WHERE NOT EXISTS(SELECT 1 FROM public.crm_deal_routing_repairs a WHERE a.batch_id=p_batch_id AND a.order_id=x.order_id
          AND a.source_fingerprint=x.row_fingerprint AND a.applied_snapshot=x.snapshot AND a.applied_stage_id=x.target_stage_id))
      THEN RETURN jsonb_build_object('repaired',expected,'already_applied',true); END IF;
    RAISE EXCEPTION 'routing_batch_conflict';
  END IF;
  -- Freeze configuration and automation rules until commit. No new rule may
  -- race the zero-active-rules preflight and dispatch customer actions.
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
      WHEN o.status IN('paid','partial') OR coalesce(o.paid_amount,0)>0 THEN (r.snapshot->>'stage_on_success')::uuid
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

CREATE OR REPLACE FUNCTION public.crm_restore_routing_batch(p_batch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_deal_routing_repairs%ROWTYPE; o public.orders_v2%ROWTYPE; n integer:=0;
BEGIN
  LOCK TABLE public.crm_pipeline_automation_rules IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_pipeline_automation_rules WHERE status='active') THEN RAISE EXCEPTION 'routing_automation_requires_review'; END IF;
  FOR r IN SELECT * FROM public.crm_deal_routing_repairs WHERE batch_id=p_batch_id AND restored_at IS NULL ORDER BY order_id FOR UPDATE LOOP
    SELECT * INTO o FROM public.orders_v2 WHERE id=r.order_id FOR UPDATE;
    IF o.meta->'crm_routing_snapshot' IS DISTINCT FROM r.applied_snapshot OR o.pipeline_stage_id IS DISTINCT FROM r.applied_stage_id
      OR o.status::text IS DISTINCT FROM r.source_status OR o.paid_amount IS DISTINCT FROM r.source_paid_amount
      THEN RAISE EXCEPTION 'routing_restore_drift'; END IF;
    UPDATE public.orders_v2 SET pipeline_id=r.previous_pipeline_id,pipeline_stage_id=r.previous_stage_id,
      meta=CASE WHEN r.previous_snapshot IS NULL THEN coalesce(meta,'{}'::jsonb)-'crm_routing_snapshot'
        ELSE jsonb_set(coalesce(meta,'{}'::jsonb),'{crm_routing_snapshot}',r.previous_snapshot) END WHERE id=o.id;
    UPDATE public.crm_deal_routing_repairs SET restored_at=now() WHERE order_id=o.id;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','crm.routing.restored','orders_v2',o.id,jsonb_build_object('batch_id',p_batch_id));
    n:=n+1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_restore_routing_batch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_restore_routing_batch(uuid) TO service_role;
