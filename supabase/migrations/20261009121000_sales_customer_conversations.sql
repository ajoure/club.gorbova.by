-- Separate recipient state; no campaign is enabled and no customer is created here.
ALTER TABLE public.sales_campaigns
  ADD COLUMN source_page_id uuid REFERENCES public.site_pages(id),
  ADD COLUMN source_block_id uuid,
  ALTER COLUMN test_user_id DROP NOT NULL;
ALTER TABLE public.sales_campaigns DROP CONSTRAINT sales_campaigns_mode_check;
ALTER TABLE public.sales_campaigns ADD CONSTRAINT sales_campaigns_mode_check
  CHECK(mode IN ('off','owner_test','questionnaire_customer'));
ALTER TABLE public.sales_campaigns ADD CONSTRAINT sales_campaigns_recipient_scope_check CHECK (
  (test_user_id IS NOT NULL AND source_page_id IS NULL AND source_block_id IS NULL AND mode IN ('off','owner_test'))
  OR (test_user_id IS NULL AND source_page_id IS NOT NULL AND source_block_id IS NOT NULL AND mode IN ('off','questionnaire_customer'))
);
CREATE UNIQUE INDEX sales_campaigns_customer_scope ON public.sales_campaigns(bot_id,business_account_id)
  WHERE test_user_id IS NULL;
ALTER TABLE public.sales_conversations ADD COLUMN user_id uuid REFERENCES auth.users(id);
UPDATE public.sales_conversations conversation SET user_id=campaign.test_user_id
  FROM public.sales_campaigns campaign WHERE campaign.id=conversation.campaign_id;
ALTER TABLE public.sales_conversations ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.sales_conversations DROP CONSTRAINT sales_conversations_campaign_id_key;
ALTER TABLE public.sales_conversations ADD CONSTRAINT sales_conversations_campaign_user_key UNIQUE(campaign_id,user_id);

CREATE FUNCTION public.sales_conversation_enabled(p_campaign uuid,p_conversation uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.sales_campaigns p
    JOIN public.sales_conversations c ON c.campaign_id=p.id
    JOIN public.telegram_messages m ON m.id=c.last_inbound_id
    WHERE p.id=p_campaign AND c.id=p_conversation AND m.user_id=c.user_id
      AND m.bot_id=p.bot_id AND m.business_account_id=p.business_account_id AND m.transport='business'
      AND m.direction='incoming'
      AND ((p.mode='owner_test' AND c.user_id=p.test_user_id)
        OR (p.mode='questionnaire_customer' AND p.test_user_id IS NULL
          AND p.knowledge->>'client_release_approved'='true'
          AND p.enabled_at IS NOT NULL AND m.created_at>=p.enabled_at
          AND public.site_questionnaire_sales_identity(p.source_page_id,p.source_block_id,c.user_id,m.telegram_user_id))));
