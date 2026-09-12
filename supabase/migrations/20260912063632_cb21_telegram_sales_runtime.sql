-- Single-dialog pilot. No customer campaign can be enabled by this migration.
CREATE TABLE public.sales_campaigns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
 bot_id uuid NOT NULL REFERENCES public.telegram_bots(id),
 business_account_id uuid NOT NULL REFERENCES public.telegram_business_connections(id),
 test_user_id uuid NOT NULL REFERENCES auth.users(id), assignee_user_id uuid NOT NULL REFERENCES auth.users(id),
 product_id uuid NOT NULL REFERENCES public.products_v2(id),
 mode text NOT NULL DEFAULT 'off' CHECK(mode IN ('off','owner_test')),
 trigger_phrase text NOT NULL, policy_version text NOT NULL, knowledge_version text NOT NULL,
 knowledge jsonb NOT NULL DEFAULT '{}'::jsonb,
 delay_min_seconds integer NOT NULL DEFAULT 60 CHECK(delay_min_seconds BETWEEN 30 AND 600),
 delay_max_seconds integer NOT NULL DEFAULT 180 CHECK(delay_max_seconds BETWEEN delay_min_seconds AND 900),
 enabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bot_id,business_account_id,test_user_id)
);
CREATE TABLE public.sales_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL UNIQUE REFERENCES public.sales_campaigns(id),
 state text NOT NULL DEFAULT 'OFF' CHECK(state IN ('OFF','READY','WAIT_CUSTOMER','HUMAN_HOLD','STOPPED','DELIVERY_UNKNOWN')),
 started boolean NOT NULL DEFAULT false, stage text NOT NULL DEFAULT 'qualification',
 revision bigint NOT NULL DEFAULT 0, last_inbound_id uuid REFERENCES public.telegram_messages(id),
 last_inbound_seq bigint NOT NULL DEFAULT 0, answered_seq bigint NOT NULL DEFAULT 0,
 last_inbound_at timestamptz, human_hold boolean NOT NULL DEFAULT false,
 reason text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.sales_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.sales_conversations(id),
 inbound_id uuid NOT NULL REFERENCES public.telegram_messages(id), inbound_seq bigint NOT NULL,
 revision bigint NOT NULL, due_at timestamptz NOT NULL,
 policy_version text NOT NULL, knowledge_version text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','claimed','sending','sent','cancelled','held','unknown')),
 claim_token uuid, claimed_at timestamptz, delivery_message_id bigint,
 candidate jsonb, reason text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,inbound_id,revision)
);
CREATE INDEX sales_jobs_due ON public.sales_jobs(due_at) WHERE status='queued';
CREATE INDEX sales_jobs_conversation ON public.sales_jobs(conversation_id,status);
CREATE TABLE public.sales_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES public.sales_conversations(id),
 event text NOT NULL, actor_id uuid, source_message_id uuid REFERENCES public.telegram_messages(id),
 details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_events_conversation ON public.sales_events(conversation_id,created_at);

-- Browser access is through the authenticated controller. No raw context/config in client queries.
ALTER TABLE public.sales_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_campaigns, public.sales_conversations, public.sales_jobs, public.sales_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.sales_campaigns, public.sales_conversations, public.sales_jobs, public.sales_events TO service_role;

