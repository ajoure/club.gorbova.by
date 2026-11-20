-- Durable Telegram funnel state. No sends, bots, contacts, campaigns or recipients are seeded.
BEGIN;
CREATE TABLE public.telegram_funnels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active','stopped')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), start_block_id uuid NOT NULL, blocks jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.telegram_funnel_launches (
 id uuid PRIMARY KEY, funnel_id uuid NOT NULL REFERENCES public.telegram_funnels(id),
 bot_id uuid NOT NULL REFERENCES public.telegram_bots(id), graph_snapshot jsonb NOT NULL, audience_filters jsonb NOT NULL,
 test_profile_id uuid REFERENCES public.profiles(id), scheduled_for timestamptz NOT NULL DEFAULT now(), prepared_at timestamptz, restart_existing boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active' CHECK(status IN('active','stopped')),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.telegram_funnel_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), launch_id uuid NOT NULL REFERENCES public.telegram_funnel_launches(id),
 funnel_id uuid NOT NULL REFERENCES public.telegram_funnels(id), profile_id uuid NOT NULL REFERENCES public.profiles(id),
 user_id uuid REFERENCES auth.users(id), bot_id uuid NOT NULL REFERENCES public.telegram_bots(id),
 telegram_user_id bigint, chat_id bigint,
 status text NOT NULL CHECK(status IN('active','completed','stopped','error','skipped')),
 reason text, current_delivery_id uuid, created_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz,
 UNIQUE(launch_id,profile_id)
);
CREATE UNIQUE INDEX telegram_funnel_one_active_recipient ON public.telegram_funnel_enrollments(funnel_id,profile_id) WHERE status='active';
CREATE TABLE public.telegram_funnel_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES public.telegram_funnel_enrollments(id),
 transition_key text NOT NULL, source_delivery_id uuid REFERENCES public.telegram_funnel_deliveries(id), source_button_id uuid, block_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','sent','failed','unknown','skipped')),
 lease_id uuid, started_at timestamptz, finished_at timestamptz, provider_message_id bigint, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(enrollment_id,transition_key)
);
ALTER TABLE public.telegram_funnel_enrollments ADD CONSTRAINT telegram_funnel_current_delivery_fk FOREIGN KEY(current_delivery_id) REFERENCES public.telegram_funnel_deliveries(id);
CREATE INDEX telegram_funnel_delivery_queue ON public.telegram_funnel_deliveries(status,created_at);
CREATE TABLE public.telegram_funnel_callback_tokens (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'), enrollment_id uuid NOT NULL REFERENCES public.telegram_funnel_enrollments(id),
 source_delivery_id uuid NOT NULL REFERENCES public.telegram_funnel_deliveries(id), source_block_id uuid NOT NULL, button_id uuid NOT NULL, target_block_id uuid NOT NULL,
 bot_id uuid NOT NULL REFERENCES public.telegram_bots(id), chat_id bigint NOT NULL, telegram_user_id bigint NOT NULL,
 provider_message_id bigint, dispatch_id uuid REFERENCES public.telegram_funnel_deliveries(id), revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source_delivery_id,button_id)
);
CREATE TABLE public.telegram_funnel_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), enrollment_id uuid NOT NULL REFERENCES public.telegram_funnel_enrollments(id),
 delivery_id uuid REFERENCES public.telegram_funnel_deliveries(id), event_key text NOT NULL UNIQUE,
 provider_update_key text UNIQUE, kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.telegram_funnel_callback_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token_hash text NOT NULL REFERENCES public.telegram_funnel_callback_tokens(token_hash),
 bot_id uuid NOT NULL,chat_id bigint NOT NULL,telegram_user_id bigint NOT NULL,provider_message_id bigint NOT NULL,
 callback_id text NOT NULL,update_id bigint NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','resolved','invalid')),
 UNIQUE(bot_id,callback_id),UNIQUE(bot_id,update_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.telegram_funnel_link_tokens (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),delivery_id uuid NOT NULL REFERENCES public.telegram_funnel_deliveries(id),
 button_id uuid NOT NULL,target_url text NOT NULL,UNIQUE(delivery_id,button_id)
);
CREATE INDEX telegram_funnel_history_by_profile ON public.telegram_funnel_enrollments(profile_id,created_at DESC);
CREATE INDEX telegram_funnel_events_by_enrollment ON public.telegram_funnel_events(enrollment_id,created_at);

