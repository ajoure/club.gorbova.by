-- Additive: no existing graph, launch or audience is changed; scheduled steps are opt-in.
ALTER TABLE public.telegram_funnel_deliveries ADD COLUMN due_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX telegram_funnel_delivery_due ON public.telegram_funnel_deliveries(due_at,created_at) WHERE status='queued';
CREATE OR REPLACE FUNCTION public.telegram_funnel_next_minsk_time(p_after timestamptz,p_at text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE candidate timestamptz;
BEGIN
 IF p_after IS NULL OR coalesce(p_at,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'funnel_schedule_invalid';END IF;
 candidate:=((p_after AT TIME ZONE 'Europe/Minsk')::date+p_at::time) AT TIME ZONE 'Europe/Minsk';
 IF candidate<=p_after THEN candidate:=candidate+interval '1 day';END IF;
 RETURN candidate;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_next_minsk_time(timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_next_minsk_time(timestamptz,text) TO service_role;
CREATE OR REPLACE FUNCTION public.telegram_funnel_validate_graph(p_start uuid,p_blocks jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b jsonb; btn jsonb; n integer; cursor_id text; visited text[]; next_block jsonb;
BEGIN
 IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_blocks)=0 THEN RAISE EXCEPTION 'funnel_blocks_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE v->>'id'=p_start::text) THEN RAISE EXCEPTION 'funnel_start_invalid'; END IF;
 SELECT count(DISTINCT (v->>'id')::uuid) INTO n FROM jsonb_array_elements(p_blocks) v;
 IF n<>jsonb_array_length(p_blocks) THEN RAISE EXCEPTION 'funnel_duplicate_block'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  IF b ? 'next_step' AND b->'next_step'<>'null'::jsonb THEN
   IF jsonb_typeof(b->'next_step') IS DISTINCT FROM 'object' OR coalesce(b->'next_step'->>'at','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks)x WHERE x->>'id'=b->'next_step'->>'target_block_id' AND x->>'id'<>b->>'id' AND coalesce(x->>'channel','telegram')=coalesce(b->>'channel','telegram'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'buttons')x WHERE x->>'kind'='next') THEN RAISE EXCEPTION 'funnel_schedule_invalid';END IF;
  END IF;
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
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  cursor_id:=b->>'id'; visited:=ARRAY[]::text[];
  LOOP
   IF cursor_id=ANY(visited) THEN RAISE EXCEPTION 'funnel_schedule_cycle';END IF;
   visited:=array_append(visited,cursor_id);
   SELECT value INTO next_block FROM jsonb_array_elements(p_blocks)x WHERE x->>'id'=cursor_id;
   cursor_id:=next_block->'next_step'->>'target_block_id'; EXIT WHEN cursor_id IS NULL;
  END LOOP;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.telegram_funnel_claim_send(p_delivery uuid,p_tokens jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; d public.telegram_funnel_deliveries; l public.telegram_funnel_launches; b jsonb; btn jsonb; item jsonb; lease uuid;
BEGIN
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
 IF l.status='active' AND e.status IN('active','scheduled') AND l.scheduled_for>now() THEN RETURN jsonb_build_object('state','scheduled'); END IF;
 IF e.status='scheduled' AND l.status='active' THEN RETURN jsonb_build_object('state','scheduled');END IF;
 IF e.status<>'active' OR l.status<>'active' THEN RETURN jsonb_build_object('state','stopped'); END IF;
 IF l.scheduled_for>now() THEN RETURN jsonb_build_object('state','scheduled'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=e.profile_id AND pr.user_id IS NOT DISTINCT FROM e.user_id AND pr.telegram_user_id=e.telegram_user_id AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL) THEN
 UPDATE public.telegram_funnel_enrollments SET status='stopped',reason='recipient_binding_changed',stopped_at=now() WHERE id=e.id;
 UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=e.id;
 UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE enrollment_id=e.id AND status='queued';
 RETURN jsonb_build_object('state','recipient_binding_changed');END IF;
 IF d.status='queued' AND d.due_at>now() THEN RETURN jsonb_build_object('state','scheduled'); END IF;
 IF d.status<>'queued' THEN
  IF d.status='sending' AND d.started_at<now()-interval '30 seconds' THEN UPDATE public.telegram_funnel_deliveries SET status='unknown',error_code='interrupted_send' WHERE id=d.id; RETURN jsonb_build_object('state','unknown'); END IF;
  RETURN jsonb_build_object('state',d.status);
 END IF;
 SELECT value INTO b FROM jsonb_array_elements(l.graph_snapshot->'blocks') WHERE value->>'id'=d.block_id::text;
 IF b IS NULL OR jsonb_typeof(p_tokens) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'funnel_send_shape_invalid'; END IF;
 IF jsonb_array_length(p_tokens)<>(SELECT count(*) FROM jsonb_array_elements(b->'buttons') x WHERE x->>'kind' IN('next','finish')) THEN RAISE EXCEPTION 'funnel_tokens_invalid'; END IF;
 FOR btn IN SELECT value FROM jsonb_array_elements(b->'buttons') WHERE value->>'kind' IN('next','finish') LOOP
  SELECT value INTO item FROM jsonb_array_elements(p_tokens) WHERE value->>'button_id'=btn->>'id';
  IF item IS NULL OR (SELECT count(*) FROM jsonb_array_elements(p_tokens) WHERE value->>'button_id'=btn->>'id')<>1 THEN RAISE EXCEPTION 'funnel_tokens_invalid'; END IF;
  INSERT INTO public.telegram_funnel_callback_tokens(token_hash,enrollment_id,source_delivery_id,source_block_id,button_id,target_block_id,bot_id,chat_id,telegram_user_id,action,finish_tag)
  VALUES(item->>'token_hash',e.id,d.id,d.block_id,(btn->>'id')::uuid,CASE WHEN btn->>'kind'='next' THEN (btn->>'target_block_id')::uuid END,e.bot_id,e.chat_id,e.telegram_user_id,
   btn->>'kind',CASE WHEN btn->>'kind'='finish' THEN nullif(btn->>'tag','') END);
 END LOOP;
 lease:=gen_random_uuid();
 UPDATE public.telegram_funnel_deliveries SET status='sending',lease_id=lease,started_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('state','claimed','lease_id',lease,'block',b,'bot_id',e.bot_id,'chat_id',e.chat_id,'user_id',e.user_id,'enrollment_id',e.id);
END $$;

CREATE OR REPLACE FUNCTION public.sms_funnel_claim_send(p_delivery uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments;d public.telegram_funnel_deliveries;l public.telegram_funnel_launches;b jsonb;lease uuid;sms uuid;
BEGIN
 -- Preserve the Telegram transport lock order: enrollment -> delivery.
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found');END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
 IF e.status='scheduled' OR l.scheduled_for>now() THEN RETURN jsonb_build_object('state','scheduled');END IF;
 IF e.status<>'active' OR l.status<>'active' THEN RETURN jsonb_build_object('state','stopped');END IF;
 IF d.status='queued' AND d.due_at>now() THEN RETURN jsonb_build_object('state','scheduled'); END IF;
 IF d.status<>'queued' THEN
  IF d.status='sending' AND d.started_at<now()-interval '2 minutes' THEN UPDATE public.telegram_funnel_deliveries SET status='unknown',error_code='interrupted_send' WHERE id=d.id;RETURN jsonb_build_object('state','unknown');END IF;
  RETURN jsonb_build_object('state',d.status);
 END IF;
 SELECT value INTO b FROM jsonb_array_elements(l.graph_snapshot->'blocks') WHERE value->>'id'=d.block_id::text;
 IF b->>'channel' IS DISTINCT FROM 'sms' OR length(coalesce(b->>'text','')) NOT BETWEEN 1 AND 1000 OR jsonb_array_length(b->'buttons')<>0 OR coalesce(b->>'image_path','')<>'' THEN RAISE EXCEPTION 'funnel_sms_plain_text_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=e.profile_id AND p.user_id IS NOT DISTINCT FROM e.user_id AND p.is_archived IS NOT TRUE AND p.status IS DISTINCT FROM 'archived' AND p.merged_to_profile_id IS NULL AND public.sms_normalize_phone(p.phone)=e.phone_e164) THEN
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE id=d.id;
  UPDATE public.telegram_funnel_enrollments SET status='error',reason='recipient_binding_changed' WHERE id=e.id;
  RETURN jsonb_build_object('state','recipient_binding_changed');
 END IF;
 lease:=gen_random_uuid();
 INSERT INTO public.sms_messages(contact_id,phone_e164,text,provider,status,initiator_user_id,dispatch_key,funnel_delivery_id)
 VALUES(e.profile_id,e.phone_e164,b->>'text','smsby','sending',l.created_by,'funnel:'||l.id::text||':'||d.block_id::text||':'||e.phone_e164,d.id) ON CONFLICT(dispatch_key)WHERE dispatch_key IS NOT NULL DO NOTHING RETURNING id INTO sms;
 IF sms IS NULL THEN
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='duplicate_sms_phone',finished_at=now() WHERE id=d.id;
  UPDATE public.telegram_funnel_enrollments SET status='completed',reason='duplicate_sms_phone' WHERE id=e.id AND status='active';
  INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'sms_duplicate:'||d.id::text,'skipped',jsonb_build_object('channel','sms','reason','duplicate_sms_phone'))ON CONFLICT(event_key)DO NOTHING;
  RETURN jsonb_build_object('state','duplicate_sms_phone');
 END IF;
 UPDATE public.telegram_funnel_deliveries SET status='sending',lease_id=lease,started_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('state','claimed','lease_id',lease,'sms_id',sms,'phone',e.phone_e164,'text',b->>'text');
END $$;

CREATE OR REPLACE FUNCTION public.telegram_funnel_due_deliveries(p_launch uuid DEFAULT NULL,p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.telegram_funnel_activate_due(p_launch);
 -- Reconcile interrupted sends conservatively. Nothing is put back into the send queue.
 UPDATE public.telegram_funnel_deliveries SET status='unknown',error_code='interrupted_send' WHERE status='sending' AND started_at<now()-interval '30 seconds' AND(p_launch IS NULL OR EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments e WHERE e.id=enrollment_id AND e.launch_id=p_launch));
 RETURN (SELECT coalesce(jsonb_agg(id),'[]') FROM(SELECT d.id FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments e ON e.id=d.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id WHERE d.status='queued' AND d.due_at<=now() AND e.status='active' AND l.status='active' AND l.scheduled_for<=now() AND(p_launch IS NULL OR l.id=p_launch) ORDER BY d.created_at,d.id LIMIT least(greatest(p_limit,1),10))q);
END $$;
-- Runs before the confirmed-send UPDATE returns, so terminal completion sees the queued child.
CREATE FUNCTION public.telegram_funnel_queue_timed_next() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; l public.telegram_funnel_launches; b jsonb;
BEGIN
 IF NEW.status<>'sent' OR OLD.status='sent' THEN RETURN NEW;END IF;
 SELECT * INTO e FROM public.telegram_funnel_enrollments WHERE id=NEW.enrollment_id;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
 IF e.status<>'active' OR l.status<>'active' THEN RETURN NEW;END IF;
 SELECT value INTO b FROM jsonb_array_elements(l.graph_snapshot->'blocks')x WHERE x->>'id'=NEW.block_id::text;
 IF b->'next_step'->>'target_block_id' IS NOT NULL THEN
  INSERT INTO public.telegram_funnel_deliveries(enrollment_id,transition_key,source_delivery_id,block_id,due_at)
  VALUES(e.id,'timed:'||NEW.id::text,NEW.id,(b->'next_step'->>'target_block_id')::uuid,public.telegram_funnel_next_minsk_time(coalesce(NEW.finished_at,now()),b->'next_step'->>'at'))
  ON CONFLICT(enrollment_id,transition_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_queue_timed_next() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER telegram_funnel_queue_timed_next BEFORE UPDATE OF status ON public.telegram_funnel_deliveries FOR EACH ROW EXECUTE FUNCTION public.telegram_funnel_queue_timed_next();
