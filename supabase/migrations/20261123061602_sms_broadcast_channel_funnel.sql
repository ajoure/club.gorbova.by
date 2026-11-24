-- Expand only the existing communication channel checks.
ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_channel_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_channels_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_channels_check CHECK(cardinality(channels)>0 AND channels<@ARRAY['telegram','email','sms']::text[]);
ALTER TABLE public.broadcast_runs DROP CONSTRAINT IF EXISTS broadcast_runs_channel_check;
ALTER TABLE public.broadcast_runs ADD CONSTRAINT broadcast_runs_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.broadcast_campaigns DROP CONSTRAINT IF EXISTS broadcast_campaigns_channels_check;
ALTER TABLE public.broadcast_campaigns ADD CONSTRAINT broadcast_campaigns_channels_check CHECK(cardinality(channels)>0 AND channels<@ARRAY['telegram','email','sms']::text[]);
ALTER TABLE public.broadcast_deliveries DROP CONSTRAINT IF EXISTS broadcast_deliveries_channel_check;
ALTER TABLE public.broadcast_deliveries ADD CONSTRAINT broadcast_deliveries_channel_check CHECK(channel IN('telegram','email','sms'));
ALTER TABLE public.telegram_funnel_launches ALTER COLUMN bot_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_enrollments ALTER COLUMN bot_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_enrollments ADD COLUMN phone_e164 text;
ALTER TABLE public.sms_messages ADD COLUMN funnel_delivery_id uuid REFERENCES public.telegram_funnel_deliveries(id);
CREATE UNIQUE INDEX sms_messages_one_funnel_delivery ON public.sms_messages(funnel_delivery_id) WHERE funnel_delivery_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.sms_funnel_needs_telegram(p_start uuid,p_blocks jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce((SELECT coalesce(b->>'channel','telegram')='telegram' FROM jsonb_array_elements(p_blocks)b WHERE b->>'id'=p_start::text),true);
$$;
REVOKE ALL ON FUNCTION public.sms_funnel_needs_telegram(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_funnel_needs_telegram(uuid,jsonb) TO service_role;
ALTER TABLE public.telegram_funnel_launches ADD CONSTRAINT telegram_funnel_bot_channel CHECK(bot_id IS NOT NULL OR NOT public.sms_funnel_needs_telegram((graph_snapshot->>'start_block_id')::uuid,graph_snapshot->'blocks'));
CREATE OR REPLACE FUNCTION public.telegram_funnel_validate_graph(p_start uuid,p_blocks jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b jsonb; btn jsonb; n integer;
BEGIN
 IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_blocks)=0 THEN RAISE EXCEPTION 'funnel_blocks_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE v->>'id'=p_start::text) THEN RAISE EXCEPTION 'funnel_start_invalid'; END IF;
 SELECT count(DISTINCT (v->>'id')::uuid) INTO n FROM jsonb_array_elements(p_blocks) v;
 IF n<>jsonb_array_length(p_blocks) THEN RAISE EXCEPTION 'funnel_duplicate_block'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  IF coalesce(b->>'channel','telegram') NOT IN('telegram','sms') THEN RAISE EXCEPTION 'funnel_channel_invalid';END IF;
  IF b->>'channel'='sms' AND(length(coalesce(b->>'text',''))>1000 OR btrim(coalesce(b->>'text',''))='' OR coalesce(b->>'image_path','')<>'' OR jsonb_typeof(b->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'buttons')<>0) THEN RAISE EXCEPTION 'funnel_sms_plain_text_required';END IF;
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'id' IS NULL
    OR (b ? 'text' AND jsonb_typeof(b->'text') IS DISTINCT FROM 'string') OR (b ? 'image_path' AND jsonb_typeof(b->'image_path') NOT IN('string','null')) OR length(coalesce(b->>'text',''))>4096
    OR (coalesce(b->>'image_path','')='' AND btrim(coalesce(b->>'text',''))='') THEN RAISE EXCEPTION 'funnel_block_invalid'; END IF;
  IF coalesce(b->>'image_path','')<>'' AND (b->>'image_path' !~ '^[A-Za-z0-9_./-]+$' OR position('..' IN b->>'image_path')>0) THEN RAISE EXCEPTION 'funnel_image_invalid'; END IF;
  IF jsonb_typeof(b->'buttons') IS DISTINCT FROM 'array'  THEN RAISE EXCEPTION 'funnel_buttons_required'; END IF;
  SELECT count(DISTINCT (v->>'id')::uuid) INTO n FROM jsonb_array_elements(b->'buttons') v;
  IF n<>jsonb_array_length(b->'buttons') THEN RAISE EXCEPTION 'funnel_duplicate_button'; END IF;
  FOR btn IN SELECT value FROM jsonb_array_elements(b->'buttons') LOOP
   IF btrim(coalesce(btn->>'text',''))='' OR length(btn->>'text')>64 THEN RAISE EXCEPTION 'funnel_button_invalid'; END IF;
   IF btn->>'kind'='next' THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE v->>'id'=btn->>'target_block_id') THEN RAISE EXCEPTION 'funnel_target_invalid'; END IF;
   ELSIF btn->>'kind'='url' THEN
    IF coalesce(btn->>'url','') !~ '^https?://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'funnel_url_invalid'; END IF;
   ELSIF btn->>'kind'='finish' THEN
    IF btn ? 'tag' AND jsonb_typeof(btn->'tag') NOT IN('string','null') THEN RAISE EXCEPTION 'funnel_finish_tag_invalid'; END IF;
    IF coalesce(btn->>'tag','')<>'' AND(length(btrim(btn->>'tag')) NOT BETWEEN 1 AND 80 OR btn->>'tag' ~ '[[:cntrl:]]' OR btn->>'tag'<>btrim(btn->>'tag')) THEN RAISE EXCEPTION 'funnel_finish_tag_invalid'; END IF;
   ELSE RAISE EXCEPTION 'funnel_button_kind_invalid'; END IF;
  END LOOP;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_begin_launch(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid,p_filters jsonb,p_restart boolean DEFAULT false,p_scheduled_at timestamptz DEFAULT NULL)
RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels; l public.telegram_funnel_launches;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.status<>'active' OR f.revision<>p_revision THEN RAISE EXCEPTION 'funnel_not_launchable'; END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 IF public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_bot_unavailable'; END IF;
 PERFORM public.telegram_funnel_validate_segment(p_filters);
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN
  IF l.funnel_id<>p_funnel OR l.bot_id IS DISTINCT FROM p_bot OR l.audience_filters<>p_filters OR l.restart_existing<>p_restart OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict'; END IF;
  RETURN l;
 END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,restart_existing,created_by,scheduled_for)
 VALUES(p_id,p_funnel,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),p_filters,p_restart,auth.uid(),coalesce(p_scheduled_at,now())) RETURNING * INTO l;
 -- Every launch freezes recipients atomically, before any transport or cron tick.
 PERFORM public.telegram_funnel_prepare_audience(l.id); SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=l.id;
 RETURN l;
