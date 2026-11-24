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
 CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b->>'id'=l.graph_snapshot->>'start_block_id' AND b->>'channel'='sms') THEN public.sms_normalize_phone(pr.phone) IS NOT NULL AND row_number()OVER(PARTITION BY public.sms_normalize_phone(pr.phone) ORDER BY(pr.user_id IS NOT NULL)DESC,pr.id)=1 ELSE (pr.telegram_user_id>0 AND((pr.telegram_link_bot_id=l.bot_id AND pr.telegram_link_status='active') OR dt.telegram_user_id IS NOT NULL))IS TRUE END has_dialog
 FROM public.profiles pr LEFT JOIN old_active o ON o.profile_id=pr.id LEFT JOIN dialog_tg dt ON dt.telegram_user_id=pr.telegram_user_id CROSS JOIN(SELECT count(*)FROM stopped)stopped_barrier WHERE pr.id=ANY(new_ids)),
 planned AS MATERIALIZED(SELECT a.*,CASE WHEN a.old_id IS NOT NULL AND NOT l.restart_existing THEN 'skipped' WHEN NOT has_dialog THEN 'skipped' WHEN NOT immediate THEN 'scheduled' ELSE 'active' END state,
 CASE WHEN a.old_id IS NOT NULL AND NOT l.restart_existing THEN 'already_active' WHEN NOT has_dialog THEN 'no_available_telegram_dialog' WHEN NOT immediate THEN 'waiting_until_due' ELSE NULL END why FROM admission a),
 inserted AS(INSERT INTO public.telegram_funnel_enrollments(id,launch_id,funnel_id,profile_id,user_id,bot_id,telegram_user_id,chat_id,phone_e164,status,reason)
 SELECT eid,l.id,l.funnel_id,id,user_id,l.bot_id,telegram_user_id,telegram_user_id,public.sms_normalize_phone(phone),state,why FROM planned RETURNING id,profile_id),
 starts AS(INSERT INTO public.telegram_funnel_deliveries(id,enrollment_id,transition_key,block_id)SELECT p.did,i.id,'start',(l.graph_snapshot->>'start_block_id')::uuid FROM planned p JOIN inserted i ON i.id=p.eid WHERE p.state IN('active','scheduled') RETURNING id),
 enroll_events AS(INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind,detail)SELECT i.id,CASE WHEN p.why='already_active' THEN 'skip:' ELSE 'enroll:' END||i.id::text,CASE WHEN p.why='already_active' THEN 'skipped' ELSE 'enrolled' END,CASE WHEN p.why='already_active' THEN jsonb_build_object('reason','already_active')ELSE jsonb_build_object('no_dialog',NOT p.has_dialog)END FROM inserted i JOIN planned p ON p.eid=i.id),
 results AS(SELECT e.profile_id,jsonb_build_object('enrollment_id',e.id,'delivery_id',e.delivery_id,'duplicate',true)v FROM existing e
 UNION ALL SELECT p.id,CASE WHEN p.why='already_active' THEN jsonb_build_object('enrollment_id',i.id,'profile_id',p.id,'skipped','already_active')ELSE jsonb_build_object('enrollment_id',i.id,'delivery_id',CASE WHEN p.state IN('active','scheduled')THEN p.did END,'skipped',NOT p.has_dialog)END FROM inserted i JOIN planned p ON p.eid=i.id CROSS JOIN(SELECT count(*)FROM starts)start_barrier)
 SELECT coalesce(jsonb_agg(v ORDER BY profile_id),'[]')INTO result FROM results;RETURN result;
END $$;
