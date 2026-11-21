-- Bulk audience facts preserve the existing single-profile proof/evaluator as a reference.
-- Helpers are private, owner-only, and called by the existing authorized public wrappers.
CREATE SCHEMA IF NOT EXISTS private;
CREATE OR REPLACE FUNCTION private.telegram_funnel_bulk_facts(p_segment jsonb)
RETURNS TABLE(profile_id uuid,facts jsonb) LANGUAGE plpgsql STABLE SET search_path='' AS $bulk$
DECLARE bought uuid[];attended uuid[];accessed uuid[];need_tags boolean;
BEGIN
 PERFORM public.telegram_funnel_validate_segment(p_segment);
 WITH RECURSIVE nodes(n)AS(SELECT p_segment->'root' UNION ALL SELECT child FROM nodes CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN n?'op' THEN n->'args' ELSE '[]'::jsonb END)child)
 SELECT coalesce(array_agg(DISTINCT(n->>'product_id')::uuid)FILTER(WHERE n->>'kind' IN('year','cohort') OR(n->>'kind'='product' AND n->>'relation' IN('purchased','attended'))),'{}'),
 coalesce(array_agg(DISTINCT(n->>'product_id')::uuid)FILTER(WHERE n->>'kind' IN('year','cohort') OR(n->>'kind'='product' AND n->>'relation'='attended')),'{}'),
 coalesce(array_agg(DISTINCT(n->>'product_id')::uuid)FILTER(WHERE n->>'kind'='product' AND n->>'relation'='active_access'),'{}'),
 coalesce(bool_or(n->>'kind'='tag'),false) INTO bought,attended,accessed,need_tags FROM nodes;
 RETURN QUERY
 WITH p AS MATERIALIZED(SELECT pr.* FROM public.profiles pr WHERE pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL),
 order_links AS MATERIALIZED(
 SELECT p.id pid,o.id oid FROM p JOIN public.orders_v2 o ON o.profile_id=p.id WHERE o.product_id=ANY(bought)
 UNION SELECT p.id,o.id FROM p JOIN public.orders_v2 o ON p.user_id IS NOT NULL AND o.user_id=p.user_id WHERE o.product_id=ANY(bought)),
 refunds AS MATERIALIZED(SELECT DISTINCT pm.order_id FROM public.payments_v2 pm WHERE cardinality(bought)>0 AND pm.is_deleted IS NOT TRUE AND(pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund')),
 money AS MATERIALIZED(SELECT pm.order_id,pm.currency,sum(pm.amount)amount FROM public.payments_v2 pm WHERE cardinality(bought)>0 AND pm.is_deleted IS NOT TRUE AND pm.status::text='succeeded' AND pm.amount>0 GROUP BY pm.order_id,pm.currency),
 candidate AS MATERIALIZED(SELECT links.pid,o.* FROM order_links links JOIN public.orders_v2 o ON o.id=links.oid WHERE true
 AND o.is_deleted IS NOT TRUE AND o.status::text='paid' AND NOT coalesce(o.is_trial,false)
 AND coalesce(o.meta->>'financial_kind','') NOT IN('gift','test','sandbox','referral_redemption')
 AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'is_gift','false')<>'true'
 AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected' AND NOT coalesce(o.meta,'{}')?'rejected_at'
 AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
 AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.order_id=o.id)
),purchases AS MATERIALIZED(SELECT o.* FROM candidate o LEFT JOIN money m ON m.order_id=o.id AND m.currency=o.currency WHERE(o.final_price>0 AND coalesce(m.amount,0)>=o.final_price)
 OR(o.reconcile_source='owner_confirmed_historical' AND o.meta->>'history_only'='true' AND o.meta->>'owner_confirmed_paid'='true' AND nullif(o.meta->>'historical_batch_id','') IS NOT NULL AND nullif(o.meta->>'historical_idempotency_key','') IS NOT NULL AND jsonb_typeof(o.meta->'source_refs')='array' AND jsonb_array_length(o.meta->'source_refs')>0)
 OR(o.deal_date IS NOT NULL AND ((o.meta->>'import_source'='patch4' AND nullif(o.meta->>'gc_deal_id','') IS NOT NULL) OR(o.meta->>'import_source'='csv_active_import' AND nullif(o.meta->>'source_file','') IS NOT NULL AND o.meta?'source_row_num') OR(o.meta->>'import_source'='revision_7101ed3c' AND o.product_id='7101ed3c-7839-4a74-ad95-aa0660369b22'::uuid)))
),entitlement_links AS MATERIALIZED(
 SELECT p.id pid,e.id eid FROM p JOIN public.entitlements e ON e.profile_id=p.id WHERE e.product_id=ANY(attended||accessed)
 UNION SELECT p.id,e.id FROM p JOIN public.entitlements e ON p.user_id IS NOT NULL AND e.user_id=p.user_id WHERE e.product_id=ANY(attended||accessed)),
 subscription_links AS MATERIALIZED(
 SELECT p.id pid,s.id sid FROM p JOIN public.subscriptions_v2 s ON s.profile_id=p.id WHERE s.product_id=ANY(attended||accessed)
 UNION SELECT p.id,s.id FROM p JOIN public.subscriptions_v2 s ON p.user_id IS NOT NULL AND s.user_id=p.user_id WHERE s.product_id=ANY(attended||accessed)),
 enrollments AS(
 SELECT ep.pid,e.product_id,NULL::uuid tariff_id,o.flow_id FROM entitlement_links ep JOIN public.entitlements e ON e.id=ep.eid LEFT JOIN public.orders_v2 o ON o.id=e.order_id
 WHERE e.status IN('active','expired') AND coalesce(e.meta->>'source_type','') NOT IN('test','sandbox','trial') AND coalesce(e.meta->>'is_test','false')<>'true'
 AND coalesce(e.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
 AND(coalesce(e.meta->>'granted_by','')<>'rule_engine_product_access' OR(e.meta->>'historical_purchase_type'='base_tariff_purchase' AND EXISTS(SELECT 1 FROM purchases proof WHERE proof.pid=ep.pid AND proof.id::text=e.meta->>'prior_purchase_order_id' AND proof.product_id=e.product_id)))
 AND(e.order_id IS NULL OR(o.id IS NOT NULL AND o.is_deleted IS NOT TRUE AND o.status::text IN('paid','partial') AND NOT coalesce(o.is_trial,false) AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected' AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase') AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.order_id=o.id))) AND e.product_id=ANY(attended)
 UNION ALL SELECT sp.pid,sub.product_id,sub.tariff_id,coalesce(sub.flow_id,o.flow_id) FROM subscription_links sp JOIN public.subscriptions_v2 sub ON sub.id=sp.sid LEFT JOIN public.orders_v2 o ON o.id=sub.order_id
 WHERE sub.status::text IN('active','expired','superseded') AND sub.access_start_at<=statement_timestamp() AND NOT coalesce(sub.is_trial,false)
 AND coalesce(sub.meta->>'source_type','') NOT IN('test','sandbox','trial','rule_engine') AND coalesce(sub.meta->>'is_test','false')<>'true'
 AND coalesce(sub.meta->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
 AND(sub.order_id IS NULL OR(o.id IS NOT NULL AND o.is_deleted IS NOT TRUE AND o.status::text IN('paid','partial') AND NOT coalesce(o.is_trial,false) AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected' AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase') AND NOT EXISTS(SELECT 1 FROM refunds r WHERE r.order_id=o.id))) AND sub.product_id=ANY(attended)
 UNION ALL SELECT pid,product_id,tariff_id,flow_id FROM purchases WHERE product_id=ANY(attended) AND reconcile_source='owner_confirmed_historical' AND purchase_snapshot->>'historical_purchase_type'='base_tariff_purchase'
),access AS(
 SELECT ep.pid,e.product_id,NULL::uuid tariff_id FROM entitlement_links ep JOIN public.entitlements e ON e.id=ep.eid WHERE e.product_id=ANY(accessed) AND e.status='active' AND(e.expires_at IS NULL OR e.expires_at>statement_timestamp())
 UNION ALL SELECT sp.pid,s.product_id,s.tariff_id FROM subscription_links sp JOIN public.subscriptions_v2 s ON s.id=sp.sid WHERE s.product_id=ANY(accessed) AND s.status::text='active' AND s.access_start_at<=statement_timestamp() AND s.access_end_at>statement_timestamp()
),purchase_json AS(SELECT pid,jsonb_agg(jsonb_build_object('product_id',product_id,'tariff_id',tariff_id))v FROM purchases GROUP BY pid),
 enrollment_json AS(SELECT e.pid,jsonb_agg(jsonb_build_object('product_id',e.product_id,'tariff_id',e.tariff_id,'flow_id',e.flow_id,'year',extract(year FROM fl.start_date AT TIME ZONE 'Europe/Minsk')::int))v FROM enrollments e LEFT JOIN public.flows fl ON fl.id=e.flow_id GROUP BY e.pid),
 access_json AS(SELECT pid,jsonb_agg(jsonb_build_object('product_id',product_id,'tariff_id',tariff_id))v FROM access GROUP BY pid),
 tag_json AS(SELECT t.profile_id pid,jsonb_agg(t.tag ORDER BY t.tag)v FROM public.telegram_funnel_profile_tags t WHERE need_tags GROUP BY t.profile_id)
 SELECT p.id,jsonb_build_object('purchases',coalesce(pj.v,'[]'),'participations',coalesce(ej.v,'[]'),'active_access',coalesce(aj.v,'[]'),'tags',coalesce(tj.v,'[]'),
 'fields',jsonb_build_object('country',p.country,'city',p.city,'source',p.source,'status',p.status,'marketing_consent',p.marketing_consent,'was_club_member',p.was_club_member))
 FROM p LEFT JOIN purchase_json pj ON pj.pid=p.id LEFT JOIN enrollment_json ej ON ej.pid=p.id LEFT JOIN access_json aj ON aj.pid=p.id LEFT JOIN tag_json tj ON tj.pid=p.id;
