-- Telegram funnels: "finish" button (Irina feedback 21.11.2026).
-- A finish button sends no further message. Its press is recorded once, the participant's
-- run of the funnel is completed, remaining buttons are revoked and an optional contact tag
-- is saved to the contact card (usable in segments).
-- Lock order is unchanged: enrollment -> token -> receipts -> deliveries/tokens of the same enrollment.

ALTER TABLE public.telegram_funnel_callback_tokens ALTER COLUMN target_block_id DROP NOT NULL;
ALTER TABLE public.telegram_funnel_callback_tokens ADD COLUMN action text NOT NULL DEFAULT 'next' CHECK(action IN('next','finish'));
ALTER TABLE public.telegram_funnel_callback_tokens ADD COLUMN finish_tag text CHECK(finish_tag IS NULL OR(length(btrim(finish_tag)) BETWEEN 1 AND 80 AND finish_tag !~ '[[:cntrl:]]'));
ALTER TABLE public.telegram_funnel_callback_tokens ADD CONSTRAINT telegram_funnel_callback_token_action_shape
 CHECK((action='next' AND target_block_id IS NOT NULL AND finish_tag IS NULL) OR(action='finish' AND target_block_id IS NULL));

CREATE OR REPLACE FUNCTION public.telegram_funnel_validate_graph(p_start uuid,p_blocks jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE b jsonb; btn jsonb; n integer;
BEGIN
 IF jsonb_typeof(p_blocks) IS DISTINCT FROM 'array' OR jsonb_array_length(p_blocks)=0 THEN RAISE EXCEPTION 'funnel_blocks_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE v->>'id'=p_start::text) THEN RAISE EXCEPTION 'funnel_start_invalid'; END IF;
 SELECT count(DISTINCT (v->>'id')::uuid) INTO n FROM jsonb_array_elements(p_blocks) v;
 IF n<>jsonb_array_length(p_blocks) THEN RAISE EXCEPTION 'funnel_duplicate_block'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_blocks) LOOP
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' OR b->>'id' IS NULL
    OR (b ? 'text' AND jsonb_typeof(b->'text') IS DISTINCT FROM 'string') OR (b ? 'image_path' AND jsonb_typeof(b->'image_path') NOT IN('string','null')) OR length(coalesce(b->>'text',''))>4096
    OR (coalesce(b->>'image_path','')='' AND btrim(coalesce(b->>'text',''))='') THEN RAISE EXCEPTION 'funnel_block_invalid'; END IF;
  IF coalesce(b->>'image_path','')<>'' AND (b->>'image_path' !~ '^[A-Za-z0-9_./-]+$' OR position('..' IN b->>'image_path')>0 OR length(coalesce(b->>'text',''))>1024) THEN RAISE EXCEPTION 'funnel_image_invalid'; END IF;
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
REVOKE ALL ON FUNCTION public.telegram_funnel_validate_graph(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_validate_graph(uuid,jsonb) TO service_role;

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

CREATE OR REPLACE FUNCTION public.telegram_funnel_claim_callback(p_hash text,p_bot uuid,p_chat bigint,p_user bigint,p_message bigint,p_callback text,p_update bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; t public.telegram_funnel_callback_tokens; d public.telegram_funnel_deliveries; l public.telegram_funnel_launches; child uuid; claimed_event uuid; receipt public.telegram_funnel_callback_receipts; btn_text text;
BEGIN
 IF p_hash !~ '^[a-f0-9]{64}$' OR coalesce(length(p_callback),0) NOT BETWEEN 1 AND 160 OR p_update IS NULL THEN RETURN jsonb_build_object('state','invalid'); END IF;
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_callback_tokens tok ON tok.enrollment_id=en.id WHERE tok.token_hash=p_hash FOR UPDATE OF en;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','invalid'); END IF;
 SELECT * INTO t FROM public.telegram_funnel_callback_tokens WHERE token_hash=p_hash FOR UPDATE;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=t.source_delivery_id;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
 IF e.status<>'active' OR l.status<>'active' OR t.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('state','stopped'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=e.profile_id AND pr.user_id IS NOT DISTINCT FROM e.user_id AND pr.telegram_user_id=e.telegram_user_id AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL) THEN RETURN jsonb_build_object('state','binding_mismatch');END IF;
 IF t.bot_id IS DISTINCT FROM p_bot OR t.chat_id IS DISTINCT FROM p_chat OR t.telegram_user_id IS DISTINCT FROM p_user OR coalesce(p_message,0)<=0
  OR d.enrollment_id<>e.id OR d.block_id<>t.source_block_id THEN RETURN jsonb_build_object('state','binding_mismatch'); END IF;
 INSERT INTO public.telegram_funnel_callback_receipts(token_hash,bot_id,chat_id,telegram_user_id,provider_message_id,callback_id,update_id)
 VALUES(p_hash,p_bot,p_chat,p_user,p_message,p_callback,p_update) ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM public.telegram_funnel_callback_receipts WHERE bot_id=p_bot AND (callback_id=p_callback OR update_id=p_update) ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF receipt.token_hash<>p_hash OR receipt.chat_id<>p_chat OR receipt.telegram_user_id<>p_user OR receipt.provider_message_id<>p_message OR receipt.callback_id<>p_callback OR receipt.update_id<>p_update THEN RETURN jsonb_build_object('state','duplicate'); END IF;
 IF d.status IN('sending','unknown') AND t.provider_message_id IS NULL THEN
 INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'defer:'||receipt.id::text,'callback_pending',jsonb_build_object('button_id',t.button_id)) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('state','deferred'); END IF;
 IF d.status<>'sent' OR t.provider_message_id IS DISTINCT FROM p_message THEN UPDATE public.telegram_funnel_callback_receipts SET state='invalid' WHERE id=receipt.id; RETURN jsonb_build_object('state','binding_mismatch'); END IF;
 INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'press:'||receipt.id::text,'button_pressed',jsonb_build_object('button_id',t.button_id,'target_block_id',t.target_block_id)) ON CONFLICT DO NOTHING;
 IF t.action='finish' THEN
  -- One finish per participant run. The enrollment is still active here, so this is the first finish.
  SELECT bt.value->>'text' INTO btn_text FROM jsonb_array_elements(l.graph_snapshot->'blocks') bl CROSS JOIN LATERAL jsonb_array_elements(bl.value->'buttons') bt WHERE bl.value->>'id'=t.source_block_id::text AND bt.value->>'id'=t.button_id::text;
  INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,provider_update_key,kind,detail) VALUES(e.id,d.id,'finish_button:'||e.id::text,p_bot::text||':'||p_update::text,'finished',
   jsonb_build_object('button_id',t.button_id,'button_text',btn_text,'tag',t.finish_tag)) ON CONFLICT DO NOTHING RETURNING id INTO claimed_event;
  IF claimed_event IS NULL THEN UPDATE public.telegram_funnel_callback_receipts SET state='resolved' WHERE id=receipt.id; RETURN jsonb_build_object('state','duplicate'); END IF;
  UPDATE public.telegram_funnel_enrollments SET status='completed',reason='finished_by_button',stopped_at=now() WHERE id=e.id;
  UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=e.id AND revoked_at IS NULL AND dispatch_id IS NULL;
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='finished_by_button' WHERE enrollment_id=e.id AND status='queued';
  IF t.finish_tag IS NOT NULL THEN
   INSERT INTO public.telegram_funnel_profile_tags(profile_id,tag,created_by) VALUES(e.profile_id,t.finish_tag,l.created_by) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.telegram_funnel_callback_receipts SET state='resolved' WHERE id=receipt.id;
  RETURN jsonb_build_object('state','finished');
 END IF;
 IF t.dispatch_id IS NOT NULL THEN UPDATE public.telegram_funnel_callback_receipts SET state='resolved' WHERE id=receipt.id; RETURN jsonb_build_object('state','duplicate','delivery_id',t.dispatch_id); END IF;
 INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,provider_update_key,kind,detail) VALUES(e.id,d.id,'click:'||p_bot::text||':'||p_callback,p_bot::text||':'||p_update::text,'clicked',jsonb_build_object('button_id',t.button_id,'target_block_id',t.target_block_id)) ON CONFLICT DO NOTHING RETURNING id INTO claimed_event;
 IF claimed_event IS NULL THEN RETURN jsonb_build_object('state','duplicate'); END IF;
 INSERT INTO public.telegram_funnel_deliveries(enrollment_id,transition_key,source_delivery_id,source_button_id,block_id)
 VALUES(e.id,d.id::text||':'||t.button_id::text,d.id,t.button_id,t.target_block_id) ON CONFLICT(enrollment_id,transition_key) DO NOTHING RETURNING id INTO child;
 IF child IS NULL THEN SELECT id INTO child FROM public.telegram_funnel_deliveries WHERE enrollment_id=e.id AND transition_key=d.id::text||':'||t.button_id::text; END IF;
 UPDATE public.telegram_funnel_callback_tokens SET dispatch_id=child WHERE token_hash=p_hash;
 UPDATE public.telegram_funnel_callback_receipts SET state='resolved' WHERE id=receipt.id;
 RETURN jsonb_build_object('state','claimed','delivery_id',child);
