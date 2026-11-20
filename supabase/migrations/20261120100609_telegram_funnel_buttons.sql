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
 scheduled_for timestamptz NOT NULL DEFAULT now(), prepared_at timestamptz, restart_existing boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'active' CHECK(status IN('active','stopped')),
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.telegram_funnel_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), launch_id uuid NOT NULL REFERENCES public.telegram_funnel_launches(id),
 funnel_id uuid NOT NULL REFERENCES public.telegram_funnels(id), profile_id uuid NOT NULL REFERENCES public.profiles(id),
 user_id uuid NOT NULL REFERENCES auth.users(id), bot_id uuid NOT NULL REFERENCES public.telegram_bots(id),
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
 SELECT auth.uid() IS NOT NULL AND (public.has_admin_section_access(auth.uid(),'communication','manage')
 OR public.has_role_v2(auth.uid(),'admin') OR public.has_role_v2(auth.uid(),'super_admin'));
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
  IF jsonb_typeof(b->'buttons') IS DISTINCT FROM 'array' OR jsonb_array_length(b->'buttons')=0 THEN RAISE EXCEPTION 'funnel_buttons_required'; END IF;
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
DECLARE f public.telegram_funnels;
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
 IF jsonb_typeof(p_filters) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'funnel_filters_invalid'; END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_id;
 IF FOUND THEN
  IF l.funnel_id<>p_funnel OR l.bot_id<>p_bot OR l.audience_filters<>p_filters OR l.restart_existing<>p_restart OR l.graph_snapshot->>'revision'<>p_revision::text THEN RAISE EXCEPTION 'funnel_launch_id_conflict'; END IF;
  RETURN l;
 END IF;
 INSERT INTO public.telegram_funnel_launches(id,funnel_id,bot_id,graph_snapshot,audience_filters,restart_existing,created_by,scheduled_for)
 VALUES(p_id,p_funnel,p_bot,jsonb_build_object('revision',f.revision,'start_block_id',f.start_block_id,'blocks',f.blocks),p_filters,p_restart,auth.uid(),coalesce(p_scheduled_at,now())) RETURNING * INTO l;
 RETURN l;
END $$;

CREATE FUNCTION public.telegram_funnel_enroll(p_launch uuid,p_profiles uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches; p record; old public.telegram_funnel_enrollments; e uuid; d uuid; has_dialog boolean; result jsonb:='[]';
BEGIN
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=p_launch FOR UPDATE;
 IF NOT FOUND OR l.status<>'active' THEN RAISE EXCEPTION 'funnel_launch_stopped'; END IF;
 FOR p IN SELECT pr.* FROM public.profiles pr WHERE pr.id=ANY(p_profiles) AND pr.user_id IS NOT NULL AND pr.is_archived IS NOT TRUE ORDER BY pr.id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(l.funnel_id::text||':'||p.id::text,0));
  SELECT id INTO e FROM public.telegram_funnel_enrollments WHERE launch_id=l.id AND profile_id=p.id;
  IF FOUND THEN result:=result||jsonb_build_array(jsonb_build_object('enrollment_id',e,'duplicate',true)); CONTINUE; END IF;
  SELECT * INTO old FROM public.telegram_funnel_enrollments WHERE funnel_id=l.funnel_id AND profile_id=p.id AND status='active' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries ds JOIN public.telegram_funnel_enrollments en ON en.id=ds.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=p.id AND ds.status IN('sending','unknown')) THEN RAISE EXCEPTION 'funnel_unresolved_delivery'; END IF;
  IF old.id IS NOT NULL THEN
   IF NOT l.restart_existing THEN result:=result||jsonb_build_array(jsonb_build_object('profile_id',p.id,'skipped','already_active')); CONTINUE; END IF;
   UPDATE public.telegram_funnel_enrollments SET status='stopped',reason='explicit_restart',stopped_at=now() WHERE id=old.id;
   UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=old.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='explicit_restart' WHERE enrollment_id=old.id AND status='queued';
   INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind) VALUES(old.id,'restart:'||l.id::text||':'||old.id::text,'restarted');
  END IF;
  has_dialog:=p.telegram_user_id IS NOT NULL AND (p.telegram_link_bot_id=l.bot_id OR EXISTS(SELECT 1 FROM public.telegram_messages m WHERE m.user_id=p.user_id AND m.bot_id=l.bot_id AND m.telegram_user_id=p.telegram_user_id AND m.transport='bot'));
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
 IF t.bot_id IS DISTINCT FROM p_bot OR t.chat_id IS DISTINCT FROM p_chat OR t.telegram_user_id IS DISTINCT FROM p_user OR coalesce(p_message,0)<=0
  OR d.enrollment_id<>e.id OR d.block_id<>t.source_block_id THEN RETURN jsonb_build_object('state','binding_mismatch'); END IF;
 INSERT INTO public.telegram_funnel_callback_receipts(token_hash,bot_id,chat_id,telegram_user_id,provider_message_id,callback_id,update_id)
 VALUES(p_hash,p_bot,p_chat,p_user,p_message,p_callback,p_update) ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM public.telegram_funnel_callback_receipts WHERE bot_id=p_bot AND (callback_id=p_callback OR update_id=p_update) ORDER BY created_at LIMIT 1 FOR UPDATE;
 IF receipt.token_hash<>p_hash OR receipt.chat_id<>p_chat OR receipt.telegram_user_id<>p_user OR receipt.provider_message_id<>p_message OR receipt.callback_id<>p_callback OR receipt.update_id<>p_update THEN RETURN jsonb_build_object('state','duplicate'); END IF;
 IF d.status IN('sending','unknown') AND t.provider_message_id IS NULL THEN RETURN jsonb_build_object('state','deferred'); END IF;
 IF d.status<>'sent' OR t.provider_message_id IS DISTINCT FROM p_message THEN UPDATE public.telegram_funnel_callback_receipts SET state='invalid' WHERE id=receipt.id; RETURN jsonb_build_object('state','binding_mismatch'); END IF;
 IF t.dispatch_id IS NOT NULL THEN RETURN jsonb_build_object('state','duplicate','delivery_id',t.dispatch_id); END IF;
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
CREATE FUNCTION public.telegram_funnel_reconcile_callbacks(p_source_delivery uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;outcome jsonb;result jsonb:='[]';
BEGIN
 FOR r IN SELECT cr.* FROM public.telegram_funnel_callback_receipts cr JOIN public.telegram_funnel_callback_tokens tok ON tok.token_hash=cr.token_hash
 JOIN public.telegram_funnel_deliveries d ON d.id=tok.source_delivery_id WHERE cr.state='pending' AND d.status='sent'
 AND (p_source_delivery IS NULL OR d.id=p_source_delivery) ORDER BY cr.created_at LIMIT 100 LOOP
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
 VALUES(d.enrollment_id,d.id,'url:'||d.id::text||':'||t.button_id::text,'url_clicked',jsonb_build_object('button_id',t.button_id)) ON CONFLICT DO NOTHING; END IF;
 RETURN jsonb_build_object('ok',true,'url',t.target_url);
END $$;
REVOKE ALL ON FUNCTION public.telegram_funnel_delivery_context(uuid),public.telegram_funnel_prepare_links(uuid,uuid,jsonb),public.telegram_funnel_reconcile_callbacks(uuid),public.telegram_funnel_track_link(text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.telegram_funnel_delivery_context(uuid),public.telegram_funnel_prepare_links(uuid,uuid,jsonb),public.telegram_funnel_reconcile_callbacks(uuid),public.telegram_funnel_track_link(text,boolean) TO service_role;

COMMIT;