END $bulk$;
CREATE OR REPLACE FUNCTION private.telegram_funnel_matching_profiles(p_segment jsonb) RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT f.profile_id FROM private.telegram_funnel_bulk_facts(p_segment)f WHERE public.telegram_funnel_segment_evaluate(p_segment->'root',f.facts);
$$;
REVOKE ALL ON FUNCTION private.telegram_funnel_bulk_facts(jsonb),private.telegram_funnel_matching_profiles(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.telegram_funnel_audience_service(p_segment jsonb,p_bot uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.telegram_funnel_validate_segment(p_segment);
 IF p_offset IS NULL OR p_limit IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_bot_unavailable';END IF;
 WITH matches AS MATERIALIZED(SELECT pr.* FROM private.telegram_funnel_matching_profiles(p_segment)m JOIN public.profiles pr ON pr.id=m),
 dialog_tg AS MATERIALIZED(SELECT DISTINCT tm.telegram_user_id FROM public.telegram_messages tm WHERE tm.bot_id=p_bot AND tm.transport='bot' AND(tm.direction='incoming' OR tm.status IN('sent','delivered'))),
 matched AS MATERIALIZED(SELECT pr.id profile_id,pr.user_id,pr.full_name,(pr.telegram_user_id>0 AND((pr.telegram_link_bot_id=p_bot AND pr.telegram_link_status='active') OR dt.telegram_user_id IS NOT NULL))IS TRUE has_dialog FROM matches pr LEFT JOIN dialog_tg dt ON dt.telegram_user_id=pr.telegram_user_id) ,
 paged AS(SELECT * FROM matched ORDER BY profile_id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),'available_count',(SELECT count(*) FROM matched WHERE has_dialog),'recipients',coalesce((SELECT jsonb_agg(to_jsonb(pg) ORDER BY profile_id) FROM paged pg),'[]')) INTO result;RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_prepare_audience(p_launch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;ids uuid[];result jsonb;
BEGIN
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND OR l.status<>'active' THEN RAISE EXCEPTION 'funnel_launch_stopped';END IF;
 IF l.prepared_at IS NOT NULL THEN RETURN jsonb_build_object('state','already_prepared');END IF;
 PERFORM public.telegram_funnel_validate_segment(l.audience_filters);
 IF l.test_profile_id IS NOT NULL THEN ids:=ARRAY[l.test_profile_id]; ELSE
 SELECT coalesce(array_agg(m ORDER BY m),'{}') INTO ids FROM private.telegram_funnel_matching_profiles(l.audience_filters)m;
 END IF;
 result:=public.telegram_funnel_enroll(l.id,ids);UPDATE public.telegram_funnel_launches SET prepared_at=now() WHERE id=l.id;
 RETURN jsonb_build_object('state','prepared','selected',cardinality(ids));
END $$;

-- One lifecycle fence per funnel replaces unbounded per-recipient advisory locks.
-- Lock order: launch -> funnel fence -> enrollment rows ordered by profile/id.
-- Transport/callback functions keep their existing enrollment -> delivery order.
CREATE OR REPLACE FUNCTION public.telegram_funnel_enroll(p_launch uuid,p_profiles uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;ids uuid[];new_ids uuid[];immediate boolean;result jsonb;
BEGIN
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND OR l.status<>'active' THEN RAISE EXCEPTION 'funnel_launch_stopped';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram_funnel_lifecycle:'||l.funnel_id::text,0));
 SELECT coalesce(array_agg(pr.id ORDER BY pr.id),'{}')INTO ids FROM public.profiles pr WHERE pr.id=ANY(p_profiles) AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL;
 SELECT coalesce(array_agg(pid ORDER BY pid),'{}')INTO new_ids FROM unnest(ids)pid WHERE NOT EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments en WHERE en.launch_id=l.id AND en.profile_id=pid);
 immediate:=l.scheduled_for<=now();
 IF immediate THEN
  PERFORM 1 FROM public.telegram_funnel_enrollments en WHERE en.funnel_id=l.funnel_id AND en.profile_id=ANY(new_ids) ORDER BY en.profile_id,en.id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=ANY(new_ids) AND d.status IN('sending','unknown'))THEN RAISE EXCEPTION 'funnel_unresolved_delivery';END IF;
 END IF;
 WITH existing AS MATERIALIZED(SELECT en.id,en.profile_id,d.id delivery_id FROM public.telegram_funnel_enrollments en LEFT JOIN public.telegram_funnel_deliveries d ON d.enrollment_id=en.id AND d.transition_key='start' WHERE en.launch_id=l.id AND en.profile_id=ANY(ids)),
 old_active AS MATERIALIZED(SELECT en.id,en.profile_id FROM public.telegram_funnel_enrollments en WHERE immediate AND en.funnel_id=l.funnel_id AND en.profile_id=ANY(new_ids) AND en.status='active'),
 stopped AS(UPDATE public.telegram_funnel_enrollments en SET status='stopped',reason='explicit_restart',stopped_at=now() FROM old_active o WHERE en.id=o.id AND l.restart_existing RETURNING en.id),
 revoke_old AS(UPDATE public.telegram_funnel_callback_tokens t SET revoked_at=now() WHERE t.enrollment_id IN(SELECT id FROM stopped)),
 skip_old AS(UPDATE public.telegram_funnel_deliveries d SET status='skipped',error_code='explicit_restart' WHERE d.enrollment_id IN(SELECT id FROM stopped) AND d.status='queued'),
 restart_events AS(INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)SELECT id,'restart:'||l.id::text||':'||id::text,'restarted' FROM stopped ON CONFLICT(event_key)DO NOTHING),
 dialog_tg AS MATERIALIZED(SELECT DISTINCT tm.telegram_user_id FROM public.telegram_messages tm WHERE tm.bot_id=l.bot_id AND tm.transport='bot' AND(tm.direction='incoming' OR tm.status IN('sent','delivered'))),
 admission AS MATERIALIZED(SELECT pr.*,gen_random_uuid()eid,gen_random_uuid()did,o.id old_id,
 (pr.telegram_user_id>0 AND((pr.telegram_link_bot_id=l.bot_id AND pr.telegram_link_status='active') OR dt.telegram_user_id IS NOT NULL))IS TRUE has_dialog
 FROM public.profiles pr LEFT JOIN old_active o ON o.profile_id=pr.id LEFT JOIN dialog_tg dt ON dt.telegram_user_id=pr.telegram_user_id CROSS JOIN(SELECT count(*)FROM stopped)stopped_barrier WHERE pr.id=ANY(new_ids)),
 planned AS MATERIALIZED(SELECT a.*,CASE WHEN a.old_id IS NOT NULL AND NOT l.restart_existing THEN 'skipped' WHEN NOT has_dialog THEN 'skipped' WHEN NOT immediate THEN 'scheduled' ELSE 'active' END state,
 CASE WHEN a.old_id IS NOT NULL AND NOT l.restart_existing THEN 'already_active' WHEN NOT has_dialog THEN 'no_available_telegram_dialog' WHEN NOT immediate THEN 'waiting_until_due' ELSE NULL END why FROM admission a),
 inserted AS(INSERT INTO public.telegram_funnel_enrollments(id,launch_id,funnel_id,profile_id,user_id,bot_id,telegram_user_id,chat_id,status,reason)
 SELECT eid,l.id,l.funnel_id,id,user_id,l.bot_id,telegram_user_id,telegram_user_id,state,why FROM planned RETURNING id,profile_id),
 starts AS(INSERT INTO public.telegram_funnel_deliveries(id,enrollment_id,transition_key,block_id)SELECT p.did,i.id,'start',(l.graph_snapshot->>'start_block_id')::uuid FROM planned p JOIN inserted i ON i.id=p.eid WHERE p.state IN('active','scheduled') RETURNING id),
 enroll_events AS(INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind,detail)SELECT i.id,CASE WHEN p.why='already_active' THEN 'skip:' ELSE 'enroll:' END||i.id::text,CASE WHEN p.why='already_active' THEN 'skipped' ELSE 'enrolled' END,CASE WHEN p.why='already_active' THEN jsonb_build_object('reason','already_active')ELSE jsonb_build_object('no_dialog',NOT p.has_dialog)END FROM inserted i JOIN planned p ON p.eid=i.id),
 results AS(SELECT e.profile_id,jsonb_build_object('enrollment_id',e.id,'delivery_id',e.delivery_id,'duplicate',true)v FROM existing e
 UNION ALL SELECT p.id,CASE WHEN p.why='already_active' THEN jsonb_build_object('enrollment_id',i.id,'profile_id',p.id,'skipped','already_active')ELSE jsonb_build_object('enrollment_id',i.id,'delivery_id',CASE WHEN p.state IN('active','scheduled')THEN p.did END,'skipped',NOT p.has_dialog)END FROM inserted i JOIN planned p ON p.eid=i.id CROSS JOIN(SELECT count(*)FROM starts)start_barrier)
 SELECT coalesce(jsonb_agg(v ORDER BY profile_id),'[]')INTO result FROM results;RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.telegram_funnel_activate_due(p_launch uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;e public.telegram_funnel_enrollments;old public.telegram_funnel_enrollments;activated integer:=0;batch_ids uuid[];fence_id uuid;
BEGIN
 -- Select a bounded batch, then acquire every launch lock before any lifecycle fence.
 SELECT array_agg(id)INTO batch_ids FROM(SELECT ln.id FROM public.telegram_funnel_launches ln WHERE ln.status='active' AND ln.scheduled_for<=now() AND(p_launch IS NULL OR ln.id=p_launch) AND EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments en WHERE en.launch_id=ln.id AND en.status='scheduled') ORDER BY ln.scheduled_for,ln.id LIMIT 10)due;
 PERFORM 1 FROM public.telegram_funnel_launches WHERE id=ANY(batch_ids)ORDER BY id FOR UPDATE;
 FOR fence_id IN SELECT DISTINCT funnel_id FROM public.telegram_funnel_launches WHERE id=ANY(batch_ids)ORDER BY funnel_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram_funnel_lifecycle:'||fence_id::text,0));
 END LOOP;
 FOR l IN SELECT ln.* FROM public.telegram_funnel_launches ln WHERE ln.id=ANY(batch_ids)AND ln.status='active'AND ln.scheduled_for<=now()ORDER BY ln.scheduled_for,ln.id LOOP
 FOR e IN SELECT en.* FROM public.telegram_funnel_enrollments en WHERE en.launch_id=l.id AND en.status='scheduled' ORDER BY en.profile_id LIMIT 200 LOOP
  SELECT * INTO e FROM public.telegram_funnel_enrollments WHERE id=e.id FOR UPDATE;
  IF e.status<>'scheduled' THEN CONTINUE;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=e.profile_id AND pr.user_id IS NOT DISTINCT FROM e.user_id AND pr.telegram_user_id=e.telegram_user_id AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL) OR NOT public.telegram_funnel_known_dialog(e.profile_id,l.bot_id) THEN
   UPDATE public.telegram_funnel_enrollments SET status='skipped',reason='recipient_binding_changed' WHERE id=e.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE enrollment_id=e.id AND status='queued';CONTINUE;
  END IF;
  SELECT * INTO old FROM public.telegram_funnel_enrollments WHERE funnel_id=l.funnel_id AND profile_id=e.profile_id AND status='active' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=e.profile_id AND d.status IN('sending','unknown')) THEN
   UPDATE public.telegram_funnel_enrollments SET reason='prior_delivery_unresolved' WHERE id=e.id;CONTINUE;
  END IF;
  IF old.id IS NOT NULL AND NOT l.restart_existing THEN
   UPDATE public.telegram_funnel_enrollments SET status='skipped',reason='already_active' WHERE id=e.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='already_active' WHERE enrollment_id=e.id AND status='queued';CONTINUE;
  END IF;
  IF old.id IS NOT NULL THEN
   UPDATE public.telegram_funnel_enrollments SET status='stopped',reason='explicit_restart',stopped_at=now() WHERE id=old.id;
   UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=old.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='explicit_restart' WHERE enrollment_id=old.id AND status='queued';
   INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)VALUES(old.id,'restart:'||l.id::text||':'||old.id::text,'restarted')ON CONFLICT(event_key)DO NOTHING;
  END IF;
  UPDATE public.telegram_funnel_enrollments SET status='active',reason=NULL WHERE id=e.id;
  INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)VALUES(e.id,'activate:'||e.id::text,'activated')ON CONFLICT(event_key)DO NOTHING;
  activated:=activated+1;
 END LOOP;END LOOP;RETURN activated;