$$;
REVOKE ALL ON FUNCTION public.sales_conversation_enabled(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_conversation_enabled(uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.sales_capture_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; own_bot bigint; is_echo boolean; seq bigint;
BEGIN
 IF NEW.transport IS DISTINCT FROM 'business' THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE bot_id=NEW.bot_id AND business_account_id=NEW.business_account_id
   AND (test_user_id=NEW.user_id OR test_user_id IS NULL)
   ORDER BY test_user_id NULLS LAST LIMIT 1 FOR SHARE;
 IF NOT FOUND OR NEW.user_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id AND user_id=NEW.user_id FOR UPDATE;
 IF p.test_user_id IS NULL THEN
   -- No new dialogue from a page view, manual reply, edit, old webhook or unlinked identity.
   IF (c.id IS NULL OR NEW.direction='incoming')
     AND NOT public.site_questionnaire_sales_identity(p.source_page_id,p.source_block_id,NEW.user_id,NEW.telegram_user_id) THEN RETURN NEW; END IF;
   IF c.id IS NULL AND (TG_OP<>'INSERT' OR NEW.direction<>'incoming' OR NEW.message_origin IS DISTINCT FROM 'client'
     OR p.mode<>'questionnaire_customer' OR p.enabled_at IS NULL OR NEW.created_at<p.enabled_at
     OR p.knowledge->>'client_release_approved' IS DISTINCT FROM 'true'
     OR NEW.meta->>'source' IS DISTINCT FROM 'telegram_business' OR coalesce((NEW.meta->>'edited')::boolean,false)
     OR lower(regexp_replace(btrim(coalesce(NEW.message_text,'')),'\s+',' ','g'))<>lower(regexp_replace(btrim(p.trigger_phrase),'\s+',' ','g')))
     THEN RETURN NEW; END IF;
   IF c.id IS NULL THEN
     IF coalesce(NEW.meta->'raw'->>'date','') !~ '^[0-9]{9,12}$' THEN RETURN NEW; END IF;
     IF to_timestamp((NEW.meta->'raw'->>'date')::double precision)<p.enabled_at-interval '1 second' THEN RETURN NEW; END IF;
   END IF;
 END IF;
 INSERT INTO public.sales_conversations(campaign_id,user_id) VALUES(p.id,NEW.user_id) ON CONFLICT(campaign_id,user_id) DO NOTHING;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id AND user_id=NEW.user_id FOR UPDATE;
 IF TG_OP='UPDATE' THEN
   IF NEW.message_text IS NOT DISTINCT FROM OLD.message_text THEN RETURN NEW; END IF;
   UPDATE public.sales_conversations SET revision=revision+1,updated_at=now() WHERE id=c.id;
   UPDATE public.sales_jobs SET status='cancelled',reason='edited_history' WHERE conversation_id=c.id AND status IN ('queued','claimed');
   -- An edit invalidates a draft, but never activates or schedules a new reply.
   RETURN NEW;
 END IF;
 SELECT bot_id INTO own_bot FROM public.telegram_bots WHERE id=p.bot_id;
 is_echo := NEW.direction='outgoing' AND (
   (NEW.message_origin='bot_automation' AND NEW.meta->>'sales_job_id' IS NOT NULL AND EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','sent') AND (delivery_message_id=NEW.message_id OR delivery_message_id IS NULL)))
   OR (own_bot IS NOT NULL AND NEW.meta->>'sender_business_bot_id'=own_bot::text)
   OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND delivery_message_id=NEW.message_id AND status='sent'));
 IF is_echo THEN RETURN NEW; END IF;
 IF NEW.direction='outgoing' THEN
   UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state='DELIVERY_UNKNOWN' THEN state ELSE 'HUMAN_HOLD' END,
     stage=CASE WHEN started AND stage='qualification' THEN 'consultation' ELSE stage END,
     revision=revision+1,answered_seq=greatest(answered_seq,least(last_inbound_seq,coalesce(NEW.message_id,last_inbound_seq))),reason='manual_reply',updated_at=now() WHERE id=c.id;
   UPDATE public.sales_jobs SET status='cancelled',reason='manual_reply' WHERE conversation_id=c.id AND status IN ('queued','claimed');
   INSERT INTO public.sales_events(conversation_id,event,source_message_id) VALUES(c.id,'manual_reply',NEW.id);
   RETURN NEW;
 END IF;
 IF NEW.direction<>'incoming' OR NEW.message_origin IS DISTINCT FROM 'client'
   OR coalesce((NEW.meta->>'edited')::boolean,false) OR p.mode NOT IN ('owner_test','questionnaire_customer')
   OR p.enabled_at IS NULL OR NEW.created_at<p.enabled_at
   OR NEW.meta->>'source' IS DISTINCT FROM 'telegram_business' THEN RETURN NEW; END IF;
 IF coalesce(NEW.meta->'raw'->>'date','') !~ '^[0-9]{9,12}$' THEN RETURN NEW; END IF;
 IF to_timestamp((NEW.meta->'raw'->>'date')::double precision)<p.enabled_at-interval '1 second' THEN RETURN NEW; END IF;
 seq := NEW.message_id;
 -- Monotonic Telegram IDs discard webhook retries and out-of-order stale inbound.
 IF seq IS NULL OR seq<=c.last_inbound_seq THEN RETURN NEW; END IF;
 IF NOT c.started AND c.state='OFF' AND NOT c.human_hold AND
   lower(regexp_replace(btrim(coalesce(NEW.message_text,'')),'\s+',' ','g'))=lower(regexp_replace(btrim(p.trigger_phrase),'\s+',' ','g')) THEN
   c.started:=true; c.state:='READY';
   INSERT INTO public.sales_events(conversation_id,event,source_message_id,details)
   VALUES(c.id,'activated',NEW.id,CASE WHEN p.mode='owner_test'
     THEN '{"mode":"owner_test","preregistration_bypass":"explicit_single_dialog_test"}'::jsonb
     ELSE jsonb_build_object('mode',p.mode,'source_page_id',p.source_page_id,'source_block_id',p.source_block_id) END);
 END IF;
 UPDATE public.sales_conversations SET started=c.started,
   state=CASE WHEN c.started AND c.state IN ('READY','WAIT_CUSTOMER') THEN 'READY' ELSE c.state END,
   revision=revision+1,last_inbound_id=NEW.id,last_inbound_seq=seq,last_inbound_at=NEW.created_at,updated_at=now() WHERE id=c.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='newer_inbound' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 PERFORM public.sales_queue_reply(c.id);
 RETURN NEW;
END $$;

CREATE FUNCTION public.sales_control_conversation(p_campaign uuid,p_user uuid,p_action text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; last_out bigint;
BEGIN
 IF NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'communication_manage_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
 IF p.test_user_id IS NOT NULL AND p.test_user_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'conversation_scope_invalid'; END IF;
 IF p.test_user_id IS NOT NULL THEN
   INSERT INTO public.sales_conversations(campaign_id,user_id) VALUES(p.id,p_user) ON CONFLICT DO NOTHING;
 END IF;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 IF p_action='pause' THEN
   UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,
     revision=revision+1,reason='operator_pause',updated_at=now() WHERE id=c.id;
   UPDATE public.sales_jobs SET status='cancelled',reason='operator_pause' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 ELSIF p_action='resume' THEN
   IF c.state<>'HUMAN_HOLD' OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'resume_blocked'; END IF;
   IF p.test_user_id IS NULL AND NOT public.sales_conversation_enabled(p.id,c.id) THEN RAISE EXCEPTION 'questionnaire_identity_required'; END IF;
   SELECT max(message_id) INTO last_out FROM public.telegram_messages WHERE user_id=c.user_id AND bot_id=p.bot_id
     AND business_account_id=p.business_account_id AND direction='outgoing'
     AND NOT EXISTS(SELECT 1 FROM public.sales_jobs sj WHERE sj.conversation_id=c.id AND sj.delivery_message_id=telegram_messages.message_id AND sj.status='sent');
   UPDATE public.sales_conversations SET human_hold=false,revision=revision+1,
     answered_seq=greatest(answered_seq,CASE WHEN coalesce(last_out,0)>=last_inbound_seq THEN last_inbound_seq ELSE answered_seq END),
     state=CASE WHEN NOT started THEN 'OFF' WHEN coalesce(last_out,0)>=last_inbound_seq OR answered_seq>=last_inbound_seq THEN 'WAIT_CUSTOMER' ELSE 'READY' END,
     reason=NULL,updated_at=now() WHERE id=c.id;
   PERFORM public.sales_queue_reply(c.id);
 ELSE RAISE EXCEPTION 'invalid_conversation_action'; END IF;
 INSERT INTO public.sales_events(conversation_id,event,actor_id) VALUES(c.id,p_action,p_actor);
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.sales_control_conversation(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_control_conversation(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sales_control(p_campaign uuid,p_action text,p_actor uuid,p_min integer DEFAULT NULL,p_max integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; checked jsonb;
BEGIN
 IF NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'communication_manage_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
 IF p.test_user_id IS NOT NULL THEN
   INSERT INTO public.sales_conversations(campaign_id,user_id) VALUES(p.id,p.test_user_id) ON CONFLICT DO NOTHING;
 END IF;
 IF p_action IN ('pause','resume') THEN
   IF p.test_user_id IS NULL THEN RAISE EXCEPTION 'conversation_user_required'; END IF;
   RETURN public.sales_control_conversation(p.id,p.test_user_id,p_action,p_actor);
 END IF;
 PERFORM id FROM public.sales_conversations WHERE campaign_id=p.id ORDER BY id FOR UPDATE;
 IF p_action='delay' THEN
   IF NOT public.has_role_v2(p_actor,'super_admin') THEN RAISE EXCEPTION 'owner_required'; END IF;
   IF p_min IS NULL OR p_max IS NULL THEN RAISE EXCEPTION 'delay_required'; END IF;
   UPDATE public.sales_campaigns SET delay_min_seconds=p_min,delay_max_seconds=p_max WHERE id=p.id;
 ELSIF p_action='enable' THEN
   IF NOT public.has_role_v2(p_actor,'super_admin') THEN RAISE EXCEPTION 'owner_required'; END IF;
   IF jsonb_array_length(coalesce(p.knowledge->'facts','[]'))=0 THEN RAISE EXCEPTION 'knowledge_not_ready'; END IF;
   IF p.test_user_id IS NOT NULL THEN
     IF p.knowledge->>'release_mode' IS DISTINCT FROM 'owner_test' THEN RAISE EXCEPTION 'knowledge_not_ready'; END IF;
     IF p.mode='off' THEN UPDATE public.sales_campaigns SET mode='owner_test',enabled_at=clock_timestamp() WHERE id=p.id; END IF;
   ELSE
     IF NOT EXISTS(SELECT 1 FROM public.site_pages page CROSS JOIN LATERAL jsonb_array_elements(page.blocks) block
       WHERE page.id=p.source_page_id AND page.status='published' AND block->>'id'=p.source_block_id::text
         AND block->>'type'='form' AND block->'content'->'questionnaire_first'='true'::jsonb
         AND block->'content'->'auth_mode'='true'::jsonb) THEN RAISE EXCEPTION 'questionnaire_not_ready'; END IF;
     IF p.knowledge->>'release_mode' IS DISTINCT FROM 'questionnaire_customer' THEN RAISE EXCEPTION 'knowledge_not_ready'; END IF;
     checked:=public.sales_check_knowledge_facts(p.id,p.knowledge->'facts');
     IF (checked->>'valid')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'knowledge_not_ready'; END IF;
     IF p.mode='off' THEN UPDATE public.sales_campaigns SET mode='questionnaire_customer',enabled_at=clock_timestamp(),
       knowledge=knowledge||jsonb_build_object('client_release_approved',true) WHERE id=p.id; END IF;
   END IF;
 ELSIF p_action='disable' THEN
   UPDATE public.sales_campaigns SET mode='off' WHERE id=p.id;
   UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,
     revision=revision+1,reason='disabled' WHERE campaign_id=p.id;
   UPDATE public.sales_jobs SET status='cancelled',reason='disabled' WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('queued','claimed');
 ELSE RAISE EXCEPTION 'invalid_action'; END IF;
 INSERT INTO public.sales_events(conversation_id,event,actor_id) SELECT id,p_action,p_actor FROM public.sales_conversations WHERE campaign_id=p.id;
 RETURN jsonb_build_object('ok',true);
END $$;


-- Latest baseline: 20260930101631_cb21_conversation_delay.sql
CREATE OR REPLACE FUNCTION public.sales_configure_followup_delay(
 p_campaign uuid,p_actor uuid,p_min integer,p_max integer
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT public.has_admin_section_access(p_actor,'communication','manage')
   OR NOT public.has_role_v2(p_actor,'super_admin') THEN RAISE EXCEPTION 'owner_required'; END IF;
 IF p_min IS NULL OR p_max IS NULL OR p_min NOT BETWEEN 1 AND 60
   OR p_max<p_min OR p_max>120 THEN RAISE EXCEPTION 'invalid_followup_delay'; END IF;
 -- Timing changes affect later incoming turns, never reschedule an existing job.
 UPDATE public.sales_campaigns SET followup_min_seconds=p_min,followup_max_seconds=p_max WHERE id=p_campaign;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.sales_configure_followup_delay(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_configure_followup_delay(uuid,uuid,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.sales_queue_reply(p_conversation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_conversations; p public.sales_campaigns; j uuid;
  delay_min integer; delay_max integer;
BEGIN
  SELECT * INTO c FROM public.sales_conversations WHERE id=p_conversation FOR UPDATE;
  SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
  IF NOT public.sales_conversation_enabled(p.id,c.id) OR NOT c.started OR c.human_hold OR c.state NOT IN ('READY','WAIT_CUSTOMER')
    OR c.last_inbound_seq<=c.answered_seq OR c.last_inbound_at<=now()-interval '24 hours'
    OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status='sent'
    AND kind='reply' AND policy_version=p.policy_version) THEN
    delay_min:=p.followup_min_seconds; delay_max:=p.followup_max_seconds;
  ELSE
    delay_min:=p.delay_min_seconds; delay_max:=p.delay_max_seconds;
  END IF;
  INSERT INTO public.sales_jobs(conversation_id,inbound_id,inbound_seq,revision,due_at,policy_version,knowledge_version)
  VALUES(c.id,c.last_inbound_id,c.last_inbound_seq,c.revision,
    clock_timestamp()+make_interval(secs=>delay_min+floor(random()*(delay_max-delay_min+1))::int),
    p.policy_version,p.knowledge_version)
  ON CONFLICT(conversation_id,inbound_id,revision,kind) DO NOTHING RETURNING id INTO j;
  RETURN j;
END $$;

-- Latest baseline: 20260912082931_cb21_dialogue_delivery_windows.sql
CREATE OR REPLACE FUNCTION public.sales_queue_reminder(p_conversation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_conversations; p public.sales_campaigns; last_reply public.sales_jobs; due timestamptz; result uuid;
BEGIN
 SELECT * INTO c FROM public.sales_conversations WHERE id=p_conversation FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF p.policy_version<>'cb21-v2' OR NOT public.sales_conversation_enabled(p.id,c.id) OR c.human_hold OR c.state<>'WAIT_CUSTOMER' OR NOT c.started
    OR c.last_inbound_seq<>c.answered_seq THEN RETURN NULL; END IF;
 SELECT * INTO last_reply FROM public.sales_jobs WHERE conversation_id=c.id AND inbound_id=c.last_inbound_id AND status='sent'
   AND kind='reply' AND policy_version=p.policy_version ORDER BY delivery_message_id DESC LIMIT 1;
 IF NOT FOUND OR coalesce(last_reply.candidate->>'question_id','none')='none' THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND inbound_id=c.last_inbound_id AND kind='reminder') THEN RETURN NULL; END IF;
 due:=public.sales_reminder_due(c.last_inbound_at,last_reply.claimed_at);
 IF due IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.sales_jobs(conversation_id,inbound_id,inbound_seq,revision,due_at,policy_version,knowledge_version,kind)
 VALUES(c.id,c.last_inbound_id,c.last_inbound_seq,c.revision,due,p.policy_version,p.knowledge_version,'reminder')
 ON CONFLICT DO NOTHING RETURNING id INTO result;
 RETURN result;
END $$;

-- Latest baseline: 20260930101631_cb21_conversation_delay.sql
CREATE OR REPLACE FUNCTION public.sales_delivery_gate(p_job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns; event_state text;
 t timestamptz:=clock_timestamp(); local_time timestamp; next_time timestamptz; first_reply boolean;
 delay_min integer; delay_max integer;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF NOT public.sales_conversation_enabled(p.id,c.id) THEN RETURN false; END IF;
 IF p.policy_version<>'cb21-v2' THEN RETURN j.kind='reply'; END IF;
 IF j.due_at>t THEN RETURN false; END IF;
 IF c.last_inbound_at<=t-(CASE WHEN j.kind='reminder' THEN interval '23 hours 45 minutes' ELSE interval '23 hours 59 minutes' END) THEN
  UPDATE public.sales_jobs SET status='cancelled',reason='telegram_window_expired' WHERE id=j.id; RETURN false;
 END IF;
 SELECT NOT EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status='sent' AND policy_version=p.policy_version AND kind='reply') INTO first_reply;
 IF first_reply OR j.kind='reminder' THEN
   delay_min:=p.delay_min_seconds; delay_max:=p.delay_max_seconds;
 ELSE
   delay_min:=p.followup_min_seconds; delay_max:=p.followup_max_seconds;
 END IF;
 event_state:=public.sales_broadcast_state(t);
 IF event_state<>'clear' THEN
  UPDATE public.sales_jobs SET status='queued',due_at=t+interval '1 minute',claim_token=NULL,claimed_at=NULL,reason='event_'||event_state WHERE id=j.id;
  RETURN false;
 END IF;
 IF j.reason IN ('event_active','event_unknown') THEN
  UPDATE public.sales_jobs SET status='queued',due_at=t+make_interval(secs=>delay_min+floor(random()*(delay_max-delay_min+1))::int),claim_token=NULL,claimed_at=NULL,reason='event_ended_delay' WHERE id=j.id;
  RETURN false;
 END IF;
 local_time:=t AT TIME ZONE 'Europe/Minsk';
 IF (first_reply OR j.kind='reminder') AND (local_time::time<time '08:00' OR local_time::time>=time '23:00') THEN
  next_time:=((local_time::date+CASE WHEN local_time::time>=time '23:00' THEN 1 ELSE 0 END)+time '08:00') AT TIME ZONE 'Europe/Minsk';
  UPDATE public.sales_jobs SET status='queued',due_at=next_time+make_interval(secs=>delay_min+floor(random()*(delay_max-delay_min+1))::int),claim_token=NULL,claimed_at=NULL,reason='outside_business_hours' WHERE id=j.id;
  RETURN false;
 END IF;
 RETURN true;
END $$;

-- Latest baseline: 20260912082931_cb21_dialogue_delivery_windows.sql
CREATE OR REPLACE FUNCTION public.sales_claim_job() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns; stale public.sales_jobs;
BEGIN
 -- Never retry an ambiguous provider/delivery attempt. Expose expired leases for review.
 UPDATE public.sales_conversations SET state='DELIVERY_UNKNOWN',human_hold=true,reason='worker_interrupted',revision=revision+1
 WHERE id IN (SELECT conversation_id FROM public.sales_jobs WHERE status='sending' AND claimed_at<now()-interval '3 minutes');
 UPDATE public.sales_jobs SET status='unknown',reason='worker_interrupted' WHERE status='sending' AND claimed_at<now()-interval '3 minutes';
 FOR stale IN SELECT * FROM public.sales_jobs WHERE status='claimed' AND claimed_at<now()-interval '3 minutes' LOOP
  PERFORM public.sales_handoff(stale.id,stale.claim_token,'generation_interrupted');
 END LOOP;
 SELECT sc.* INTO c FROM public.sales_conversations sc WHERE EXISTS (SELECT 1 FROM public.sales_jobs sj WHERE sj.conversation_id=sc.id AND sj.status='queued' AND sj.due_at<=clock_timestamp()) ORDER BY sc.updated_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO j FROM public.sales_jobs WHERE conversation_id=c.id AND status='queued' AND due_at<=clock_timestamp() ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF NOT public.sales_conversation_enabled(p.id,c.id) OR c.human_hold OR ((j.kind='reply' AND c.state<>'READY') OR (j.kind='reminder' AND c.state<>'WAIT_CUSTOMER')) OR c.revision<>j.revision
   OR p.policy_version<>j.policy_version OR p.knowledge_version<>j.knowledge_version
   OR c.last_inbound_seq<>j.inbound_seq OR ((j.kind='reply' AND c.answered_seq>=j.inbound_seq) OR (j.kind='reminder' AND c.answered_seq<>j.inbound_seq)) OR c.last_inbound_at<=now()-interval '24 hours'
   OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN
   UPDATE public.sales_jobs SET status='cancelled',reason='scope_or_history_changed' WHERE id=j.id; RETURN NULL;
 END IF;
 IF NOT public.sales_delivery_gate(j.id) THEN RETURN NULL; END IF;
 UPDATE public.sales_jobs SET status='claimed',claim_token=gen_random_uuid(),claimed_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

-- Latest baseline: 20260912082931_cb21_dialogue_delivery_windows.sql
CREATE OR REPLACE FUNCTION public.sales_begin_send(p_job uuid,p_token uuid,p_candidate jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision OR c.human_hold OR ((j.kind='reply' AND c.state<>'READY') OR (j.kind='reminder' AND c.state<>'WAIT_CUSTOMER'))
   OR NOT public.sales_conversation_enabled(p.id,c.id) OR p.policy_version<>j.policy_version OR p.knowledge_version<>j.knowledge_version
   OR c.last_inbound_seq<>j.inbound_seq OR ((j.kind='reply' AND c.answered_seq>=j.inbound_seq) OR (j.kind='reminder' AND c.answered_seq<>j.inbound_seq)) OR c.last_inbound_at<=now()-interval '24 hours'
   OR NOT EXISTS(SELECT 1 FROM public.telegram_business_connections WHERE id=p.business_account_id AND bot_id=p.bot_id AND can_reply AND is_enabled)
   THEN RETURN false; END IF;
 IF NOT public.sales_delivery_gate(j.id) THEN RETURN false; END IF;
 INSERT INTO public.notification_outbox(user_id,message_type,idempotency_key,source,status,meta)
 VALUES(c.user_id,'sales_reply',CASE WHEN j.kind='reminder' THEN 'sales_reminder:' ELSE 'sales_reply:' END||c.id||':'||j.inbound_id,'sales_runtime','sending',jsonb_build_object('job_id',j.id)) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.sales_jobs SET status='sending',candidate=p_candidate,claimed_at=clock_timestamp() WHERE id=j.id;
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details) VALUES(c.id,'dispatch_committed',j.inbound_id,jsonb_build_object('job_id',j.id));
 RETURN true;
END $$;

-- Latest baseline: 20260912082931_cb21_dialogue_delivery_windows.sql
CREATE OR REPLACE FUNCTION public.sales_finish_send(p_job uuid,p_token uuid,p_message_id bigint,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 IF j.status NOT IN ('sending','unknown') OR j.claim_token IS DISTINCT FROM p_token THEN RETURN false; END IF;
 IF p_message_id IS NULL THEN
   UPDATE public.sales_jobs SET status='unknown',reason=coalesce(p_error,'delivery_unknown') WHERE id=j.id;
   UPDATE public.sales_conversations SET state='DELIVERY_UNKNOWN',human_hold=true,reason='delivery_unknown',revision=revision+1 WHERE id=c.id;
 ELSE
   INSERT INTO public.telegram_messages(user_id,telegram_user_id,bot_id,direction,message_text,message_id,status,is_read,transport,business_connection_id,business_account_id,message_origin,meta)
   SELECT c.user_id,m.telegram_user_id,p.bot_id,'outgoing',j.candidate->>'text',p_message_id,'sent',true,'business',b.connection_id,b.id,'bot_automation',
     jsonb_build_object('sales_job_id',j.id,'source','sales_runtime')
   FROM public.sales_campaigns p JOIN public.telegram_business_connections b ON b.id=p.business_account_id
    JOIN public.telegram_messages m ON m.id=j.inbound_id WHERE p.id=c.campaign_id
   ON CONFLICT(bot_id,business_connection_id,telegram_user_id,message_id) DO NOTHING;
   UPDATE public.sales_jobs SET status='sent',delivery_message_id=p_message_id,reason=NULL WHERE id=j.id;
   UPDATE public.sales_conversations SET answered_seq=greatest(answered_seq,j.inbound_seq),stage=coalesce(j.candidate->>'stage',stage),
     state=CASE WHEN human_hold OR state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state WHEN last_inbound_seq>j.inbound_seq THEN 'READY' ELSE 'WAIT_CUSTOMER' END,
     updated_at=now() WHERE id=c.id;
   -- A newer inbound during the Telegram request was not answered by this reply.
   PERFORM public.sales_queue_reply(c.id);
   IF j.kind='reply' THEN PERFORM public.sales_queue_reminder(c.id); END IF;
 END IF;
 UPDATE public.notification_outbox SET status=CASE WHEN p_message_id IS NULL THEN 'unknown' ELSE 'sent' END,
  sent_at=CASE WHEN p_message_id IS NOT NULL THEN now() END,blocked_reason=p_error,
  meta=meta||jsonb_build_object('telegram_message_id',p_message_id)
 WHERE idempotency_key=CASE WHEN j.kind='reminder' THEN 'sales_reminder:' ELSE 'sales_reply:' END||c.id||':'||j.inbound_id;
 RETURN true;
END $$;

-- Latest baseline: 20260912063632_cb21_telegram_sales_runtime.sql
CREATE OR REPLACE FUNCTION public.sales_handoff(p_job uuid,p_token uuid,p_reason text,p_stop boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns; m public.telegram_messages; assignment uuid;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 SELECT * INTO m FROM public.telegram_messages WHERE id=j.inbound_id AND user_id=c.user_id AND bot_id=p.bot_id AND business_account_id=p.business_account_id AND direction='incoming';
 IF NOT FOUND OR NOT public.has_admin_section_access(p.assignee_user_id,'communication','manage') THEN RAISE EXCEPTION 'handoff_scope_invalid'; END IF;
 UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN p_stop THEN 'STOPPED' ELSE 'HUMAN_HOLD' END,reason=p_reason,revision=revision+1 WHERE id=c.id;
 UPDATE public.sales_jobs SET status='held',reason=p_reason WHERE id=j.id;
 INSERT INTO public.contact_center_message_assignments(source,source_message_id,assignee_user_id,assigned_by_user_id,note)
 VALUES('telegram',m.id,p.assignee_user_id,p.assignee_user_id,'Автопродажи: '||left(p_reason,100))
 ON CONFLICT(source_message_id) WHERE resolved_at IS NULL DO UPDATE SET
   assignee_user_id=EXCLUDED.assignee_user_id,assigned_by_user_id=EXCLUDED.assigned_by_user_id,note=EXCLUDED.note
 RETURNING id INTO assignment;
 IF assignment IS NULL THEN SELECT id INTO assignment FROM public.contact_center_message_assignments WHERE source_message_id=m.id AND resolved_at IS NULL; END IF;
 INSERT INTO public.ai_handoffs(bot_id,telegram_user_id,user_id,assigned_to,last_message_id,status,reason,meta)
 VALUES(p.bot_id,m.telegram_user_id,c.user_id,p.assignee_user_id,m.message_id,'open',p_reason,jsonb_build_object('sales_conversation_id',c.id,'assignment_id',assignment));
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details)
 VALUES(c.id,CASE WHEN p_stop THEN 'opt_out' ELSE 'handoff' END,m.id,jsonb_build_object('assignment_id',assignment,'reason',p_reason));
 RETURN assignment;
END $$;

-- Latest baseline: 20260912083730_cb21_checkout_capabilities.sql
CREATE OR REPLACE FUNCTION public.sales_consume_checkout_capability(p_hash text,p_endpoint text,p_body jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE op public.sales_checkout_operations; j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 SELECT * INTO op FROM public.sales_checkout_operations WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR op.status<>'prepared' OR op.expires_at<=clock_timestamp() OR op.endpoint<>p_endpoint OR op.request_body<>p_body THEN RETURN NULL; END IF;
 SELECT * INTO j FROM public.sales_jobs WHERE id=op.job_id;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF op.conversation_id IS DISTINCT FROM c.id OR NOT public.sales_conversation_enabled(p.id,c.id) OR p.policy_version<>'cb21-v2' OR c.human_hold OR c.state<>'READY'
   OR c.revision<>j.revision OR c.last_inbound_seq<>j.inbound_seq OR c.answered_seq>=j.inbound_seq OR j.status<>'claimed'
   OR p.knowledge->>'checkout_enabled' IS DISTINCT FROM 'true'
   OR NOT public.has_admin_section_access(p.assignee_user_id,'payments','edit')
   OR coalesce(p_body->>'user_id',p_body->>'target_user_id') IS DISTINCT FROM c.user_id::text
   OR p_body->>'responsible_user_id' IS DISTINCT FROM p.assignee_user_id::text
   OR NOT public.sales_delivery_gate(j.id) THEN RETURN NULL; END IF;
 UPDATE public.sales_checkout_operations SET status='consumed' WHERE id=op.id;
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details)
 VALUES(c.id,'checkout_authorized',j.inbound_id,jsonb_build_object('operation_id',op.id,'endpoint',p_endpoint));
 RETURN p.assignee_user_id;
END $$;

-- Latest baseline: 20260912083730_cb21_checkout_capabilities.sql
CREATE OR REPLACE FUNCTION public.sales_authorize_invoice_document(p_hash text,p_body jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE op public.sales_checkout_operations; o public.orders_v2; p public.sales_campaigns; c public.sales_conversations; j public.sales_jobs;
BEGIN
 SELECT * INTO op FROM public.sales_checkout_operations WHERE token_hash=p_hash FOR UPDATE;
 IF NOT FOUND OR op.endpoint<>'admin-invoice-checkout-issue' OR op.status<>'consumed' OR op.expires_at<=clock_timestamp() OR op.document_started_at IS NOT NULL
  OR p_body<>jsonb_build_object('order_id',p_body->>'order_id','mode','generate','pre_payment_invoice',true) THEN RETURN NULL; END IF;
 SELECT * INTO o FROM public.orders_v2 WHERE id=(p_body->>'order_id')::uuid;
 SELECT * INTO c FROM public.sales_conversations WHERE id=op.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=op.job_id;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF NOT public.sales_conversation_enabled(p.id,c.id) OR c.human_hold OR c.revision<>j.revision OR c.last_inbound_seq<>j.inbound_seq OR j.status<>'claimed' OR NOT public.sales_delivery_gate(j.id) THEN RETURN NULL; END IF;
 IF o.meta->>'sales_checkout_operation_id' IS DISTINCT FROM op.id::text OR o.user_id IS DISTINCT FROM c.user_id
   OR o.product_id IS DISTINCT FROM p.product_id OR o.offer_id::text IS DISTINCT FROM op.request_body->>'offer_id'
   OR o.meta->>'checkout_kind' IS DISTINCT FROM 'invoice' OR o.meta->>'awaits_payment' IS DISTINCT FROM 'true'
   OR NOT public.has_admin_section_access(p.assignee_user_id,'payments','edit') THEN RETURN NULL; END IF;
 UPDATE public.sales_checkout_operations SET document_started_at=clock_timestamp() WHERE id=op.id;
 RETURN p.assignee_user_id;
END $$;

-- Latest baseline: 20260912105739_sales_context_ai.sql
CREATE OR REPLACE FUNCTION public.sales_defer_context(p_job uuid,p_token uuid,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 IF p_reason NOT IN ('media_upload_pending','media_processing_pending','media_source_changed') THEN RAISE EXCEPTION 'invalid_context_reason'; END IF;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision OR c.human_hold OR NOT public.sales_conversation_enabled(p.id,c.id) THEN RETURN false; END IF;
 IF j.context_attempts>=120 OR (p_reason='media_upload_pending' AND j.created_at<now()-interval '10 minutes') THEN
  PERFORM public.sales_handoff(j.id,j.claim_token,'media_needs_human'); RETURN false;
 END IF;
 UPDATE public.sales_jobs SET status='queued',claim_token=NULL,claimed_at=NULL,due_at=clock_timestamp()+interval '30 seconds',context_attempts=context_attempts+1,reason=p_reason WHERE id=j.id;
 RETURN true;
END $$;

-- Latest baseline: 20260912105739_sales_context_ai.sql
CREATE OR REPLACE FUNCTION public.sales_capture_media_edit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_conversations;
BEGIN
 IF (OLD.meta->>'file_id') IS NOT DISTINCT FROM (NEW.meta->>'file_id')
  AND (OLD.meta->>'file_type') IS NOT DISTINCT FROM (NEW.meta->>'file_type') THEN RETURN NEW; END IF;
 FOR c IN SELECT sc.* FROM public.sales_conversations sc JOIN public.sales_campaigns p ON p.id=sc.campaign_id
  WHERE sc.user_id=NEW.user_id AND p.bot_id=NEW.bot_id AND p.business_account_id=NEW.business_account_id AND sc.started
  FOR UPDATE OF sc LOOP
  UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,
   revision=revision+1,reason='media_edited',updated_at=now() WHERE id=c.id;
  UPDATE public.sales_jobs SET status='cancelled',reason='media_edited' WHERE conversation_id=c.id AND status IN ('queued','claimed');
  INSERT INTO public.sales_events(conversation_id,event,source_message_id) VALUES(c.id,'media_edited',NEW.id);
 END LOOP;
 RETURN NEW;
END $$;

-- Latest baseline: 20260912105739_sales_context_ai.sql
CREATE OR REPLACE FUNCTION public.sales_configure_ai(p_campaign uuid,p_actor uuid,p_config jsonb,p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; k text;
BEGIN
 IF NOT public.has_role_v2(p_actor,'super_admin') OR NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 PERFORM id FROM public.sales_conversations WHERE campaign_id=p.id ORDER BY id FOR UPDATE;
 IF p.id IS NULL OR p.ai_config IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'configuration_changed'; END IF;
 IF p.mode<>'off' OR EXISTS(SELECT 1 FROM public.sales_conversations WHERE campaign_id=p.id AND NOT human_hold) OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
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
 UPDATE public.sales_conversations SET revision=revision+1 WHERE campaign_id=p.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='ai_configuration_changed' WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('claimed','queued');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details) SELECT id,'ai_configured',p_actor,jsonb_build_object('before',p.ai_config,'after',p_config) FROM public.sales_conversations WHERE campaign_id=p.id;
 RETURN true;
END $$;

-- Latest baseline: 20260912120110_f6c14f61-ac04-47e6-a063-1a85620d53de.sql
CREATE OR REPLACE FUNCTION public.sales_configure_knowledge_products(p_campaign uuid,p_actor uuid,p_ids jsonb,p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; item text;
BEGIN
 IF NOT public.has_role_v2(p_actor,'super_admin') OR NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 PERFORM id FROM public.sales_conversations WHERE campaign_id=p.id ORDER BY id FOR UPDATE;
 IF p.id IS NULL OR coalesce(p.knowledge->'consultation_product_ids','[]') IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'knowledge_configuration_changed'; END IF;
 IF p.mode<>'off' OR EXISTS(SELECT 1 FROM public.sales_conversations WHERE campaign_id=p.id AND NOT human_hold) OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
 IF jsonb_typeof(p_ids) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_consultation_products'; END IF;
 IF jsonb_array_length(p_ids)>20 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(p_ids))<>jsonb_array_length(p_ids) THEN RAISE EXCEPTION 'invalid_consultation_products'; END IF;
 FOR item IN SELECT jsonb_array_elements_text(p_ids) LOOP
  IF item IS NULL OR item !~* '^[0-9a-f-]{36}$' OR NOT EXISTS(SELECT 1 FROM public.products_v2 WHERE id=item::uuid AND is_active AND status='active') THEN RAISE EXCEPTION 'consultation_product_unavailable'; END IF;
 END LOOP;
 UPDATE public.sales_campaigns SET knowledge=jsonb_set(knowledge,'{consultation_product_ids}',p_ids) WHERE id=p.id;
 UPDATE public.sales_conversations SET revision=revision+1 WHERE campaign_id=p.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='knowledge_configuration_changed' WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('queued','claimed');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details) SELECT id,'knowledge_products_configured',p_actor,jsonb_build_object('before',p_expected,'after',p_ids) FROM public.sales_conversations WHERE campaign_id=p.id;
 RETURN true;
END $$;

-- Latest baseline: 20260912164349_b779cb99-19cf-4ef6-be5a-2753988c1791.sql
CREATE OR REPLACE FUNCTION public.sales_replace_knowledge_facts(p_campaign uuid,p_actor uuid,p_facts jsonb,
 p_expected_knowledge_version text,p_expected_facts_sha text,p_apply boolean DEFAULT false,p_approved_facts_sha text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; checked jsonb; before_facts jsonb;
 old_sha text; next_sha text; next_version text; parent uuid; added integer; changed integer; removed integer; result jsonb;
BEGIN
 IF NOT coalesce(public.has_role_v2(p_actor,'super_admin'),false)
  OR NOT coalesce(public.has_admin_section_access(p_actor,'communication','manage'),false) THEN RAISE EXCEPTION 'owner_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 PERFORM id FROM public.sales_conversations WHERE campaign_id=p.id ORDER BY id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'campaign_missing'; END IF;
 IF p.mode<>'off' OR EXISTS(SELECT 1 FROM public.sales_conversations WHERE campaign_id=p.id
   AND (NOT human_hold OR (p.test_user_id IS NOT NULL AND state<>'HUMAN_HOLD'))) THEN RAISE EXCEPTION 'disable_and_pause_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'delivery_unresolved'; END IF;
 before_facts:=coalesce(p.knowledge->'facts','[]');
 old_sha:=encode(sha256(convert_to(before_facts::text,'UTF8')),'hex');
 IF p_expected_knowledge_version IS DISTINCT FROM p.knowledge_version OR p_expected_facts_sha IS DISTINCT FROM old_sha THEN RAISE EXCEPTION 'knowledge_changed'; END IF;
 checked:=public.sales_check_knowledge_facts(p.id,p_facts);
 IF NOT (checked->>'valid')::boolean THEN RETURN checked-'facts'; END IF;
 next_sha:=checked->>'facts_sha256';
 SELECT count(*) INTO added FROM jsonb_array_elements(checked->'facts') n
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(before_facts) o WHERE o->>'id'=n->>'id');
 SELECT count(*) INTO removed FROM jsonb_array_elements(before_facts) o
   WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(checked->'facts') n WHERE n->>'id'=o->>'id');
 SELECT count(*) INTO changed FROM jsonb_array_elements(checked->'facts') n
   JOIN jsonb_array_elements(before_facts) o ON o->>'id'=n->>'id' WHERE o IS DISTINCT FROM n;
 result:=(checked-'facts')||jsonb_build_object('added',added,'changed',changed,'removed',removed,
   'unchanged',jsonb_array_length(checked->'facts')-added-changed,'applied',false,'knowledge_version',p.knowledge_version);
 IF p_apply IS DISTINCT FROM true THEN RETURN result; END IF;
 IF p_approved_facts_sha IS DISTINCT FROM next_sha THEN RAISE EXCEPTION 'exact_editorial_approval_required'; END IF;
 IF checked->'facts'=before_facts THEN RETURN result||jsonb_build_object('noop',true); END IF;
 INSERT INTO public.sales_knowledge_versions(campaign_id,knowledge_version,facts_sha256,facts,facts_count,recorded_by,approval_scope)
  VALUES(p.id,p.knowledge_version,old_sha,before_facts,jsonb_array_length(before_facts),p_actor,'legacy_snapshot')
  ON CONFLICT(campaign_id,knowledge_version) DO NOTHING;
 SELECT id INTO parent FROM public.sales_knowledge_versions WHERE campaign_id=p.id AND knowledge_version=p.knowledge_version;
 next_version:='sales-kb:'||gen_random_uuid()::text;
 INSERT INTO public.sales_knowledge_versions(campaign_id,knowledge_version,facts_sha256,facts,facts_count,parent_id,recorded_by,approval_scope)
  VALUES(p.id,next_version,next_sha,checked->'facts',(checked->>'count')::integer,parent,p_actor,'sales_summaries');
 UPDATE public.sales_campaigns SET knowledge_version=next_version,
  knowledge=knowledge||jsonb_build_object('facts',checked->'facts','facts_sha256',next_sha,'editorial_schema',1,'client_release_approved',false)
  WHERE id=p.id;
 UPDATE public.sales_conversations SET revision=revision+1,updated_at=now() WHERE campaign_id=p.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='knowledge_facts_replaced' WHERE conversation_id IN (SELECT id FROM public.sales_conversations WHERE campaign_id=p.id) AND status IN ('queued','claimed');
 INSERT INTO public.sales_events(conversation_id,event,actor_id,details)
  SELECT id,'knowledge_facts_replaced',p_actor,jsonb_build_object('previous_version',p.knowledge_version,
   'next_version',next_version,'before_sha256',old_sha,'after_sha256',next_sha,'before_count',jsonb_array_length(before_facts),'after_count',checked->'count') FROM public.sales_conversations WHERE campaign_id=p.id;
 RETURN result||jsonb_build_object('applied',true,'knowledge_version',next_version);
END $$;

-- Scheduler cadence and dedicated secret remain unchanged.
CREATE OR REPLACE FUNCTION public.invoke_sales_runtime_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text; request_id bigint;
BEGIN
 -- No HTTP/model calls while the pilot is disabled or nobody is waiting.
 IF NOT EXISTS(SELECT 1 FROM public.sales_campaigns WHERE mode IN ('owner_test','questionnaire_customer')) THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales_jobs WHERE (status='queued' AND due_at<=now()) OR
   (status IN ('claimed','sending') AND claimed_at<now()-interval '3 minutes'))
   AND NOT EXISTS(SELECT 1 FROM public.sales_events e WHERE e.event IN ('handoff','opt_out')
    AND EXISTS(SELECT 1 FROM public.contact_center_message_assignments a WHERE a.id::text=e.details->>'assignment_id' AND a.resolved_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.notification_outbox o WHERE o.idempotency_key='sales_assignment:'||(e.details->>'assignment_id')))
 THEN RETURN NULL; END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='sales_runtime_cron_secret' LIMIT 1;
 IF secret IS NULL THEN RAISE EXCEPTION 'sales_scheduler_secret_missing'; END IF;
 SELECT net.http_post(url:='https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/sales-runtime-worker',
 headers:=jsonb_build_object('Content-Type','application/json','x-sales-runtime-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=55000) INTO request_id;
 RETURN request_id;
END $$;

-- Replaced functions keep their service-only boundary explicitly.
REVOKE ALL ON FUNCTION public.sales_capture_message(),public.sales_control(uuid,text,uuid,integer,integer),
 public.sales_queue_reply(uuid),public.sales_queue_reminder(uuid),public.sales_delivery_gate(uuid),public.sales_claim_job(),
 public.sales_begin_send(uuid,uuid,jsonb),public.sales_finish_send(uuid,uuid,bigint,text),public.sales_handoff(uuid,uuid,text,boolean),
 public.sales_consume_checkout_capability(text,text,jsonb),public.sales_authorize_invoice_document(text,jsonb),
 public.sales_defer_context(uuid,uuid,text),public.sales_capture_media_edit(),public.sales_configure_ai(uuid,uuid,jsonb,jsonb),
 public.sales_configure_knowledge_products(uuid,uuid,jsonb,jsonb),public.sales_replace_knowledge_facts(uuid,uuid,jsonb,text,text,boolean,text),
 public.invoke_sales_runtime_worker() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_capture_message(),public.sales_control(uuid,text,uuid,integer,integer),
 public.sales_queue_reply(uuid),public.sales_queue_reminder(uuid),public.sales_delivery_gate(uuid),public.sales_claim_job(),
 public.sales_begin_send(uuid,uuid,jsonb),public.sales_finish_send(uuid,uuid,bigint,text),public.sales_handoff(uuid,uuid,text,boolean),
 public.sales_consume_checkout_capability(text,text,jsonb),public.sales_authorize_invoice_document(text,jsonb),
 public.sales_defer_context(uuid,uuid,text),public.sales_capture_media_edit(),public.sales_configure_ai(uuid,uuid,jsonb,jsonb),
 public.sales_configure_knowledge_products(uuid,uuid,jsonb,jsonb),public.sales_replace_knowledge_facts(uuid,uuid,jsonb,text,text,boolean,text),
 public.invoke_sales_runtime_worker() TO service_role;