END $$;
CREATE OR REPLACE FUNCTION public.telegram_funnel_begin_self_test(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid) RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels;l public.telegram_funnel_launches;p public.profiles;filters jsonb:='{"version":1,"root":{"id":"self","kind":"field","field":"status","operator":"eq","value":"active"}}';
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.revision<>p_revision OR f.status NOT IN('draft','active') THEN RAISE EXCEPTION 'funnel_not_testable';END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 SELECT * INTO p FROM public.profiles WHERE user_id=auth.uid() AND is_archived IS NOT TRUE AND status IS DISTINCT FROM 'archived' AND merged_to_profile_id IS NULL;
 IF NOT FOUND OR (public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND(p.telegram_user_id IS NULL OR NOT public.telegram_funnel_known_dialog(p.id,p_bot) OR NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active'))) OR (NOT public.sms_funnel_needs_telegram(f.start_block_id,f.blocks) AND public.sms_normalize_phone(p.phone) IS NULL) THEN RAISE EXCEPTION 'funnel_self_dialog_required';END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN IF l.created_by IS DISTINCT FROM auth.uid() OR l.test_profile_id IS DISTINCT FROM p.id OR l.funnel_id<>f.id OR l.bot_id IS DISTINCT FROM p_bot OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict';END IF;RETURN l;END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,created_by,test_profile_id)
 VALUES(p_id,f.id,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),filters,auth.uid(),p.id) RETURNING * INTO l;RETURN l;
END $$;
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
  IF NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=e.profile_id AND pr.user_id IS NOT DISTINCT FROM e.user_id AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL AND CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b->>'id'=l.graph_snapshot->>'start_block_id' AND b->>'channel'='sms') THEN public.sms_normalize_phone(pr.phone)=e.phone_e164 ELSE pr.telegram_user_id=e.telegram_user_id AND public.telegram_funnel_known_dialog(e.profile_id,l.bot_id) END) THEN
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