END $$;

-- Stop writers join the same lifecycle fence without reversing launch order.
CREATE OR REPLACE FUNCTION public.telegram_funnel_stop_launch(p_launch uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;l public.telegram_funnel_launches;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('telegram_funnel_lifecycle:'||l.funnel_id::text,0));
 UPDATE public.telegram_funnel_launches SET status='stopped' WHERE id=p_launch;
 FOR e IN SELECT id FROM public.telegram_funnel_enrollments WHERE launch_id=p_launch ORDER BY profile_id,id FOR UPDATE LOOP
  UPDATE public.telegram_funnel_enrollments SET status='stopped',stopped_at=now() WHERE id=e.id AND status IN('active','scheduled');
  UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=e.id;
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='stopped' WHERE enrollment_id=e.id AND status='queued';
  INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind) VALUES(e.id,'stop:'||e.id::text,'stopped') ON CONFLICT(event_key) DO NOTHING;
 END LOOP;
END $$;


CREATE OR REPLACE FUNCTION public.telegram_funnel_save(p_id uuid,p_expected_revision integer,p_name text,p_start uuid,p_blocks jsonb,p_status text)
RETURNS public.telegram_funnels LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels; l record;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 IF p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'funnel_revision_required'; END IF;
 PERFORM public.telegram_funnel_validate_graph(p_start,p_blocks);
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_id FOR UPDATE;
 IF FOUND THEN
  IF f.revision<>p_expected_revision THEN RAISE EXCEPTION 'funnel_revision_changed'; END IF;
  UPDATE public.telegram_funnels SET name=p_name,start_block_id=p_start,blocks=p_blocks,status=p_status,revision=revision+1,updated_at=now() WHERE id=p_id RETURNING * INTO f;
 ELSE
  IF p_expected_revision<>0 THEN RAISE EXCEPTION 'funnel_revision_changed'; END IF;
  INSERT INTO public.telegram_funnels(id,name,start_block_id,blocks,status,created_by) VALUES(p_id,p_name,p_start,p_blocks,p_status,auth.uid()) RETURNING * INTO f;
 END IF;
 IF p_status='stopped' THEN
  -- Definition-wide stop acquires every launch before the first lifecycle fence.
  PERFORM 1 FROM public.telegram_funnel_launches WHERE funnel_id=f.id AND status='active' ORDER BY id FOR UPDATE;
  FOR l IN SELECT id FROM public.telegram_funnel_launches WHERE funnel_id=f.id AND status='active' ORDER BY id LOOP PERFORM public.telegram_funnel_stop_launch(l.id);END LOOP;END IF;
 RETURN f;
END $$;