END $$;

CREATE OR REPLACE FUNCTION public.telegram_funnel_reconcile_callbacks(p_source_delivery uuid DEFAULT NULL,p_launch uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;outcome jsonb;result jsonb:='[]';
BEGIN
 FOR r IN SELECT cr.* FROM public.telegram_funnel_callback_receipts cr JOIN public.telegram_funnel_callback_tokens tok ON tok.token_hash=cr.token_hash
 JOIN public.telegram_funnel_deliveries d ON d.id=tok.source_delivery_id WHERE cr.state='pending' AND d.status='sent'
 AND (p_source_delivery IS NULL OR d.id=p_source_delivery) AND (p_launch IS NULL OR EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments e WHERE e.id=d.enrollment_id AND e.launch_id=p_launch)) ORDER BY cr.created_at LIMIT 100 LOOP
  outcome:=public.telegram_funnel_claim_callback(r.token_hash,r.bot_id,r.chat_id,r.telegram_user_id,r.provider_message_id,r.callback_id,r.update_id);
  IF outcome->>'state'<>'deferred' THEN UPDATE public.telegram_funnel_callback_receipts SET state=CASE WHEN outcome->>'state' IN('claimed','duplicate','finished') THEN 'resolved' ELSE 'invalid' END WHERE id=r.id; END IF;
  IF outcome->>'state'='claimed' THEN result:=result||jsonb_build_array(outcome->>'delivery_id'); END IF;
 END LOOP;RETURN result;
END $$;
