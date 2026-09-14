-- Complete the reviewed CRM routing configuration without moving historic
-- orders. The three first stages are the natural entry stages (order_index=0)
-- and the six product-to-pipeline pairs are proven by their sole current
-- pipeline placement. Every expected count is a drift gate.
DO $$
DECLARE
  invalid_count integer;
  r record;
BEGIN
  WITH expected(product_id, pipeline_id, order_count) AS (
    VALUES
      ('11309c6a-6617-4c7f-8e92-df6a342ea6eb'::uuid, 'a0000001-0000-0000-0000-000000000002'::uuid, 46),
      ('9992e0ec-8d84-4b17-9db8-80836401a43d'::uuid, '01fa1b68-b966-4ca8-ae42-6dec08e3d1c8'::uuid, 2),
      ('df723cf1-b0f9-4c38-93ff-4495e53e37fc'::uuid, 'a0000001-0000-0000-0000-000000000003'::uuid, 1),
      ('62a522a5-41de-4c1c-9ff2-a2c7af26ef1a'::uuid, 'e8606cb2-2fe4-443e-919d-069cc3476904'::uuid, 1),
      ('84055f12-1d68-4e1b-b1d5-4bcda388ab52'::uuid, 'e8606cb2-2fe4-443e-919d-069cc3476904'::uuid, 1),
      ('a2a9b9ad-4fe7-4bd8-ac92-fb02757be042'::uuid, 'e8606cb2-2fe4-443e-919d-069cc3476904'::uuid, 1)
  )
  SELECT count(*) INTO invalid_count
  FROM expected e
  WHERE NOT EXISTS (SELECT 1 FROM public.products_v2 p WHERE p.id=e.product_id)
     OR EXISTS (SELECT 1 FROM public.crm_pipeline_product_bindings b WHERE b.product_id=e.product_id)
     OR (SELECT count(*) FROM public.orders_v2 o
         WHERE NOT coalesce(o.is_deleted,false) AND o.product_id=e.product_id) <> e.order_count
     OR EXISTS (SELECT 1 FROM public.orders_v2 o
         WHERE NOT coalesce(o.is_deleted,false) AND o.product_id=e.product_id
           AND o.pipeline_id IS DISTINCT FROM e.pipeline_id);
  IF invalid_count <> 0 THEN
    RAISE EXCEPTION 'crm_product_pipeline_binding_drift:%', invalid_count;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('a0000001-0000-0000-0000-000000000004'::uuid, 'b0000001-0004-0000-0000-000000000001'::uuid, 'b0000001-0004-0000-0000-000000000003'::uuid, 'b0000001-0004-0000-0000-000000000004'::uuid, 'Новая'::text),
      ('a0000001-0000-0000-0000-000000000015'::uuid, 'b0000001-0015-0000-0000-000000000001'::uuid, 'b0000001-0015-0000-0000-000000000003'::uuid, 'b0000001-0015-0000-0000-000000000004'::uuid, 'Новая'::text),
      ('a0000001-0000-0000-0000-000000000001'::uuid, 'b0000001-0001-0000-0000-000000000001'::uuid, 'b0000001-0001-0000-0000-000000000003'::uuid, 'b0000001-0001-0000-0000-000000000004'::uuid, 'Регистрация'::text)
    ) AS x(pipeline_id, pending_stage_id, won_stage_id, lost_stage_id, pending_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.crm_pipeline_stages s
      WHERE s.id=r.pending_stage_id AND s.pipeline_id=r.pipeline_id
        AND s.stage_type='open' AND s.order_index=0 AND s.name=r.pending_name
    ) OR NOT EXISTS (
      SELECT 1 FROM public.crm_pipeline_stages s
      WHERE s.id=r.won_stage_id AND s.pipeline_id=r.pipeline_id AND s.stage_type='closed_won'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.crm_pipeline_stages s
      WHERE s.id=r.lost_stage_id AND s.pipeline_id=r.pipeline_id AND s.stage_type='closed_lost'
    ) OR EXISTS (
      SELECT 1 FROM public.crm_pipeline_stages s
      WHERE s.pipeline_id=r.pipeline_id AND s.is_default AND s.id<>r.pending_stage_id
    ) THEN
      RAISE EXCEPTION 'crm_pending_stage_config_drift:%', r.pipeline_id;
    END IF;
    UPDATE public.crm_pipeline_stages SET is_default=true
    WHERE id=r.pending_stage_id AND NOT is_default;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','crm.routing.pending_stage_completed','crm_pipelines',r.pipeline_id,
        jsonb_build_object('stage_id',r.pending_stage_id,'stage_name',r.pending_name));
  END LOOP;

  INSERT INTO public.crm_pipeline_product_bindings(pipeline_id,product_id,metadata)
  VALUES
    ('a0000001-0000-0000-0000-000000000002','11309c6a-6617-4c7f-8e92-df6a342ea6eb','{"source":"crm_sprint_20260914","reason":"sole_current_pipeline"}'),
    ('01fa1b68-b966-4ca8-ae42-6dec08e3d1c8','9992e0ec-8d84-4b17-9db8-80836401a43d','{"source":"crm_sprint_20260914","reason":"sole_current_pipeline"}'),
    ('a0000001-0000-0000-0000-000000000003','df723cf1-b0f9-4c38-93ff-4495e53e37fc','{"source":"crm_sprint_20260914","reason":"sole_current_pipeline"}'),
    ('e8606cb2-2fe4-443e-919d-069cc3476904','62a522a5-41de-4c1c-9ff2-a2c7af26ef1a','{"source":"crm_sprint_20260914","reason":"sole_current_pipeline"}'),
    ('e8606cb2-2fe4-443e-919d-069cc3476904','84055f12-1d68-4e1b-b1d5-4bcda388ab52','{"source":"crm_sprint_20260914","reason":"sole_current_pipeline"}'),
    ('e8606cb2-2fe4-443e-919d-069cc3476904','a2a9b9ad-4fe7-4bd8-ac92-fb02757be042','{"source":"crm_sprint_20260914","reason":"sole_current_pipeline"}');

  INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
  SELECT 'system','crm.routing.product_binding_completed','products_v2',e.product_id,
    jsonb_build_object('pipeline_id',e.pipeline_id,'reason','sole_current_pipeline')
  FROM (VALUES
    ('11309c6a-6617-4c7f-8e92-df6a342ea6eb'::uuid, 'a0000001-0000-0000-0000-000000000002'::uuid),
    ('9992e0ec-8d84-4b17-9db8-80836401a43d'::uuid, '01fa1b68-b966-4ca8-ae42-6dec08e3d1c8'::uuid),
    ('df723cf1-b0f9-4c38-93ff-4495e53e37fc'::uuid, 'a0000001-0000-0000-0000-000000000003'::uuid),
    ('62a522a5-41de-4c1c-9ff2-a2c7af26ef1a'::uuid, 'e8606cb2-2fe4-443e-919d-069cc3476904'::uuid),
    ('84055f12-1d68-4e1b-b1d5-4bcda388ab52'::uuid, 'e8606cb2-2fe4-443e-919d-069cc3476904'::uuid),
    ('a2a9b9ad-4fe7-4bd8-ac92-fb02757be042'::uuid, 'e8606cb2-2fe4-443e-919d-069cc3476904'::uuid)
  ) AS e(product_id,pipeline_id);
END;
$$;
