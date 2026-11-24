-- Approved by Sergey q2df66f, 2026-11-24. One atomic idempotent operation.
-- NO sends, launches, transport calls, payment changes or access grants.
BEGIN;
DO $once$
DECLARE pipeline constant uuid:='615be9f5-e621-4124-a996-35509915005f'; product constant uuid:='e71c0dbb-baf2-4b6c-a950-bf0f728708af';
 campaign constant text:='zg27-telegram-20261124'; snapshot jsonb; r record; f record; sid uuid; stage_map jsonb; batch integer; created integer:=0; hash_before text; hash_after text; repeat_count integer; first_count integer; overlap_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(campaign,0));
 IF EXISTS(SELECT 1 FROM public.audit_logs WHERE action='zg27_telegram_cohorts_import_complete' AND entity_id=campaign) THEN RETURN;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_pipelines WHERE id=pipeline AND name='Закрой год 2027') OR NOT EXISTS(SELECT 1 FROM public.products_v2 WHERE id=product AND btrim(name)='ЗАКРОЙ ГОД 2027') THEN RAISE EXCEPTION 'zg27_target_mismatch';END IF;
 IF EXISTS(SELECT 1 FROM public.orders_v2 WHERE pipeline_id=pipeline AND NOT is_deleted) OR EXISTS(SELECT 1 FROM public.crm_pipeline_automation_rules WHERE pipeline_id=pipeline AND status='active') THEN RAISE EXCEPTION 'zg27_pipeline_not_empty_or_automation_active';END IF;
 LOCK TABLE public.telegram_funnel_profile_tags IN SHARE MODE;
 CREATE TEMP TABLE zg27_cohort_candidates ON COMMIT DROP AS
 SELECT t.profile_id,bool_or(t.tag IN('ЦБ 2.0 + Закрой год','ЦБ 1.0 + Закрой год')) repeat,bool_or(t.tag='ЦБ 2.0, без Закрой год') first
 FROM public.telegram_funnel_profile_tags t WHERE t.tag IN('ЦБ 2.0 + Закрой год','ЦБ 1.0 + Закрой год','ЦБ 2.0, без Закрой год') GROUP BY t.profile_id;
 SELECT count(*) FILTER(WHERE repeat),count(*) FILTER(WHERE first),count(*) FILTER(WHERE repeat AND first),md5(string_agg(profile_id::text,',' ORDER BY profile_id)) INTO repeat_count,first_count,overlap_count,hash_before FROM zg27_cohort_candidates;
 IF repeat_count<>162 OR first_count<>94 OR overlap_count<>0 OR EXISTS(SELECT 1 FROM zg27_cohort_candidates c JOIN public.profiles p ON p.id=c.profile_id WHERE p.is_archived OR p.status='archived' OR p.merged_to_profile_id IS NOT NULL) THEN RAISE EXCEPTION 'zg27_cohort_count_mismatch';END IF;
 snapshot:=jsonb_build_object('repeat',repeat_count,'first',first_count,'overlap',overlap_count,'profile_set_hash',hash_before,'pipeline_deals',0,'paid_profiles',(SELECT count(*) FROM zg27_cohort_candidates WHERE public.telegram_funnel_crm_has_paid(profile_id,product)),'funnel_graph_hash',(SELECT md5(string_agg(id::text||blocks::text,',' ORDER BY id)) FROM public.telegram_funnels));
 INSERT INTO public.audit_logs(action,actor_type,entity_type,entity_id,meta) VALUES('zg27_telegram_cohorts_import_before','system','pipeline',campaign,snapshot);
 -- Preserve existing stage IDs, add exactly eight intermediate message stages.
 IF (SELECT count(*) FROM public.crm_pipeline_stages WHERE pipeline_id=pipeline)<>4 OR NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages WHERE id='c47ca858-add4-4f3c-b09c-471a77f0c1d9' AND pipeline_id=pipeline AND name='Новая') OR NOT EXISTS(SELECT 1 FROM public.crm_pipeline_stages WHERE id='1b5865a2-4cc0-4312-a895-87713e6425d8' AND pipeline_id=pipeline AND name='В работе') THEN RAISE EXCEPTION 'zg27_stage_snapshot_mismatch';END IF;
 UPDATE public.crm_pipeline_stages SET order_index=order_index+100 WHERE pipeline_id=pipeline;
 UPDATE public.crm_pipeline_stages SET name='Сегмент для продаж',order_index=0 WHERE id='c47ca858-add4-4f3c-b09c-471a77f0c1d9';
 UPDATE public.crm_pipeline_stages SET name='Сообщение 1',order_index=1 WHERE id='1b5865a2-4cc0-4312-a895-87713e6425d8';
 FOR batch IN 2..9 LOOP
  INSERT INTO public.crm_pipeline_stages(id,pipeline_id,name,order_index,stage_type) VALUES(md5(campaign||':message:'||batch)::uuid,pipeline,'Сообщение '||batch,batch,'open');
 END LOOP;
 UPDATE public.crm_pipeline_stages SET name='Отказ',order_index=10 WHERE id='b7e5ca02-37d3-42dd-a4ce-33cb79e52ed0' AND pipeline_id=pipeline;
 UPDATE public.crm_pipeline_stages SET name='Оплатили',order_index=11 WHERE id='a718bf28-f445-4555-89f2-9494a1f0aa08' AND pipeline_id=pipeline;
 FOR f IN SELECT * FROM public.telegram_funnels WHERE id IN('1edf4ce9-ad2f-40b9-8591-3bf540df7d15','84bf5843-9f96-4ee3-98b6-f29e3043ac50','54d7da56-1ed6-40ba-88af-a445d9ed8339','8ae9ee07-dddd-4816-a4cd-831217ce85b8') ORDER BY id LOOP
  IF (f.id='1edf4ce9-ad2f-40b9-8591-3bf540df7d15' AND f.revision<>9) OR (f.id='84bf5843-9f96-4ee3-98b6-f29e3043ac50' AND f.revision<>14) OR (f.id='54d7da56-1ed6-40ba-88af-a445d9ed8339' AND f.revision<>3) OR (f.id='8ae9ee07-dddd-4816-a4cd-831217ce85b8' AND f.revision<>2) THEN RAISE EXCEPTION 'zg27_funnel_revision_mismatch';END IF;
  SELECT jsonb_object_agg(b->>'id',s.id::text) INTO stage_map FROM jsonb_array_elements(f.blocks)WITH ORDINALITY x(b,n) JOIN public.crm_pipeline_stages s ON s.pipeline_id=pipeline AND s.order_index=x.n;
  IF jsonb_array_length(f.blocks)=1 THEN
   SELECT jsonb_object_agg(f.blocks->0->>'id',s.id::text) INTO stage_map
   FROM public.telegram_funnels main CROSS JOIN LATERAL jsonb_array_elements(main.blocks)WITH ORDINALITY b(block,n)
   JOIN public.crm_pipeline_stages s ON s.pipeline_id=pipeline AND s.order_index=b.n
   WHERE main.id=CASE WHEN f.id='54d7da56-1ed6-40ba-88af-a445d9ed8339' THEN '1edf4ce9-ad2f-40b9-8591-3bf540df7d15'::uuid ELSE '84bf5843-9f96-4ee3-98b6-f29e3043ac50'::uuid END
    AND md5(f.blocks->0->>'text')=md5(b.block->>'text');
   IF stage_map IS NULL THEN RAISE EXCEPTION 'zg27_single_message_mapping_missing';END IF;
  END IF;
  INSERT INTO public.telegram_funnel_crm_bindings(funnel_id,pipeline_id,product_id,block_stages,refusal_stage_id,paid_stage_id) VALUES(f.id,pipeline,product,stage_map,'b7e5ca02-37d3-42dd-a4ce-33cb79e52ed0','a718bf28-f445-4555-89f2-9494a1f0aa08');
 END LOOP;
 IF (SELECT count(*) FROM public.telegram_funnel_crm_bindings WHERE pipeline_id=pipeline)<>4 THEN RAISE EXCEPTION 'zg27_funnel_binding_missing';END IF;
 -- Bounded deterministic batches inside the single transaction. Campaign+profile is the identity.
 FOR batch IN 0..5 LOOP
  FOR r IN SELECT c.*,p.user_id FROM zg27_cohort_candidates c JOIN public.profiles p ON p.id=c.profile_id ORDER BY c.profile_id LIMIT 50 OFFSET batch*50 LOOP
   sid:='c47ca858-add4-4f3c-b09c-471a77f0c1d9';
   IF public.telegram_funnel_crm_has_paid(r.profile_id,product) THEN sid:='a718bf28-f445-4555-89f2-9494a1f0aa08';END IF;
   INSERT INTO public.orders_v2(order_number,user_id,profile_id,product_id,base_price,final_price,currency,status,pipeline_id,pipeline_stage_id,campaign_key,creation_batch_id,deal_date,meta)
   SELECT 'TG27-'||r.profile_id::text,r.user_id,r.profile_id,product,0,0,'BYN','pending',pipeline,sid,campaign,md5(campaign)::uuid,now(),jsonb_build_object('source','telegram_funnel_cohort','telegram_funnel_cohort',CASE WHEN r.repeat THEN 'повторные' ELSE 'впервые' END,'title','Закрой год 2027 · '||CASE WHEN r.repeat THEN 'повторные' ELSE 'впервые' END,'authorization','q2df66f')
   WHERE NOT EXISTS(SELECT 1 FROM public.orders_v2 WHERE campaign_key=campaign AND profile_id=r.profile_id AND NOT is_deleted);
   GET DIAGNOSTICS first_count=ROW_COUNT;created:=created+first_count;
  END LOOP;
 END LOOP;
 -- Reconcile only recorded historical outcomes; no callbacks or transport are invoked.
 FOR r IN SELECT DISTINCT e.profile_id,c.pipeline_id,(c.block_stages->>d.block_id::text)::uuid stage_id FROM public.telegram_funnel_events ev JOIN public.telegram_funnel_deliveries d ON d.id=ev.delivery_id AND d.status='sent' JOIN public.telegram_funnel_enrollments e ON e.id=ev.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id AND l.test_profile_id IS NULL JOIN public.telegram_funnel_crm_bindings c ON c.funnel_id=e.funnel_id WHERE ev.kind='sent' AND c.block_stages ? d.block_id::text LOOP
  PERFORM public.telegram_funnel_crm_move(r.profile_id,r.pipeline_id,r.stage_id);
 END LOOP;
 FOR r IN SELECT DISTINCT e.profile_id,c.pipeline_id,c.refusal_stage_id FROM public.telegram_funnel_events ev JOIN public.telegram_funnel_enrollments e ON e.id=ev.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id AND l.test_profile_id IS NULL JOIN public.telegram_funnel_crm_bindings c ON c.funnel_id=e.funnel_id WHERE ev.kind='finished' LOOP
  PERFORM public.telegram_funnel_crm_move(r.profile_id,r.pipeline_id,r.refusal_stage_id);
 END LOOP;
 -- Confirmed prior sends and refusals are reconciled; paid always has priority.
 SELECT md5(string_agg(profile_id::text,',' ORDER BY profile_id)) INTO hash_after FROM public.orders_v2 WHERE campaign_key=campaign AND NOT is_deleted;
 IF created<>256 OR hash_before IS DISTINCT FROM hash_after OR (SELECT count(*) FROM public.orders_v2 WHERE campaign_key=campaign AND NOT is_deleted)<>256 THEN RAISE EXCEPTION 'zg27_import_readback_mismatch';END IF;
 IF snapshot->>'funnel_graph_hash' IS DISTINCT FROM (SELECT md5(string_agg(id::text||blocks::text,',' ORDER BY id)) FROM public.telegram_funnels) THEN RAISE EXCEPTION 'zg27_funnel_graph_changed';END IF;
 INSERT INTO public.audit_logs(action,actor_type,entity_type,entity_id,meta) VALUES('zg27_telegram_cohorts_import_complete','system','pipeline',campaign,snapshot||jsonb_build_object('created',created,'after_profile_set_hash',hash_after,'stage_counts',(SELECT jsonb_object_agg(stage_name,n) FROM (SELECT s.name stage_name,count(*) n FROM public.orders_v2 o JOIN public.crm_pipeline_stages s ON s.id=o.pipeline_stage_id WHERE o.campaign_key=campaign AND NOT o.is_deleted GROUP BY s.name)x)));
END $once$;
COMMIT;
SELECT action,meta FROM public.audit_logs WHERE entity_id='zg27-telegram-20261124' AND action IN('zg27_telegram_cohorts_import_before','zg27_telegram_cohorts_import_complete') ORDER BY created_at;
