-- Delivery rules are opt-in via cb21-v2. Existing campaigns remain OFF.
ALTER TABLE public.sales_jobs ADD COLUMN kind text NOT NULL DEFAULT 'reply' CHECK(kind IN ('reply','reminder'));
ALTER TABLE public.sales_jobs DROP CONSTRAINT sales_jobs_conversation_id_inbound_id_revision_key;
ALTER TABLE public.sales_jobs ADD UNIQUE(conversation_id,inbound_id,revision,kind);
CREATE UNIQUE INDEX sales_one_reminder_per_inbound ON public.sales_jobs(conversation_id,inbound_id) WHERE kind='reminder';

-- Counts only; no event titles, attendees, URLs or transcript contents.
CREATE FUNCTION public.sales_broadcast_state(p_now timestamptz DEFAULT clock_timestamp()) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e record; s record; duration_seconds numeric; computed_end timestamptz;
BEGIN
 FOR e IN SELECT room_state::text,platform_status::text,status::text,webinar_completed_at FROM public.live_events LOOP
  IF e.room_state IN ('open','live','room_open_waiting') OR e.platform_status='live' OR e.status='live' THEN
   IF e.webinar_completed_at IS NOT NULL OR e.room_state='completed' OR e.platform_status IN ('ended','archived','replay_available') THEN RETURN 'unknown'; END IF;
   RETURN 'active';
  END IF;
 END LOOP;
 FOR s IN SELECT sess.starts_at,sess.ends_at,sess.status::text,ev.autoweb_config
   FROM public.live_event_sessions sess JOIN public.live_events ev ON ev.id=sess.live_event_id
   WHERE ev.event_type::text IN ('autowebinar','recorded_webinar') AND sess.starts_at<=p_now
     AND coalesce(sess.status::text,'') NOT IN ('cancelled','canceled','aborted')
 LOOP
  -- The actual player computes start+video.duration_seconds, not session.ends_at.
  duration_seconds:=NULL;
  IF coalesce(s.autoweb_config->'video'->>'duration_seconds','') ~ '^[0-9]+([.][0-9]+)?$' THEN
   duration_seconds:=(s.autoweb_config->'video'->>'duration_seconds')::numeric;
  END IF;
  IF duration_seconds IS NULL OR duration_seconds<=0 THEN
   IF s.starts_at>p_now-interval '24 hours' OR s.ends_at>p_now THEN RETURN 'unknown'; END IF;
  ELSE
   computed_end:=s.starts_at+make_interval(secs=>duration_seconds::double precision);
   IF p_now<greatest(computed_end,s.ends_at) THEN
    IF s.ends_at IS NOT NULL AND abs(extract(epoch from s.ends_at-computed_end))>60 THEN RETURN 'unknown'; END IF;
    RETURN 'active';
   END IF;
  END IF;
 END LOOP;
 RETURN 'clear';
END $$;

-- Last customer inbound is the sole 24h clock. Seller messages never renew it.
CREATE FUNCTION public.sales_reminder_due(p_inbound timestamptz,p_seller timestamptz,p_now timestamptz DEFAULT clock_timestamp(),p_random double precision DEFAULT random()) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE deadline timestamptz:=p_inbound+interval '23 hours 45 minutes'; earliest timestamptz; target timestamptz;
 d date; a timestamptz; b timestamptz; best timestamptz; fallback timestamptz;
BEGIN
 IF p_random<0 OR p_random>=1 OR p_inbound>p_seller OR p_seller>p_now THEN RETURN NULL; END IF;
 earliest:=greatest(p_now,p_inbound+interval '8 hours',p_seller+interval '2 hours');
 target:=p_inbound+make_interval(secs=>(16+4*p_random)*3600);
 IF earliest>=deadline THEN RETURN NULL; END IF;
 FOR d IN SELECT (p_inbound AT TIME ZONE 'Europe/Minsk')::date UNION ALL SELECT (p_inbound AT TIME ZONE 'Europe/Minsk')::date+1 LOOP
  a:=greatest(earliest,(d+time '08:00') AT TIME ZONE 'Europe/Minsk');
  b:=least(deadline,(d+time '22:59') AT TIME ZONE 'Europe/Minsk');
  IF a<=b THEN
   fallback:=greatest(fallback,b);
   IF b>=target THEN best:=least(best,greatest(a,target)); END IF;
  END IF;
 END LOOP;
 RETURN coalesce(best,fallback);
