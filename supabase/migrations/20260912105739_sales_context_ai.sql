ALTER TABLE public.sales_campaigns ADD COLUMN ai_config jsonb NOT NULL DEFAULT '{"model":"google/gemini-3.1-pro-preview","max_tokens":8000,"timeout_seconds":60,"max_context_chars":750000,"vision_enabled":true,"max_image_bytes":8388608}';
ALTER TABLE public.sales_jobs ADD COLUMN context_attempts integer NOT NULL DEFAULT 0;
CREATE TABLE public.sales_media_observations (
 message_id uuid NOT NULL REFERENCES public.telegram_messages(id) ON DELETE CASCADE,
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 model text NOT NULL, version text NOT NULL, observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,source_hash,model,version)
);
ALTER TABLE public.sales_media_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_media_observations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sales_media_observations TO service_role;

CREATE FUNCTION public.sales_configure_ai(p_campaign uuid,p_actor uuid,p_config jsonb,p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; k text;
BEGIN
 IF NOT public.has_role_v2(p_actor,'super_admin') OR NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id FOR UPDATE;
 IF p.id IS NULL OR p.ai_config IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'configuration_changed'; END IF;
 IF p.mode<>'off' OR NOT coalesce(c.human_hold,false) OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
 IF jsonb_typeof(p_config) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid_ai_config'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_config))<>6
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_config) AS keys(name) WHERE keys.name NOT IN ('model','max_tokens','timeout_seconds','max_context_chars','vision_enabled','max_image_bytes')) THEN
  RAISE EXCEPTION 'invalid_ai_config';
 END IF;
 FOREACH k IN ARRAY ARRAY['max_tokens','timeout_seconds','max_context_chars','max_image_bytes'] LOOP
  IF jsonb_typeof(p_config->k) IS DISTINCT FROM 'number' OR coalesce(p_config->>k,'') !~ '^[0-9]+$' THEN RAISE EXCEPTION 'invalid_ai_config'; END IF;
 END LOOP;
 IF coalesce(p_config->>'model','') NOT IN ('google/gemini-3.1-pro-preview','google/gemini-3.8-flash','google/gemini-2.5-flash')
  OR jsonb_typeof(p_config->'vision_enabled') IS DISTINCT FROM 'boolean'
  OR (p_config->>'max_tokens')::integer NOT BETWEEN 2000 AND 16000
  OR (p_config->>'timeout_seconds')::integer NOT BETWEEN 15 AND 90
  OR (p_config->>'max_context_chars')::integer NOT BETWEEN 50000 AND 1500000
  OR (p_config->>'max_image_bytes')::integer NOT BETWEEN 1024 AND 8388608 THEN RAISE EXCEPTION 'invalid_ai_config'; END IF;
 UPDATE public.sales_campaigns SET ai_config=p_config WHERE id=p.id;
 UPDATE public.sales_conversations SET revision=revision+1 WHERE id=c.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='ai_configuration_changed' WHERE conversation_id=c.id AND status IN ('claimed','queued');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details) VALUES(c.id,'ai_configured',p_actor,jsonb_build_object('before',p.ai_config,'after',p_config));
 RETURN true;
END $$;

CREATE FUNCTION public.sales_defer_context(p_job uuid,p_token uuid,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 IF p_reason NOT IN ('media_upload_pending','media_processing_pending','media_source_changed') THEN RAISE EXCEPTION 'invalid_context_reason'; END IF;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision OR c.human_hold OR p.mode<>'owner_test' THEN RETURN false; END IF;
 IF j.context_attempts>=120 OR (p_reason='media_upload_pending' AND j.created_at<now()-interval '10 minutes') THEN
  PERFORM public.sales_handoff(j.id,j.claim_token,'media_needs_human'); RETURN false;
 END IF;
 UPDATE public.sales_jobs SET status='queued',claim_token=NULL,claimed_at=NULL,due_at=clock_timestamp()+interval '30 seconds',context_attempts=context_attempts+1,reason=p_reason WHERE id=j.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sales_configure_ai(uuid,uuid,jsonb,jsonb),public.sales_defer_context(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_configure_ai(uuid,uuid,jsonb,jsonb),public.sales_defer_context(uuid,uuid,text) TO service_role;

-- A media-only edit does not necessarily change message_text. Fence it in the
-- database too, including an edit between the worker's last read and dispatch.
CREATE FUNCTION public.sales_capture_media_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_conversations;
BEGIN
 IF (OLD.meta->>'file_id') IS NOT DISTINCT FROM (NEW.meta->>'file_id')
  AND (OLD.meta->>'file_type') IS NOT DISTINCT FROM (NEW.meta->>'file_type') THEN RETURN NEW; END IF;
 FOR c IN SELECT sc.* FROM public.sales_conversations sc JOIN public.sales_campaigns p ON p.id=sc.campaign_id
  WHERE p.test_user_id=NEW.user_id AND p.bot_id=NEW.bot_id AND p.business_account_id=NEW.business_account_id AND sc.started
  FOR UPDATE OF sc LOOP
  UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,
   revision=revision+1,reason='media_edited',updated_at=now() WHERE id=c.id;
  UPDATE public.sales_jobs SET status='cancelled',reason='media_edited' WHERE conversation_id=c.id AND status IN ('queued','claimed');
  INSERT INTO public.sales_events(conversation_id,event,source_message_id) VALUES(c.id,'media_edited',NEW.id);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sales_capture_media_edit() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_capture_media_edit() TO service_role;
CREATE TRIGGER sales_media_edit AFTER UPDATE OF meta ON public.telegram_messages FOR EACH ROW EXECUTE FUNCTION public.sales_capture_media_edit();
