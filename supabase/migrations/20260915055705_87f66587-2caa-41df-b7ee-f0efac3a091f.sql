-- The owner confirmed that the two reviewed paid bePaid orders belong to the
-- current "Закрой год 2025–2026" product. Amount is not a product key: the
-- same product may be paid once or in instalments, so this migration leaves an
-- unknown tariff/offer NULL instead of inventing one.
--
-- Both rows are identified by their observed UUID prefixes plus independent
-- payment evidence. Any change to that reviewed cohort fails the migration.

CREATE TABLE IF NOT EXISTS public.crm_user_confirmed_product_mapping_repairs (
  order_id uuid PRIMARY KEY REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  previous_product_id uuid,
  previous_tariff_id uuid,
  previous_offer_id uuid,
  previous_pipeline_id uuid,
  previous_stage_id uuid,
  previous_meta jsonb NOT NULL,
  applied_product_id uuid NOT NULL,
  applied_pipeline_id uuid NOT NULL,
  applied_stage_id uuid NOT NULL,
  applied_fingerprint text,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);
ALTER TABLE public.crm_user_confirmed_product_mapping_repairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_user_confirmed_product_mapping_repairs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_user_confirmed_product_mapping_repairs TO service_role;

CREATE OR REPLACE FUNCTION public.crm_restore_user_confirmed_product_mapping(p_batch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.crm_user_confirmed_product_mapping_repairs%ROWTYPE; o public.orders_v2%ROWTYPE; n integer:=0;
BEGIN
  IF p_batch_id IS NULL THEN RAISE EXCEPTION 'crm_mapping_restore_batch_required'; END IF;
  LOCK TABLE public.crm_pipeline_automation_rules IN SHARE MODE;
  IF EXISTS(SELECT 1 FROM public.crm_pipeline_automation_rules WHERE status='active')
    THEN RAISE EXCEPTION 'routing_automation_requires_review'; END IF;
  FOR r IN SELECT * FROM public.crm_user_confirmed_product_mapping_repairs
           WHERE batch_id=p_batch_id AND restored_at IS NULL ORDER BY order_id FOR UPDATE LOOP
    SELECT * INTO o FROM public.orders_v2 WHERE id=r.order_id FOR UPDATE;
    IF NOT FOUND
      OR o.product_id IS DISTINCT FROM r.applied_product_id
      OR o.pipeline_id IS DISTINCT FROM r.applied_pipeline_id
      OR o.pipeline_stage_id IS DISTINCT FROM r.applied_stage_id
      OR md5(to_jsonb(o)::text) IS DISTINCT FROM r.applied_fingerprint
      THEN RAISE EXCEPTION 'crm_mapping_restore_drift'; END IF;
    UPDATE public.orders_v2
      SET product_id=r.previous_product_id,
          tariff_id=r.previous_tariff_id,
          offer_id=r.previous_offer_id,
          pipeline_id=r.previous_pipeline_id,
          pipeline_stage_id=r.previous_stage_id,
          meta=r.previous_meta
      WHERE id=o.id;
    UPDATE public.crm_user_confirmed_product_mapping_repairs SET restored_at=now() WHERE order_id=o.id;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','crm.product_mapping.restored','orders_v2',o.id,jsonb_build_object('batch_id',p_batch_id));
    n:=n+1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_restore_user_confirmed_product_mapping(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_restore_user_confirmed_product_mapping(uuid) TO service_role;

DO $$
DECLARE
  target_product constant uuid := '73c29914-63a3-4f4f-ac42-9f5287e58696';
  target_pipeline constant uuid := 'a0000001-0000-0000-0000-000000000003';
  target_stage constant uuid := 'b0000001-0003-0000-0000-000000000003';
  target_batch constant uuid := 'c7252609-1509-4c25-8c26-000000000002';
  candidate_count integer;
  payment_proof_count integer;
  mapped_count integer;
BEGIN
  LOCK TABLE public.crm_pipelines, public.crm_pipeline_stages,
    public.crm_pipeline_product_bindings, public.crm_pipeline_automation_rules,
    public.orders_v2, public.payments_v2 IN SHARE MODE;

  IF EXISTS(SELECT 1 FROM public.crm_pipeline_automation_rules WHERE status='active') THEN
    RAISE EXCEPTION 'routing_automation_requires_review';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.products_v2 p
                WHERE p.id=target_product AND p.is_active AND p.name ILIKE '%закрой год%')
    OR NOT EXISTS(SELECT 1 FROM public.crm_pipelines p
                  WHERE p.id=target_pipeline AND p.name ILIKE '%закрой год%')
    OR NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages s WHERE s.id=target_stage
                  AND s.pipeline_id=target_pipeline AND s.stage_type='closed_won')
    OR EXISTS(SELECT 1 FROM public.crm_pipeline_product_bindings b
              WHERE b.product_id=target_product AND b.pipeline_id<>target_pipeline) THEN
    RAISE EXCEPTION 'crm_close_year_2025_2026_route_config_drift';
  END IF;

  INSERT INTO public.crm_pipeline_product_bindings(pipeline_id,product_id,metadata)
    VALUES(target_pipeline,target_product,
      '{"source":"crm_sprint_20260915","reason":"owner_confirmed_close_year_2025_2026"}'::jsonb)
    ON CONFLICT(pipeline_id,product_id) DO NOTHING;

  SELECT count(*) INTO candidate_count
  FROM public.orders_v2 o
  WHERE NOT coalesce(o.is_deleted,false)
    AND (o.id::text LIKE '0bd7ecd0-%' OR o.id::text LIKE '497f4cda-%')
    AND o.status='paid'
    AND o.product_id IS NULL AND o.tariff_id IS NULL AND o.offer_id IS NULL
    AND coalesce(o.is_trial,false)=false
    AND upper(coalesce(o.currency,''))='BYN'
    AND ((o.id::text LIKE '0bd7ecd0-%' AND o.final_price=330 AND o.paid_amount=330)
      OR (o.id::text LIKE '497f4cda-%' AND o.final_price=495 AND o.paid_amount=495))
    AND o.meta->>'source'='admin-backfill-2026-orders'
    AND o.meta->>'needs_mapping'='true';
  IF candidate_count<>2 OR EXISTS(
    SELECT 1 FROM public.crm_user_confirmed_product_mapping_repairs r
    WHERE r.order_id::text LIKE '0bd7ecd0-%' OR r.order_id::text LIKE '497f4cda-%'
  ) THEN
    RAISE EXCEPTION 'crm_close_year_2025_2026_cohort_drift:%',candidate_count;
  END IF;

  SELECT count(*) INTO payment_proof_count
  FROM public.orders_v2 o
  WHERE (o.id::text LIKE '0bd7ecd0-%' OR o.id::text LIKE '497f4cda-%')
    AND EXISTS(
      SELECT 1 FROM public.payments_v2 p
      WHERE p.order_id=o.id AND NOT coalesce(p.is_deleted,false)
        AND p.provider='bepaid' AND p.status='succeeded' AND p.amount=o.final_price
        AND ((o.id::text LIKE '0bd7ecd0-%' AND p.paid_at::date='2026-01-13'::date)
          OR (o.id::text LIKE '497f4cda-%' AND p.paid_at::date='2026-01-15'::date))
    );
  IF payment_proof_count<>2 THEN
    RAISE EXCEPTION 'crm_close_year_2025_2026_payment_proof_drift:%',payment_proof_count;
  END IF;

  INSERT INTO public.crm_user_confirmed_product_mapping_repairs(
    order_id,batch_id,previous_product_id,previous_tariff_id,previous_offer_id,
    previous_pipeline_id,previous_stage_id,previous_meta,
    applied_product_id,applied_pipeline_id,applied_stage_id
  )
  SELECT o.id,target_batch,o.product_id,o.tariff_id,o.offer_id,o.pipeline_id,o.pipeline_stage_id,
    coalesce(o.meta,'{}'::jsonb),target_product,target_pipeline,target_stage
  FROM public.orders_v2 o
  WHERE o.id::text LIKE '0bd7ecd0-%' OR o.id::text LIKE '497f4cda-%';

  UPDATE public.orders_v2 o
  SET product_id=target_product,
      pipeline_id=target_pipeline,
      pipeline_stage_id=target_stage,
      meta=(coalesce(o.meta,'{}'::jsonb)-'needs_mapping') || jsonb_build_object(
        'product_mapping',jsonb_build_object(
          'source','owner_confirmed_close_year_2025_2026',
          'batch_id',target_batch,
          'tariff','not_inferred'
        )
      )
  WHERE o.id::text LIKE '0bd7ecd0-%' OR o.id::text LIKE '497f4cda-%';
  GET DIAGNOSTICS mapped_count = ROW_COUNT;
  IF mapped_count<>2 THEN RAISE EXCEPTION 'crm_close_year_2025_2026_update_drift:%',mapped_count; END IF;

  UPDATE public.crm_user_confirmed_product_mapping_repairs r
  SET applied_fingerprint=md5(to_jsonb(o)::text)
  FROM public.orders_v2 o
  WHERE r.order_id=o.id AND r.batch_id=target_batch;

  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
  SELECT 'system','crm.product_mapping.owner_confirmed','orders_v2',r.order_id,
    jsonb_build_object(
      'batch_id',target_batch,
      'product_id',target_product,
      'pipeline_id',target_pipeline,
      'stage_id',target_stage,
      'previous_product_id',r.previous_product_id,
      'previous_tariff_id',r.previous_tariff_id,
      'reason','owner_confirmed_close_year_2025_2026; tariff_not_inferred'
    )
  FROM public.crm_user_confirmed_product_mapping_repairs r WHERE r.batch_id=target_batch;
END;
$$;