END $$;

CREATE FUNCTION public.sales_queue_reminder(p_conversation uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.sales_conversations; p public.sales_campaigns; last_reply public.sales_jobs; due timestamptz; result uuid;
BEGIN
 SELECT * INTO c FROM public.sales_conversations WHERE id=p_conversation FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF p.policy_version<>'cb21-v2' OR p.mode<>'owner_test' OR c.human_hold OR c.state<>'WAIT_CUSTOMER' OR NOT c.started
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

-- Atomic gate used at claim AND immediately before dispatch. Held jobs survive worker restarts.
CREATE FUNCTION public.sales_delivery_gate(p_job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns; event_state text;
 t timestamptz:=clock_timestamp(); local_time timestamp; next_time timestamptz; first_reply boolean;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF p.policy_version<>'cb21-v2' THEN RETURN j.kind='reply'; END IF;
 IF j.due_at>t THEN RETURN false; END IF;
 IF c.last_inbound_at<=t-(CASE WHEN j.kind='reminder' THEN interval '23 hours 45 minutes' ELSE interval '23 hours 59 minutes' END) THEN
  UPDATE public.sales_jobs SET status='cancelled',reason='telegram_window_expired' WHERE id=j.id; RETURN false;
 END IF;
 event_state:=public.sales_broadcast_state(t);
 IF event_state<>'clear' THEN
  UPDATE public.sales_jobs SET status='queued',due_at=t+interval '1 minute',claim_token=NULL,claimed_at=NULL,reason='event_'||event_state WHERE id=j.id;
  RETURN false;
 END IF;
 IF j.reason IN ('event_active','event_unknown') THEN
  UPDATE public.sales_jobs SET status='queued',due_at=t+make_interval(secs=>p.delay_min_seconds+floor(random()*(p.delay_max_seconds-p.delay_min_seconds+1))::int),claim_token=NULL,claimed_at=NULL,reason='event_ended_delay' WHERE id=j.id;
  RETURN false;
 END IF;
 SELECT NOT EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status='sent' AND policy_version=p.policy_version AND kind='reply') INTO first_reply;
 local_time:=t AT TIME ZONE 'Europe/Minsk';
 IF (first_reply OR j.kind='reminder') AND (local_time::time<time '08:00' OR local_time::time>=time '23:00') THEN
  next_time:=((local_time::date+CASE WHEN local_time::time>=time '23:00' THEN 1 ELSE 0 END)+time '08:00') AT TIME ZONE 'Europe/Minsk';
  UPDATE public.sales_jobs SET status='queued',due_at=next_time+make_interval(secs=>p.delay_min_seconds+floor(random()*(p.delay_max_seconds-p.delay_min_seconds+1))::int),claim_token=NULL,claimed_at=NULL,reason='outside_business_hours' WHERE id=j.id;
  RETURN false;
 END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.sales_queue_reply(p_conversation uuid) RETURNS uuid
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
 ON CONFLICT(conversation_id,inbound_id,revision,kind) DO NOTHING RETURNING id INTO j;
 RETURN j;
END $$;

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
 IF p.mode<>'owner_test' OR c.human_hold OR ((j.kind='reply' AND c.state<>'READY') OR (j.kind='reminder' AND c.state<>'WAIT_CUSTOMER')) OR c.revision<>j.revision
   OR p.policy_version<>j.policy_version OR p.knowledge_version<>j.knowledge_version
   OR c.last_inbound_seq<>j.inbound_seq OR ((j.kind='reply' AND c.answered_seq>=j.inbound_seq) OR (j.kind='reminder' AND c.answered_seq<>j.inbound_seq)) OR c.last_inbound_at<=now()-interval '24 hours'
   OR EXISTS(SELECT 1 FROM public.sales_jobs WHERE conversation_id=c.id AND status IN ('sending','unknown')) THEN
   UPDATE public.sales_jobs SET status='cancelled',reason='scope_or_history_changed' WHERE id=j.id; RETURN NULL;
 END IF;
 IF NOT public.sales_delivery_gate(j.id) THEN RETURN NULL; END IF;
 UPDATE public.sales_jobs SET status='claimed',claim_token=gen_random_uuid(),claimed_at=now() WHERE id=j.id RETURNING * INTO j;
 RETURN to_jsonb(j);
END $$;

CREATE OR REPLACE FUNCTION public.sales_begin_send(p_job uuid,p_token uuid,p_candidate jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.sales_jobs; c public.sales_conversations; p public.sales_campaigns;
BEGIN
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job;
 SELECT * INTO c FROM public.sales_conversations WHERE id=j.conversation_id FOR UPDATE;
 SELECT * INTO j FROM public.sales_jobs WHERE id=p_job FOR UPDATE;
 SELECT * INTO p FROM public.sales_campaigns WHERE id=c.campaign_id;
 IF j.status<>'claimed' OR j.claim_token IS DISTINCT FROM p_token OR c.revision<>j.revision OR c.human_hold OR ((j.kind='reply' AND c.state<>'READY') OR (j.kind='reminder' AND c.state<>'WAIT_CUSTOMER'))
   OR p.mode<>'owner_test' OR p.policy_version<>j.policy_version OR p.knowledge_version<>j.knowledge_version
   OR c.last_inbound_seq<>j.inbound_seq OR ((j.kind='reply' AND c.answered_seq>=j.inbound_seq) OR (j.kind='reminder' AND c.answered_seq<>j.inbound_seq)) OR c.last_inbound_at<=now()-interval '24 hours'
   OR NOT EXISTS(SELECT 1 FROM public.telegram_business_connections WHERE id=p.business_account_id AND bot_id=p.bot_id AND can_reply AND is_enabled)
   THEN RETURN false; END IF;
 IF NOT public.sales_delivery_gate(j.id) THEN RETURN false; END IF;
 INSERT INTO public.notification_outbox(user_id,message_type,idempotency_key,source,status,meta)
 VALUES(p.test_user_id,'sales_reply',CASE WHEN j.kind='reminder' THEN 'sales_reminder:' ELSE 'sales_reply:' END||c.id||':'||j.inbound_id,'sales_runtime','sending',jsonb_build_object('job_id',j.id)) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.sales_jobs SET status='sending',candidate=p_candidate,claimed_at=clock_timestamp() WHERE id=j.id;
 INSERT INTO public.sales_events(conversation_id,event,source_message_id,details) VALUES(c.id,'dispatch_committed',j.inbound_id,jsonb_build_object('job_id',j.id));
 RETURN true;
END $$;

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
   IF j.kind='reply' THEN PERFORM public.sales_queue_reminder(c.id); END IF;
 END IF;
 UPDATE public.notification_outbox SET status=CASE WHEN p_message_id IS NULL THEN 'unknown' ELSE 'sent' END,
  sent_at=CASE WHEN p_message_id IS NOT NULL THEN now() END,blocked_reason=p_error,
  meta=meta||jsonb_build_object('telegram_message_id',p_message_id)
 WHERE idempotency_key=CASE WHEN j.kind='reminder' THEN 'sales_reminder:' ELSE 'sales_reply:' END||c.id||':'||j.inbound_id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.sales_broadcast_state(timestamptz), public.sales_reminder_due(timestamptz,timestamptz,timestamptz,double precision), public.sales_queue_reminder(uuid), public.sales_delivery_gate(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sales_broadcast_state(timestamptz), public.sales_reminder_due(timestamptz,timestamptz,timestamptz,double precision), public.sales_queue_reminder(uuid), public.sales_delivery_gate(uuid) TO service_role;