CREATE FUNCTION public.telegram_funnel_can_manage() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND coalesce((public.has_admin_section_access(auth.uid(),'communication','manage')
 OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin')),false);
$$;
REVOKE ALL ON FUNCTION public.telegram_funnel_can_manage() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_can_manage() TO authenticated,service_role;
DO $rls$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['telegram_funnels','telegram_funnel_launches','telegram_funnel_enrollments','telegram_funnel_deliveries','telegram_funnel_callback_tokens','telegram_funnel_events','telegram_funnel_callback_receipts','telegram_funnel_link_tokens'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
  IF t NOT IN('telegram_funnel_callback_tokens','telegram_funnel_callback_receipts','telegram_funnel_link_tokens') THEN
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
   EXECUTE format('CREATE POLICY communication_manage_read ON public.%I FOR SELECT TO authenticated USING ((SELECT public.telegram_funnel_can_manage()))',t);
  END IF;
 END LOOP;
END $rls$;

CREATE FUNCTION public.telegram_funnel_validate_graph(p_start uuid,p_blocks jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
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
   ELSE RAISE EXCEPTION 'funnel_button_kind_invalid'; END IF;
  END LOOP;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_validate_graph(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_validate_graph(uuid,jsonb) TO service_role;

CREATE FUNCTION public.telegram_funnel_save(p_id uuid,p_expected_revision integer,p_name text,p_start uuid,p_blocks jsonb,p_status text)
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
 IF p_status='stopped' THEN FOR l IN SELECT id FROM public.telegram_funnel_launches WHERE funnel_id=f.id AND status='active' ORDER BY id LOOP PERFORM public.telegram_funnel_stop_launch(l.id);END LOOP;END IF;
 RETURN f;
END $$;
CREATE FUNCTION public.telegram_funnel_begin_launch(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid,p_filters jsonb,p_restart boolean DEFAULT false,p_scheduled_at timestamptz DEFAULT NULL)
RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels; l public.telegram_funnel_launches;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.status<>'active' OR f.revision<>p_revision THEN RAISE EXCEPTION 'funnel_not_launchable'; END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 IF NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_bot_unavailable'; END IF;
 PERFORM public.telegram_funnel_validate_segment(p_filters);
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN
  IF l.funnel_id<>p_funnel OR l.bot_id<>p_bot OR l.audience_filters<>p_filters OR l.restart_existing<>p_restart OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict'; END IF;
  RETURN l;
 END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,restart_existing,created_by,scheduled_for)
 VALUES(p_id,p_funnel,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),p_filters,p_restart,auth.uid(),coalesce(p_scheduled_at,now())) RETURNING * INTO l;
 -- Every launch freezes recipients atomically, before any transport or cron tick.
 PERFORM public.telegram_funnel_prepare_audience(l.id); SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=l.id;
 RETURN l;
END $$;

CREATE FUNCTION public.telegram_funnel_known_dialog(p_profile uuid,p_bot uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT pr.telegram_user_id>0 AND ((pr.telegram_link_bot_id=p_bot AND pr.telegram_link_status='active') OR EXISTS(SELECT 1 FROM public.telegram_messages m WHERE m.bot_id=p_bot AND m.telegram_user_id=pr.telegram_user_id AND m.transport='bot' AND(m.direction='incoming' OR m.status IN('sent','delivered')))) FROM public.profiles pr WHERE pr.id=p_profile),false);
$$;
REVOKE ALL ON FUNCTION public.telegram_funnel_known_dialog(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_known_dialog(uuid,uuid) TO service_role;

CREATE FUNCTION public.telegram_funnel_enroll(p_launch uuid,p_profiles uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches; p record; old public.telegram_funnel_enrollments; e uuid; d uuid; has_dialog boolean; result jsonb:='[]';
BEGIN
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND OR l.status<>'active' THEN RAISE EXCEPTION 'funnel_launch_stopped'; END IF;
 FOR p IN SELECT pr.* FROM public.profiles pr WHERE pr.id=ANY(p_profiles) AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL ORDER BY pr.id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(l.funnel_id::text||':'||p.id::text,0));
  SELECT id INTO e FROM public.telegram_funnel_enrollments WHERE launch_id=l.id AND profile_id=p.id;
  IF FOUND THEN result:=result||jsonb_build_array(jsonb_build_object('enrollment_id',e,'delivery_id',(SELECT id FROM public.telegram_funnel_deliveries WHERE enrollment_id=e AND transition_key='start'),'duplicate',true)); CONTINUE; END IF;
  SELECT * INTO old FROM public.telegram_funnel_enrollments WHERE funnel_id=l.funnel_id AND profile_id=p.id AND status='active' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries ds JOIN public.telegram_funnel_enrollments en ON en.id=ds.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=p.id AND ds.status IN('sending','unknown')) THEN RAISE EXCEPTION 'funnel_unresolved_delivery'; END IF;
  IF old.id IS NOT NULL THEN
   IF NOT l.restart_existing THEN
    INSERT INTO public.telegram_funnel_enrollments(launch_id,funnel_id,profile_id,user_id,bot_id,telegram_user_id,chat_id,status,reason)
    VALUES(l.id,l.funnel_id,p.id,p.user_id,l.bot_id,p.telegram_user_id,p.telegram_user_id,'skipped','already_active') RETURNING id INTO e;
    INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind,detail) VALUES(e,'skip:'||e::text,'skipped',jsonb_build_object('reason','already_active'));
    result:=result||jsonb_build_array(jsonb_build_object('enrollment_id',e,'profile_id',p.id,'skipped','already_active')); CONTINUE;
   END IF;
   UPDATE public.telegram_funnel_enrollments SET status='stopped',reason='explicit_restart',stopped_at=now() WHERE id=old.id;
   UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=old.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='explicit_restart' WHERE enrollment_id=old.id AND status='queued';
   INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind) VALUES(old.id,'restart:'||l.id::text||':'||old.id::text,'restarted');
  END IF;
  has_dialog:=public.telegram_funnel_known_dialog(p.id,l.bot_id);
  INSERT INTO public.telegram_funnel_enrollments(launch_id,funnel_id,profile_id,user_id,bot_id,telegram_user_id,chat_id,status,reason)
  VALUES(l.id,l.funnel_id,p.id,p.user_id,l.bot_id,p.telegram_user_id,p.telegram_user_id,CASE WHEN has_dialog THEN 'active' ELSE 'skipped' END,CASE WHEN has_dialog THEN NULL ELSE 'no_available_telegram_dialog' END) RETURNING id INTO e;
  INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind,detail) VALUES(e,'enroll:'||e::text,'enrolled',jsonb_build_object('no_dialog',NOT has_dialog));
  IF has_dialog THEN
   INSERT INTO public.telegram_funnel_deliveries(enrollment_id,transition_key,block_id) VALUES(e,'start',(l.graph_snapshot->>'start_block_id')::uuid) RETURNING id INTO d;
  ELSE d:=NULL; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('enrollment_id',e,'delivery_id',d,'skipped',NOT has_dialog));
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION public.telegram_funnel_claim_send(p_delivery uuid,p_tokens jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; d public.telegram_funnel_deliveries; l public.telegram_funnel_launches; b jsonb; btn jsonb; item jsonb; lease uuid;
BEGIN
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
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
 IF jsonb_array_length(p_tokens)<>(SELECT count(*) FROM jsonb_array_elements(b->'buttons') x WHERE x->>'kind'='next') THEN RAISE EXCEPTION 'funnel_tokens_invalid'; END IF;
 FOR btn IN SELECT value FROM jsonb_array_elements(b->'buttons') WHERE value->>'kind'='next' LOOP
  SELECT value INTO item FROM jsonb_array_elements(p_tokens) WHERE value->>'button_id'=btn->>'id';
  IF item IS NULL OR (SELECT count(*) FROM jsonb_array_elements(p_tokens) WHERE value->>'button_id'=btn->>'id')<>1 THEN RAISE EXCEPTION 'funnel_tokens_invalid'; END IF;
  INSERT INTO public.telegram_funnel_callback_tokens(token_hash,enrollment_id,source_delivery_id,source_block_id,button_id,target_block_id,bot_id,chat_id,telegram_user_id)
  VALUES(item->>'token_hash',e.id,d.id,d.block_id,(btn->>'id')::uuid,(btn->>'target_block_id')::uuid,e.bot_id,e.chat_id,e.telegram_user_id);
 END LOOP;
 lease:=gen_random_uuid();
 UPDATE public.telegram_funnel_deliveries SET status='sending',lease_id=lease,started_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('state','claimed','lease_id',lease,'block',b,'bot_id',e.bot_id,'chat_id',e.chat_id,'user_id',e.user_id,'enrollment_id',e.id);
END $$;

CREATE FUNCTION public.telegram_funnel_finish_send(p_delivery uuid,p_lease uuid,p_outcome text,p_message_id bigint DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; d public.telegram_funnel_deliveries;
BEGIN
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND OR d.lease_id IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'funnel_lease_mismatch'; END IF;
 IF d.status='sent' THEN RETURN jsonb_build_object('state','sent'); END IF;
 IF d.status NOT IN('sending','unknown') OR p_outcome NOT IN('sent','failed','unknown') OR (p_outcome='sent' AND coalesce(p_message_id,0)<=0) THEN RAISE EXCEPTION 'funnel_finish_invalid'; END IF;
 UPDATE public.telegram_funnel_deliveries SET status=p_outcome,provider_message_id=p_message_id,error_code=left(p_error,100),finished_at=now() WHERE id=d.id;
 IF p_outcome='failed' THEN
  UPDATE public.telegram_funnel_enrollments SET status='error',reason='delivery_failed' WHERE id=e.id AND status='active';
  UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE source_delivery_id=d.id;
 END IF;
 IF p_outcome='sent' THEN
  UPDATE public.telegram_funnel_callback_tokens SET provider_message_id=p_message_id WHERE source_delivery_id=d.id;
  UPDATE public.telegram_funnel_enrollments SET current_delivery_id=d.id WHERE id=e.id;
  IF e.status='active' AND NOT EXISTS(SELECT 1 FROM public.telegram_funnel_callback_tokens WHERE enrollment_id=e.id AND dispatch_id IS NULL AND revoked_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries WHERE enrollment_id=e.id AND status IN('queued','sending','unknown')) THEN UPDATE public.telegram_funnel_enrollments SET status='completed' WHERE id=e.id; END IF;
 END IF;
 INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'finish:'||d.id::text||':'||p_outcome,p_outcome,jsonb_build_object('error_code',left(p_error,100))) ON CONFLICT(event_key) DO NOTHING;
 RETURN jsonb_build_object('state',p_outcome);
END $$;

CREATE FUNCTION public.telegram_funnel_claim_callback(p_hash text,p_bot uuid,p_chat bigint,p_user bigint,p_message bigint,p_callback text,p_update bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments; t public.telegram_funnel_callback_tokens; d public.telegram_funnel_deliveries; l public.telegram_funnel_launches; child uuid; claimed_event uuid; receipt public.telegram_funnel_callback_receipts;
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

CREATE FUNCTION public.telegram_funnel_stop_launch(p_launch uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501'; END IF;
 UPDATE public.telegram_funnel_launches SET status='stopped' WHERE id=p_launch;
 FOR e IN SELECT id FROM public.telegram_funnel_enrollments WHERE launch_id=p_launch ORDER BY id FOR UPDATE LOOP
  UPDATE public.telegram_funnel_enrollments SET status='stopped',stopped_at=now() WHERE id=e.id AND status='active';
  UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=e.id;
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='stopped' WHERE enrollment_id=e.id AND status='queued';
  INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind) VALUES(e.id,'stop:'||e.id::text,'stopped') ON CONFLICT(event_key) DO NOTHING;
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.telegram_funnel_save(uuid,integer,text,uuid,jsonb,text),public.telegram_funnel_begin_launch(uuid,uuid,integer,uuid,jsonb,boolean,timestamptz),public.telegram_funnel_stop_launch(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_save(uuid,integer,text,uuid,jsonb,text),public.telegram_funnel_begin_launch(uuid,uuid,integer,uuid,jsonb,boolean,timestamptz),public.telegram_funnel_stop_launch(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.telegram_funnel_enroll(uuid,uuid[]),public.telegram_funnel_claim_send(uuid,jsonb),public.telegram_funnel_finish_send(uuid,uuid,text,bigint,text),public.telegram_funnel_claim_callback(text,uuid,bigint,bigint,bigint,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_enroll(uuid,uuid[]),public.telegram_funnel_claim_send(uuid,jsonb),public.telegram_funnel_finish_send(uuid,uuid,text,bigint,text),public.telegram_funnel_claim_callback(text,uuid,bigint,bigint,bigint,text,bigint) TO service_role;

CREATE FUNCTION public.telegram_funnel_delivery_context(p_delivery uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('block',b.value,'status',d.status) FROM public.telegram_funnel_deliveries d
 JOIN public.telegram_funnel_enrollments e ON e.id=d.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id
 CROSS JOIN LATERAL jsonb_array_elements(l.graph_snapshot->'blocks') b WHERE d.id=p_delivery AND b.value->>'id'=d.block_id::text;
$$;
CREATE FUNCTION public.telegram_funnel_prepare_links(p_delivery uuid,p_lease uuid,p_tokens jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.telegram_funnel_deliveries;ctx jsonb;btn jsonb;item jsonb;
BEGIN
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF d.status<>'sending' OR d.lease_id IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'funnel_lease_mismatch'; END IF;
 ctx:=public.telegram_funnel_delivery_context(p_delivery);
 IF jsonb_typeof(p_tokens) IS DISTINCT FROM 'array' OR jsonb_array_length(p_tokens)<>(SELECT count(*) FROM jsonb_array_elements(ctx#>'{block,buttons}') v WHERE v->>'kind'='url') THEN RAISE EXCEPTION 'funnel_link_tokens_invalid'; END IF;
 FOR btn IN SELECT value FROM jsonb_array_elements(ctx#>'{block,buttons}') WHERE value->>'kind'='url' LOOP
  SELECT value INTO item FROM jsonb_array_elements(p_tokens) WHERE value->>'button_id'=btn->>'id';
  IF item IS NULL THEN RAISE EXCEPTION 'funnel_link_tokens_invalid'; END IF;
  INSERT INTO public.telegram_funnel_link_tokens(token_hash,delivery_id,button_id,target_url) VALUES(item->>'token_hash',d.id,(btn->>'id')::uuid,btn->>'url');
 END LOOP;
END $$;
CREATE FUNCTION public.telegram_funnel_reconcile_callbacks(p_source_delivery uuid DEFAULT NULL,p_launch uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;outcome jsonb;result jsonb:='[]';
BEGIN
 FOR r IN SELECT cr.* FROM public.telegram_funnel_callback_receipts cr JOIN public.telegram_funnel_callback_tokens tok ON tok.token_hash=cr.token_hash
 JOIN public.telegram_funnel_deliveries d ON d.id=tok.source_delivery_id WHERE cr.state='pending' AND d.status='sent'
 AND (p_source_delivery IS NULL OR d.id=p_source_delivery) AND (p_launch IS NULL OR EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments e WHERE e.id=d.enrollment_id AND e.launch_id=p_launch)) ORDER BY cr.created_at LIMIT 100 LOOP
  outcome:=public.telegram_funnel_claim_callback(r.token_hash,r.bot_id,r.chat_id,r.telegram_user_id,r.provider_message_id,r.callback_id,r.update_id);
  IF outcome->>'state'<>'deferred' THEN UPDATE public.telegram_funnel_callback_receipts SET state=CASE WHEN outcome->>'state' IN('claimed','duplicate') THEN 'resolved' ELSE 'invalid' END WHERE id=r.id; END IF;
  IF outcome->>'state'='claimed' THEN result:=result||jsonb_build_array(outcome->>'delivery_id'); END IF;
 END LOOP;RETURN result;
END $$;
CREATE FUNCTION public.telegram_funnel_track_link(p_hash text,p_machine boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.telegram_funnel_link_tokens;d public.telegram_funnel_deliveries;
BEGIN
 SELECT * INTO t FROM public.telegram_funnel_link_tokens WHERE token_hash=p_hash;IF NOT FOUND THEN RETURN jsonb_build_object('ok',false);END IF;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=t.delivery_id;
 IF d.status<>'sent' THEN RETURN jsonb_build_object('ok',false); END IF;
 IF NOT coalesce(p_machine,true) THEN INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail)
 VALUES(d.enrollment_id,d.id,'url:'||d.id::text||':'||t.button_id::text||':'||gen_random_uuid()::text,'url_clicked',jsonb_build_object('button_id',t.button_id)) ON CONFLICT DO NOTHING; END IF;
 RETURN jsonb_build_object('ok',true,'url',t.target_url);
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_delivery_context(uuid),public.telegram_funnel_prepare_links(uuid,uuid,jsonb),public.telegram_funnel_reconcile_callbacks(uuid,uuid),public.telegram_funnel_track_link(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_delivery_context(uuid),public.telegram_funnel_prepare_links(uuid,uuid,jsonb),public.telegram_funnel_reconcile_callbacks(uuid,uuid),public.telegram_funnel_track_link(text,boolean) TO service_role;


-- Manual contact tags are explicit admin input, never inferred from purchase labels.
CREATE TABLE public.telegram_funnel_profile_tags(profile_id uuid NOT NULL REFERENCES public.profiles(id),tag text NOT NULL CHECK(length(btrim(tag)) BETWEEN 1 AND 80 AND tag !~ '[[:cntrl:]]'),created_by uuid NOT NULL REFERENCES auth.users(id),PRIMARY KEY(profile_id,tag));
ALTER TABLE public.telegram_funnel_profile_tags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_funnel_profile_tags FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.telegram_funnel_profile_tags TO authenticated;
GRANT ALL ON public.telegram_funnel_profile_tags TO service_role;
CREATE POLICY communication_manage_read ON public.telegram_funnel_profile_tags FOR SELECT TO authenticated USING((SELECT public.telegram_funnel_can_manage()));
CREATE FUNCTION public.telegram_funnel_set_tags(p_profile uuid,p_tags text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE before_tags jsonb; after_tags jsonb;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 IF p_tags IS NULL OR cardinality(p_tags)>100 OR EXISTS(SELECT 1 FROM unnest(p_tags)t WHERE t IS NULL OR t ~ '[[:cntrl:]]' OR length(btrim(t)) NOT BETWEEN 1 AND 80) THEN RAISE EXCEPTION 'funnel_tags_invalid'; END IF;
 PERFORM 1 FROM public.profiles WHERE id=p_profile FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'profile_missing';END IF;
 SELECT coalesce(jsonb_agg(tag ORDER BY tag),'[]') INTO before_tags FROM public.telegram_funnel_profile_tags WHERE profile_id=p_profile;
 SELECT coalesce(jsonb_agg(t ORDER BY t),'[]') INTO after_tags FROM(SELECT DISTINCT btrim(t)t FROM unnest(p_tags)t)q;
 IF before_tags=after_tags THEN RETURN;END IF;
 DELETE FROM public.telegram_funnel_profile_tags WHERE profile_id=p_profile;
 INSERT INTO public.telegram_funnel_profile_tags SELECT p_profile,btrim(t),auth.uid() FROM unnest(p_tags)t GROUP BY btrim(t);
 INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,meta) VALUES(auth.uid(),'telegram_funnel.manual_tags.updated','profile',p_profile::text,jsonb_build_object('before',before_tags,'after',after_tags));
END $$;
CREATE FUNCTION public.telegram_funnel_segment_node_ids(p_node jsonb,p_depth integer DEFAULT 0) RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE child jsonb;ids text[];allowed text[];k text;
BEGIN
 IF p_depth>6 OR jsonb_typeof(p_node) IS DISTINCT FROM 'object' OR coalesce(p_node->>'id','')!~'^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'funnel_segment_invalid';END IF;
 ids:=ARRAY[p_node->>'id'];k:=p_node->>'kind';
 IF p_node?'op' THEN
  allowed:=ARRAY['id','op','args'];
  IF p_node->>'op' NOT IN('and','or') OR jsonb_typeof(p_node->'args') IS DISTINCT FROM 'array' OR jsonb_array_length(p_node->'args') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'funnel_segment_group_invalid';END IF;
  FOR child IN SELECT value FROM jsonb_array_elements(p_node->'args') LOOP ids:=ids||public.telegram_funnel_segment_node_ids(child,p_depth+1);END LOOP;
 ELSE
  IF k IN('product','year','cohort','tag') AND jsonb_typeof(p_node->'negate') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'funnel_segment_negate_required';END IF;
  IF k IN('product','year','cohort') THEN PERFORM (p_node->>'product_id')::uuid;IF p_node->>'product_id' IS NULL THEN RAISE EXCEPTION 'funnel_segment_product_required';END IF;END IF;
  CASE k
   WHEN 'product' THEN
    allowed:=ARRAY['id','kind','relation','product_id','negate','tariff_ids'];
    IF coalesce(p_node->>'relation','') NOT IN('purchased','attended','active_access') THEN RAISE EXCEPTION 'funnel_segment_relation_invalid';END IF;
    IF p_node?'tariff_ids' THEN IF jsonb_typeof(p_node->'tariff_ids') IS DISTINCT FROM 'array' OR jsonb_array_length(p_node->'tariff_ids') NOT BETWEEN 1 AND 30 THEN RAISE EXCEPTION 'funnel_segment_tariffs_invalid';END IF;FOR child IN SELECT value FROM jsonb_array_elements(p_node->'tariff_ids') LOOP PERFORM (child#>>'{}')::uuid;END LOOP;END IF;
   WHEN 'year' THEN allowed:=ARRAY['id','kind','product_id','year','negate'];IF jsonb_typeof(p_node->'year') IS DISTINCT FROM 'number' OR (p_node->>'year')::numeric<>trunc((p_node->>'year')::numeric) OR (p_node->>'year')::int NOT BETWEEN 2000 AND 2200 THEN RAISE EXCEPTION 'funnel_segment_year_invalid';END IF;
   WHEN 'cohort' THEN allowed:=ARRAY['id','kind','product_id','flow_id','negate'];IF p_node->>'flow_id' IS NULL THEN RAISE EXCEPTION 'funnel_segment_flow_required';END IF;PERFORM (p_node->>'flow_id')::uuid;
   WHEN 'tag' THEN allowed:=ARRAY['id','kind','tag','negate'];IF jsonb_typeof(p_node->'tag') IS DISTINCT FROM 'string' OR length(btrim(p_node->>'tag')) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'funnel_segment_tag_invalid';END IF;
   WHEN 'field' THEN
    allowed:=ARRAY['id','kind','field','operator','value'];
    IF coalesce(p_node->>'field','') NOT IN('country','city','source','status','marketing_consent','was_club_member') OR coalesce(p_node->>'operator','') NOT IN('eq','neq','is_set','is_not_set') THEN RAISE EXCEPTION 'funnel_segment_field_invalid';END IF;
    IF p_node->>'operator' IN('eq','neq') AND (jsonb_typeof(p_node->'value') IS DISTINCT FROM CASE WHEN p_node->>'field' IN('marketing_consent','was_club_member') THEN 'boolean' ELSE 'string' END) THEN RAISE EXCEPTION 'funnel_segment_value_invalid';END IF;
   ELSE RAISE EXCEPTION 'funnel_segment_kind_invalid';
  END CASE;
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_node)t WHERE NOT t=ANY(allowed)) THEN RAISE EXCEPTION 'funnel_segment_unknown_key';END IF;
 RETURN ids;
END $$;
CREATE FUNCTION public.telegram_funnel_validate_segment(p_segment jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE ids text[];
BEGIN
 IF jsonb_typeof(p_segment) IS DISTINCT FROM 'object' OR (p_segment->>'version' IS DISTINCT FROM '1' OR jsonb_typeof(p_segment->'version') IS DISTINCT FROM 'number') OR octet_length(p_segment::text)>32768 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_segment)t WHERE t NOT IN('version','root')) THEN RAISE EXCEPTION 'funnel_segment_invalid';END IF;
 ids:=public.telegram_funnel_segment_node_ids(p_segment->'root');
 IF cardinality(ids)>100 OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids)x) THEN RAISE EXCEPTION 'funnel_segment_duplicate_or_large';END IF;
END $$;
CREATE FUNCTION public.telegram_funnel_profile_facts(p_profile uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $facts$
WITH p AS(SELECT * FROM public.profiles WHERE id=p_profile),candidate AS(
 SELECT o.* FROM public.orders_v2 o,p WHERE (o.profile_id=p.id OR (p.user_id IS NOT NULL AND o.user_id=p.user_id))
 AND o.is_deleted IS NOT TRUE AND o.status::text='paid' AND NOT coalesce(o.is_trial,false)
 AND coalesce(o.meta->>'financial_kind','') NOT IN('gift','test','sandbox','referral_redemption')
 AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'is_gift','false')<>'true'
 AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected' AND NOT coalesce(o.meta,'{}')?'rejected_at'
 AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
 AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=o.id AND pm.is_deleted IS NOT TRUE AND (pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))
),purchases AS(
 SELECT o.* FROM candidate o WHERE (o.final_price>0 AND (SELECT coalesce(sum(pm.amount),0) FROM public.payments_v2 pm WHERE pm.order_id=o.id AND pm.is_deleted IS NOT TRUE AND pm.status::text='succeeded' AND pm.amount>0 AND pm.currency=o.currency)>=o.final_price)
 OR(o.reconcile_source='owner_confirmed_historical' AND o.meta->>'history_only'='true' AND o.meta->>'owner_confirmed_paid'='true' AND nullif(o.meta->>'historical_batch_id','') IS NOT NULL AND nullif(o.meta->>'historical_idempotency_key','') IS NOT NULL AND jsonb_typeof(o.meta->'source_refs')='array' AND jsonb_array_length(o.meta->'source_refs')>0)
 OR(o.deal_date IS NOT NULL AND ((o.meta->>'import_source'='patch4' AND nullif(o.meta->>'gc_deal_id','') IS NOT NULL) OR(o.meta->>'import_source'='csv_active_import' AND nullif(o.meta->>'source_file','') IS NOT NULL AND o.meta?'source_row_num') OR(o.meta->>'import_source'='revision_7101ed3c' AND o.product_id='7101ed3c-7839-4a74-ad95-aa0660369b22'::uuid)))
),enrollments AS(
 SELECT e.product_id,NULL::uuid AS tariff_id,o.flow_id FROM public.entitlements e JOIN p ON(e.profile_id=p.id OR(e.user_id=p.user_id AND p.user_id IS NOT NULL)) LEFT JOIN public.orders_v2 o ON o.id=e.order_id
 WHERE e.status IN('active','expired') AND coalesce(e.meta->>'source_type','') NOT IN('test','sandbox','trial') AND coalesce(e.meta->>'is_test','false')<>'true'
 AND coalesce(e.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
 AND(coalesce(e.meta->>'granted_by','')<>'rule_engine_product_access' OR(e.meta->>'historical_purchase_type'='base_tariff_purchase' AND EXISTS(SELECT 1 FROM purchases proof WHERE proof.id::text=e.meta->>'prior_purchase_order_id' AND proof.product_id=e.product_id)))
 AND(e.order_id IS NULL OR(o.id IS NOT NULL AND o.is_deleted IS NOT TRUE AND o.status::text IN('paid','partial') AND NOT coalesce(o.is_trial,false) AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected' AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase') AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=o.id AND pm.is_deleted IS NOT TRUE AND(pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))))
 UNION ALL SELECT sub.product_id,sub.tariff_id,coalesce(sub.flow_id,o.flow_id) FROM public.subscriptions_v2 sub JOIN p ON(sub.profile_id=p.id OR(sub.user_id=p.user_id AND p.user_id IS NOT NULL)) LEFT JOIN public.orders_v2 o ON o.id=sub.order_id
 WHERE sub.status::text IN('active','expired','superseded') AND sub.access_start_at<=statement_timestamp() AND NOT coalesce(sub.is_trial,false)
 AND coalesce(sub.meta->>'source_type','') NOT IN('test','sandbox','trial','rule_engine') AND coalesce(sub.meta->>'is_test','false')<>'true'
 AND coalesce(sub.meta->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase')
 AND(sub.order_id IS NULL OR(o.id IS NOT NULL AND o.is_deleted IS NOT TRUE AND o.status::text IN('paid','partial') AND NOT coalesce(o.is_trial,false) AND coalesce(o.meta->>'is_test','false')<>'true' AND coalesce(o.meta->>'prior_purchase_verification','')<>'rejected' AND coalesce(o.purchase_snapshot->>'historical_purchase_type',o.meta->>'historical_purchase_type','') NOT IN('module_only_standalone','module_child_purchase','module_purchase') AND NOT EXISTS(SELECT 1 FROM public.payments_v2 pm WHERE pm.order_id=o.id AND pm.is_deleted IS NOT TRUE AND(pm.status::text='refunded' OR coalesce(pm.refunded_amount,0)>0 OR pm.transaction_type='refund'))))
 UNION ALL SELECT product_id,tariff_id,flow_id FROM purchases WHERE reconcile_source='owner_confirmed_historical' AND purchase_snapshot->>'historical_purchase_type'='base_tariff_purchase'
),access AS(
 SELECT e.product_id,NULL::uuid tariff_id FROM public.entitlements e,p WHERE(e.profile_id=p.id OR(e.user_id=p.user_id AND p.user_id IS NOT NULL)) AND e.status='active' AND(e.expires_at IS NULL OR e.expires_at>statement_timestamp())
 UNION ALL SELECT sub.product_id,sub.tariff_id FROM public.subscriptions_v2 sub,p WHERE(sub.profile_id=p.id OR(sub.user_id=p.user_id AND p.user_id IS NOT NULL)) AND sub.status::text='active' AND sub.access_start_at<=statement_timestamp() AND sub.access_end_at>statement_timestamp()
)
SELECT jsonb_build_object('purchases',coalesce((SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'tariff_id',tariff_id)) FROM purchases),'[]'),
 'participations',coalesce((SELECT jsonb_agg(jsonb_build_object('product_id',e.product_id,'tariff_id',e.tariff_id,'flow_id',e.flow_id,'year',extract(year FROM fl.start_date AT TIME ZONE 'Europe/Minsk')::int)) FROM enrollments e LEFT JOIN public.flows fl ON fl.id=e.flow_id),'[]'),
 'active_access',coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM access a),'[]'),
 'tags',coalesce((SELECT jsonb_agg(tag ORDER BY tag) FROM public.telegram_funnel_profile_tags WHERE profile_id=p_profile),'[]'),
 'fields',coalesce((SELECT jsonb_build_object('country',country,'city',city,'source',source,'status',status,'marketing_consent',marketing_consent,'was_club_member',was_club_member) FROM p),'{}'));
$facts$;
CREATE FUNCTION public.telegram_funnel_segment_evaluate(p_node jsonb,p_facts jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE child jsonb;positive boolean;rows jsonb;actual jsonb;
BEGIN
 IF p_node?'op' THEN
  IF p_node->>'op'='and' THEN FOR child IN SELECT value FROM jsonb_array_elements(p_node->'args') LOOP IF NOT public.telegram_funnel_segment_evaluate(child,p_facts) THEN RETURN false;END IF;END LOOP;RETURN true;
  ELSE FOR child IN SELECT value FROM jsonb_array_elements(p_node->'args') LOOP IF public.telegram_funnel_segment_evaluate(child,p_facts) THEN RETURN true;END IF;END LOOP;RETURN false;END IF;
 END IF;
 CASE p_node->>'kind'
 WHEN 'field' THEN
  actual:=p_facts->'fields'->(p_node->>'field');
  IF p_node->>'operator'='is_not_set' THEN RETURN actual IS NULL OR actual='null'::jsonb OR actual='""'::jsonb;END IF;
  IF actual IS NULL OR actual='null'::jsonb OR actual='""'::jsonb THEN RETURN false;END IF;
  RETURN CASE p_node->>'operator' WHEN 'is_set' THEN true WHEN 'eq' THEN actual=p_node->'value' WHEN 'neq' THEN actual<>p_node->'value' ELSE false END;
 WHEN 'tag' THEN positive:=(p_facts->'tags') ? (p_node->>'tag');
 WHEN 'product' THEN
  rows:=p_facts->CASE p_node->>'relation' WHEN 'purchased' THEN 'purchases' WHEN 'attended' THEN 'participations' ELSE 'active_access' END;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(rows)r WHERE r->>'product_id'=p_node->>'product_id' AND(NOT p_node?'tariff_ids' OR(p_node->'tariff_ids') ? (r->>'tariff_id'))) INTO positive;
 ELSE
  rows:=(SELECT coalesce(jsonb_agg(r),'[]') FROM jsonb_array_elements(p_facts->'participations')r WHERE r->>'product_id'=p_node->>'product_id');
  IF(p_node->>'negate')::boolean AND EXISTS(SELECT 1 FROM jsonb_array_elements(rows)r WHERE r->>CASE WHEN p_node->>'kind'='year' THEN 'year' ELSE 'flow_id' END IS NULL) THEN RETURN false;END IF;
  SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(rows)r WHERE CASE WHEN p_node->>'kind'='year' THEN r->>'year'=p_node->>'year' ELSE r->>'flow_id'=p_node->>'flow_id' END) INTO positive;
 END CASE;
 RETURN CASE WHEN(p_node->>'negate')::boolean THEN NOT coalesce(positive,false) ELSE coalesce(positive,false) END;
END $$;
CREATE FUNCTION public.telegram_funnel_segment_matches(p_profile uuid,p_node jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.telegram_funnel_segment_evaluate(p_node,public.telegram_funnel_profile_facts(p_profile)); $$;
CREATE FUNCTION public.telegram_funnel_audience_service(p_segment jsonb,p_bot uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.telegram_funnel_validate_segment(p_segment);
 IF p_offset IS NULL OR p_limit IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_bot_unavailable';END IF;
 WITH matched AS MATERIALIZED(SELECT pr.id profile_id,pr.user_id,pr.full_name,public.telegram_funnel_known_dialog(pr.id,p_bot) has_dialog
 FROM public.profiles pr WHERE pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL AND public.telegram_funnel_segment_matches(pr.id,p_segment->'root')),
 paged AS(SELECT * FROM matched ORDER BY profile_id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),'available_count',(SELECT count(*) FROM matched WHERE has_dialog),'recipients',coalesce((SELECT jsonb_agg(to_jsonb(pg) ORDER BY profile_id) FROM paged pg),'[]')) INTO result;RETURN result;
END $$;
CREATE FUNCTION public.telegram_funnel_audience(p_segment jsonb,p_bot uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;RETURN public.telegram_funnel_audience_service(p_segment,p_bot,p_offset,p_limit);END $$;
CREATE FUNCTION public.telegram_funnel_prepare_audience(p_launch uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;ids uuid[];result jsonb;
BEGIN
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND OR l.status<>'active' THEN RAISE EXCEPTION 'funnel_launch_stopped';END IF;
 IF l.prepared_at IS NOT NULL THEN RETURN jsonb_build_object('state','already_prepared');END IF;
 PERFORM public.telegram_funnel_validate_segment(l.audience_filters);
 IF l.test_profile_id IS NOT NULL THEN ids:=ARRAY[l.test_profile_id]; ELSE
 SELECT coalesce(array_agg(pr.id ORDER BY pr.id),'{}') INTO ids FROM public.profiles pr WHERE pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL AND public.telegram_funnel_segment_matches(pr.id,l.audience_filters->'root');
 END IF;
 result:=public.telegram_funnel_enroll(l.id,ids);UPDATE public.telegram_funnel_launches SET prepared_at=now() WHERE id=l.id;
 RETURN jsonb_build_object('state','prepared','selected',cardinality(ids));
END $$;
CREATE FUNCTION public.telegram_funnel_due_deliveries(p_launch uuid DEFAULT NULL,p_limit integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Reconcile interrupted sends conservatively. Nothing is put back into the send queue.
 UPDATE public.telegram_funnel_deliveries SET status='unknown',error_code='interrupted_send' WHERE status='sending' AND started_at<now()-interval '30 seconds' AND(p_launch IS NULL OR EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments e WHERE e.id=enrollment_id AND e.launch_id=p_launch));
 RETURN (SELECT coalesce(jsonb_agg(id),'[]') FROM(SELECT d.id FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments e ON e.id=d.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id WHERE d.status='queued' AND e.status='active' AND l.status='active' AND l.scheduled_for<=now() AND(p_launch IS NULL OR l.id=p_launch) ORDER BY d.created_at,d.id LIMIT least(greatest(p_limit,1),10))q);
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_set_tags(uuid,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_set_tags(uuid,text[]) TO authenticated;
REVOKE ALL ON FUNCTION public.telegram_funnel_audience(jsonb,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_audience(jsonb,uuid,integer,integer) TO authenticated;
DO $acl$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('telegram_funnel_segment_node_ids','telegram_funnel_validate_segment','telegram_funnel_profile_facts','telegram_funnel_segment_evaluate','telegram_funnel_segment_matches','telegram_funnel_audience_service','telegram_funnel_prepare_audience','telegram_funnel_due_deliveries') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.name);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.name);END LOOP;
END $acl$;


CREATE FUNCTION public.telegram_funnel_report(p_funnel uuid DEFAULT NULL,p_profile uuid DEFAULT NULL,p_launch uuid DEFAULT NULL,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 WITH ens AS MATERIALIZED(SELECT e.* FROM public.telegram_funnel_enrollments e WHERE(p_funnel IS NULL OR e.funnel_id=p_funnel) AND(p_profile IS NULL OR e.profile_id=p_profile) AND(p_launch IS NULL OR e.launch_id=p_launch)),
 ds AS MATERIALIZED(SELECT d.* FROM public.telegram_funnel_deliveries d JOIN ens ON ens.id=d.enrollment_id),
 ev AS MATERIALIZED(SELECT v.* FROM public.telegram_funnel_events v JOIN ens ON ens.id=v.enrollment_id),
 paged AS(SELECT e.*,f.name funnel_name,pr.full_name profile_name,l.bot_id launch_bot_id,l.scheduled_for,l.audience_filters,l.graph_snapshot,
 coalesce(curblock.value->>'text','') current_block,cur.block_id current_block_id
 FROM ens e JOIN public.telegram_funnels f ON f.id=e.funnel_id JOIN public.profiles pr ON pr.id=e.profile_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id
 LEFT JOIN public.telegram_funnel_deliveries cur ON cur.id=e.current_delivery_id
 LEFT JOIN LATERAL(SELECT value FROM jsonb_array_elements(l.graph_snapshot->'blocks') WHERE value->>'id'=cur.block_id::text)curblock ON true
 ORDER BY e.created_at DESC,e.id LIMIT p_limit OFFSET p_offset),
 allblocks AS(SELECT d.id delivery_id,d.block_id,d.status,d.enrollment_id,b.value block FROM ds d JOIN ens e ON e.id=d.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id CROSS JOIN LATERAL jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b.value->>'id'=d.block_id::text),
 bs AS(SELECT block_id,max(block->>'text') block_text,count(*) FILTER(WHERE status='sent') received,count(DISTINCT enrollment_id) FILTER(WHERE status='sent') recipients,count(*) FILTER(WHERE status='failed') failed,count(*) FILTER(WHERE status='unknown' OR(status='sending' AND EXISTS(SELECT 1 FROM ds x WHERE x.id=delivery_id AND x.started_at<now()-interval '30 seconds'))) unknown FROM allblocks GROUP BY block_id),
 buttons AS(SELECT ab.block_id,btn.value->>'id' button_id,max(btn.value->>'text') text,max(btn.value->>'kind') kind,
 count(*) FILTER(WHERE ab.status='sent') shown,
 sum((SELECT count(*) FROM ev WHERE ev.delivery_id=ab.delivery_id AND ev.kind IN('button_pressed','url_clicked') AND ev.detail->>'button_id'=btn.value->>'id')) clicked,
 count(DISTINCT ab.enrollment_id) FILTER(WHERE EXISTS(SELECT 1 FROM ev WHERE ev.delivery_id=ab.delivery_id AND ev.kind IN('button_pressed','url_clicked') AND ev.detail->>'button_id'=btn.value->>'id')) unique_clicked
 FROM allblocks ab CROSS JOIN LATERAL jsonb_array_elements(ab.block->'buttons')btn GROUP BY ab.block_id,btn.value->>'id'),
 transitions AS(SELECT source.block_id source_block_id,target.block_id target_block_id,count(*) FILTER(WHERE target.status='sent') received FROM ds target JOIN ds source ON source.id=target.source_delivery_id GROUP BY source.block_id,target.block_id)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM ens),
 'enrollments',coalesce((SELECT jsonb_agg(to_jsonb(paged)-'graph_snapshot') FROM paged),'[]'),
 'deliveries',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM(SELECT ds.* FROM ds JOIN paged ON paged.id=ds.enrollment_id ORDER BY ds.created_at DESC LIMIT 1000)q),'[]'),
 'events',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM(SELECT ev.* FROM ev JOIN paged ON paged.id=ev.enrollment_id ORDER BY ev.created_at DESC LIMIT 2000)q),'[]'),
 'block_stats',coalesce((SELECT jsonb_agg(to_jsonb(bs)) FROM bs),'[]'),
 'button_stats',coalesce((SELECT jsonb_agg(to_jsonb(buttons)) FROM buttons),'[]'),
 'transitions',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('source_received',(SELECT received FROM bs WHERE block_id=t.source_block_id),'conversion',CASE WHEN(SELECT received FROM bs WHERE block_id=t.source_block_id)>0 THEN round(t.received::numeric/(SELECT received FROM bs WHERE block_id=t.source_block_id),4) ELSE 0 END)) FROM transitions t),'[]'),
 'summary',jsonb_build_object('selected',(SELECT count(*) FROM ens),'entered',(SELECT count(*) FROM ens WHERE status<>'skipped'),'skipped',(SELECT count(*) FROM ens WHERE status='skipped'),
 'sent',(SELECT count(*) FROM ds WHERE status='sent'),'failed',(SELECT count(*) FROM ds WHERE status='failed'),'unknown',(SELECT count(*) FROM ds WHERE status='unknown' OR(status='sending' AND started_at<now()-interval '30 seconds')),
 'clicked',(SELECT count(*) FROM ev WHERE kind='button_pressed'),'url_clicked',(SELECT count(*) FROM ev WHERE kind='url_clicked'),'converted',(SELECT count(DISTINCT enrollment_id) FROM ev WHERE kind='clicked'))) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.telegram_funnel_history(p_enrollment uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 IF p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 RETURN(SELECT jsonb_build_object('total',(SELECT count(*) FROM public.telegram_funnel_deliveries WHERE enrollment_id=p_enrollment),
 'deliveries',coalesce((SELECT jsonb_agg(to_jsonb(q)||jsonb_build_object('block',b.value,'events',coalesce((SELECT jsonb_agg(to_jsonb(ev) ORDER BY created_at) FROM public.telegram_funnel_events ev WHERE ev.delivery_id=q.id),'[]')))
 FROM(SELECT d.* FROM public.telegram_funnel_deliveries d WHERE d.enrollment_id=p_enrollment ORDER BY d.created_at,d.id LIMIT p_limit OFFSET p_offset)q
 JOIN public.telegram_funnel_enrollments e ON e.id=q.enrollment_id JOIN public.telegram_funnel_launches l ON l.id=e.launch_id
 CROSS JOIN LATERAL jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b.value->>'id'=q.block_id::text),'[]')));
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_report(uuid,uuid,uuid,integer,integer),public.telegram_funnel_history(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_report(uuid,uuid,uuid,integer,integer),public.telegram_funnel_history(uuid,integer,integer) TO authenticated;


CREATE FUNCTION public.telegram_funnel_begin_self_test(p_id uuid,p_funnel uuid,p_revision integer,p_bot uuid) RETURNS public.telegram_funnel_launches LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.telegram_funnels;l public.telegram_funnel_launches;p public.profiles;filters jsonb:='{"version":1,"root":{"id":"self","kind":"field","field":"status","operator":"eq","value":"active"}}';
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 SELECT * INTO f FROM public.telegram_funnels WHERE id=p_funnel FOR SHARE;
 IF NOT FOUND OR p_revision IS NULL OR f.revision<>p_revision OR f.status NOT IN('draft','active') THEN RAISE EXCEPTION 'funnel_not_testable';END IF;
 PERFORM public.telegram_funnel_validate_graph(f.start_block_id,f.blocks);
 SELECT * INTO p FROM public.profiles WHERE user_id=auth.uid() AND is_archived IS NOT TRUE AND status IS DISTINCT FROM 'archived' AND merged_to_profile_id IS NULL;
 IF NOT FOUND OR p.telegram_user_id IS NULL OR NOT public.telegram_funnel_known_dialog(p.id,p_bot) OR NOT EXISTS(SELECT 1 FROM public.telegram_bots WHERE id=p_bot AND status='active') THEN RAISE EXCEPTION 'funnel_self_dialog_required';END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN IF l.created_by IS DISTINCT FROM auth.uid() OR l.test_profile_id IS DISTINCT FROM p.id OR l.funnel_id<>f.id OR l.bot_id<>p_bot OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict';END IF;RETURN l;END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,created_by,test_profile_id)
 VALUES(p_id,f.id,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),filters,auth.uid(),p.id) RETURNING * INTO l;RETURN l;
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_begin_self_test(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_begin_self_test(uuid,uuid,integer,uuid) TO authenticated;

COMMIT;
