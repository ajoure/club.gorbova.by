-- The product binding completed in the previous migration exposed one existing
-- draft in the "Закрой год" pipeline. Its current first stage is "Новая";
-- make that stage the explicit pending default without moving the order.
DO $$
DECLARE
  target_pipeline uuid := 'a0000001-0000-0000-0000-000000000003';
  target_stage uuid := 'b0000001-0003-0000-0000-000000000001';
  target_product uuid := 'df723cf1-b0f9-4c38-93ff-4495e53e37fc';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id=target_stage AND s.pipeline_id=target_pipeline
      AND s.name='Новая' AND s.stage_type='open' AND s.order_index=0
  ) OR EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.pipeline_id=target_pipeline AND s.is_default AND s.id<>target_stage
  ) OR NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_product_bindings b
    WHERE b.product_id=target_product AND b.pipeline_id=target_pipeline
  ) OR (SELECT count(*) FROM public.orders_v2 o
        WHERE NOT coalesce(o.is_deleted,false) AND o.product_id=target_product
          AND o.status='draft' AND o.pipeline_id=target_pipeline
          AND o.pipeline_stage_id=target_stage) <> 1 THEN
    RAISE EXCEPTION 'crm_remaining_pending_default_drift';
  END IF;

  UPDATE public.crm_pipeline_stages SET is_default=true
  WHERE id=target_stage AND NOT is_default;

  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
  VALUES('system','crm.routing.pending_stage_completed','crm_pipelines',target_pipeline,
    jsonb_build_object('stage_id',target_stage,'stage_name','Новая','reason','remaining_bound_draft'));
END;
$$;