CREATE FUNCTION public.sales_queue_reply(p_conversation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_conversations; p public.sales_campaigns; j uuid;
BEGIN
 SELECT * INTO c FROM public.sales_conversations WHERE id=p_conversation FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF p.mode<>'owner_test' OR NOT c.started OR c.human_hold OR c.state NOT IN ('READY','WAIT_CUSTOMER')
   OR c.last_inbound_seq<=c.answered_seq OR c.last_inbound_at<=now()-interval '24 hours'
   OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RETURN NULL; END IF;
 INSERT INTO public.sales_jobs(conversation_id,inbound_id,inbound_seq,revision,due_at,policy_version,knowledge_version)
 VALUES(c.id,c.last_inbound_id,c.last_inbound_seq,c.revision,
   clock_timestamp()+make_interval(secs=>p.delay_min_seconds+floor(random()*(p.delay_max_seconds-p.delay_min_seconds+1))::int),
   p.policy_version,p.knowledge_version)
 ON CONFLICT(conversation_id,inbound_id,revision) DO NOTHING RETURNING id INTO j;
 RETURN j;
END $$;

-- Internal trigger only: reads campaign scope under definer rights because Telegram
-- messages also have authenticated edit/read-status paths. Not an exposed RPC.
CREATE FUNCTION public.sales_capture_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; own_bot bigint; is_echo boolean; seq bigint;
BEGIN
 IF NEW.transport IS DISTINCT FROM 'business' THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE bot_id=NEW.bot_id AND business_account_id=NEW.business_account_id AND test_user_id=NEW.user_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 INSERT INTO public.sales_conversations(campaign_id) VALUES(p.id) ON CONFLICT(campaign_id) DO NOTHING;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id FOR UPDATE;
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
   OR coalesce((NEW.meta->>'edited')::boolean,false) OR p.mode<>'owner_test'
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
   VALUES(c.id,'activated',NEW.id,'{"mode":"owner_test","preregistration_bypass":"explicit_single_dialog_test"}');
 END IF;
 UPDATE public.sales_conversations SET started=c.started,
   state=CASE WHEN c.started AND c.state IN ('READY','WAIT_CUSTOMER') THEN 'READY' ELSE c.state END,
   revision=revision+1,last_inbound_id=NEW.id,last_inbound_seq=seq,last_inbound_at=NEW.created_at,updated_at=now() WHERE id=c.id;
 UPDATE public.sales_jobs SET status='cancelled',reason='newer_inbound' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 PERFORM public.sales_queue_reply(c.id);
 RETURN NEW;
END $$;
CREATE TRIGGER sales_capture_message AFTER INSERT OR UPDATE OF message_text ON public.telegram_messages
FOR EACH ROW EXECUTE FUNCTION public.sales_capture_message();

CREATE FUNCTION public.sales_control(p_campaign uuid,p_action text,p_actor uuid,p_min integer DEFAULT NULL,p_max integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p public.sales_campaigns; c public.sales_conversations; last_out bigint;
BEGIN
 IF NOT public.has_admin_section_access(p_actor,'communication','manage') THEN RAISE EXCEPTION 'communication_manage_required'; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=p_campaign FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
 INSERT INTO public.sales_conversations(campaign_id) VALUES(p.id) ON CONFLICT DO NOTHING;
 SELECT * INTO c FROM public.sales_conversations WHERE campaign_id=p.id FOR UPDATE;
 IF p_action='delay' THEN
   IF NOT public.has_role_v2(p_actor,'super_admin') THEN RAISE EXCEPTION 'owner_required'; END IF;
   IF p_min IS NULL OR p_max IS NULL THEN RAISE EXCEPTION 'delay_required'; END IF;
   UPDATE public.sales_campaigns SET delay_min_seconds=p_min,delay_max_seconds=p_max WHERE id=p.id;
 ELSIF p_action='enable' THEN
   IF NOT public.has_role_v2(p_actor,'super_admin') THEN RAISE EXCEPTION 'owner_required'; END IF;
   IF p.knowledge->>'release_mode' IS DISTINCT FROM 'owner_test' OR jsonb_array_length(coalesce(p.knowledge->'facts','[]'))=0 THEN RAISE EXCEPTION 'knowledge_not_ready'; END IF;
   IF p.mode='off' THEN UPDATE public.sales_campaigns SET mode='owner_test',enabled_at=clock_timestamp() WHERE id=p.id; END IF;
 ELSIF p_action='pause' THEN
   UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,
    revision=revision+1,reason='operator_pause',updated_at=now() WHERE id=c.id;
   UPDATE public.sales_jobs SET status='cancelled',reason='operator_pause' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 ELSIF p_action='resume' THEN
   IF c.state<>'HUMAN_HOLD' OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN RAISE EXCEPTION 'resume_blocked'; END IF;
   SELECT max(message_id) INTO last_out FROM public.telegram_messages WHERE user_id=p.test_user_id AND bot_id=p.bot_id
     AND business_account_id=p.business_account_id AND direction='outgoing'
     AND NOT EXISTS(SELECT 1 FROM public.sales_jobs sj WHERE sj.conversation_id=c.id AND sj.delivery_message_id=telegram_messages.message_id AND sj.status='sent');
   UPDATE public.sales_conversations SET human_hold=false,revision=revision+1,
     answered_seq=greatest(answered_seq,CASE WHEN coalesce(last_out,0)>=last_inbound_seq THEN last_inbound_seq ELSE answered_seq END),
     state=CASE WHEN NOT started THEN 'OFF' WHEN coalesce(last_out,0)>=last_inbound_seq OR answered_seq>=last_inbound_seq THEN 'WAIT_CUSTOMER' ELSE 'READY' END,
     reason=NULL,updated_at=now() WHERE id=c.id;
   PERFORM public.sales_queue_reply(c.id);
 ELSIF p_action='disable' THEN
   UPDATE public.sales_campaigns SET mode='off' WHERE id=p.id;
   UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN state IN ('STOPPED','DELIVERY_UNKNOWN') THEN state ELSE 'HUMAN_HOLD' END,revision=revision+1,reason='disabled' WHERE id=c.id;
   UPDATE public.sales_jobs SET status='cancelled',reason='disabled' WHERE conversation_id=c.id AND status IN ('queued','claimed');
 ELSE RAISE EXCEPTION 'invalid_action'; END IF;
 INSERT INTO public.sales_events(conversation_id,event,actor_id) VALUES(c.id,p_action,p_actor);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION public.sales_claim_job() RETURNS jsonb
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
 IF p.mode<>'owner_test' OR c.human_hold OR c.state<>'READY' OR c.revision<>j.revision
   OR p.policy_version<>j.policy_version OR p.knowledge_version<>j.knowledge_version
   OR c.last_inbound_seq<>j.inbound_seq OR c.answered_seq>=j.inbound_seq OR c.last_inbound_at<=now()-interval '24 hours'
   OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN
   UPDATE public.sales_jobs SET status='cancelled',reason='scope_or_history_changed' WHERE id=j.id; RETURN NULL;
 END IF;
 UPDATE public.sales_jobs SET status='claimed',claim_token=gen_random_uuid(),claimed_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

CREATE FUNCTION public.sales_begin_send(p_job uuid,p_token uuid,p_candidate jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision OR c.human_hold OR c.state<>'READY'
   OR p.mode<>'owner_test' OR p.policy_version<>j.policy_version OR p.knowledge_version<>j.knowledge_version
   OR c.last_inbound_seq<>j.inbound_seq OR c.answered_seq>=j.inbound_seq OR c.last_inbound_at<=now()-interval '24 hours'
   OR NOT EXISTS(SELECT 1 FROM public.telegram_business_connections WHERE id=p.business_account_id AND bot_id=p.bot_id AND can_reply AND is_enabled)
   THEN RETURN false; END IF;
 INSERT INTO public.notification_outbox(user_id,message_type,idempotency_key,source,status,meta)
 VALUES(p.test_user_id,'sales_reply','sales_reply:'||c.id||':'||j.inbound_id,'sales_runtime','sending',jsonb_build_object('job_id',j.id)) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.sales_jobs SET status='sending',candidate=p_candidate,claimed_at=clock_timestamp() WHERE id=j.id;
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details) VALUES(c.id,'dispatch_committed',j.inbound_id,jsonb_build_object('job_id',j.id));
 RETURN true;
END $$;

CREATE FUNCTION public.sales_finish_send(p_job uuid,p_token uuid,p_message_id bigint,p_error text DEFAULT NULL) RETURNS boolean
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
   SELECT p.test_user_id,m.telegram_user_id,p.bot_id,'outgoing',j.candidate->>'text',p_message_id,'sent',true,'business',b.connection_id,b.id,'bot_automation',
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
 END IF;
 UPDATE public.notification_outbox SET status=CASE WHEN p_message_id IS NULL THEN 'unknown' ELSE 'sent' END,
  sent_at=CASE WHEN p_message_id IS NOT NULL THEN now() END,blocked_reason=p_error,
  meta=meta||jsonb_build_object('telegram_message_id',p_message_id)
 WHERE idempotency_key='sales_reply:'||c.id||':'||j.inbound_id;
 RETURN true;
END $$;

CREATE FUNCTION public.sales_handoff(p_job uuid,p_token uuid,p_reason text,p_stop boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns; m public.telegram_messages; assignment uuid;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision THEN RETURN NULL; END IF;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 SELECT * INTO m FROM public.telegram_messages WHERE id=j.inbound_id AND user_id=p.test_user_id AND bot_id=p.bot_id AND business_account_id=p.business_account_id AND direction='incoming';
 IF NOT FOUND OR NOT public.has_admin_section_access(p.assignee_user_id,'communication','manage') THEN RAISE EXCEPTION 'handoff_scope_invalid'; END IF;
 UPDATE public.sales_conversations SET human_hold=true,state=CASE WHEN p_stop THEN 'STOPPED' ELSE 'HUMAN_HOLD' END,reason=p_reason,revision=revision+1 WHERE id=c.id;
 UPDATE public.sales_jobs SET status='held',reason=p_reason WHERE id=j.id;
 INSERT INTO public.contact_center_message_assignments(source,source_message_id,assignee_user_id,assigned_by_user_id,note)
 VALUES('telegram',m.id,p.assignee_user_id,p.assignee_user_id,'Автопродажи: '||left(p_reason,100))
 ON CONFLICT(source_message_id) WHERE resolved_at IS NULL DO NOTHING RETURNING id INTO assignment;
 IF assignment IS NULL THEN SELECT id INTO assignment FROM public.contact_center_message_assignments WHERE source_message_id=m.id AND resolved_at IS NULL; END IF;
 INSERT INTO public.ai_handoffs(bot_id,telegram_user_id,user_id,assigned_to,last_message_id,status,reason,meta)
 VALUES(p.bot_id,m.telegram_user_id,p.test_user_id,p.assignee_user_id,m.message_id,'open',p_reason,jsonb_build_object('sales_conversation_id',c.id,'assignment_id',assignment));
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details)
 VALUES(c.id,CASE WHEN p_stop THEN 'opt_out' ELSE 'handoff' END,m.id,jsonb_build_object('assignment_id',assignment,'reason',p_reason));
 RETURN assignment;
END $$;

REVOKE ALL ON FUNCTION public.sales_queue_reply(uuid), public.sales_capture_message(), public.sales_control(uuid,text,uuid,integer,integer),
 public.sales_claim_job(), public.sales_begin_send(uuid,uuid,jsonb), public.sales_finish_send(uuid,uuid,bigint,text), public.sales_handoff(uuid,uuid,text,boolean)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_queue_reply(uuid), public.sales_control(uuid,text,uuid,integer,integer),
 public.sales_claim_job(), public.sales_begin_send(uuid,uuid,jsonb), public.sales_finish_send(uuid,uuid,bigint,text), public.sales_handoff(uuid,uuid,text,boolean) TO service_role;
