-- The first answer keeps the owner-configured opening delay. Once this
-- conversation has a delivered sales reply, subsequent customer turns use a
-- separate, short, owner-configured delay. Existing queued jobs are untouched.
ALTER TABLE public.sales_campaigns
  ADD COLUMN followup_min_seconds integer NOT NULL DEFAULT 10
    CHECK (followup_min_seconds BETWEEN 1 AND 60),
  ADD COLUMN followup_max_seconds integer NOT NULL DEFAULT 15
    CHECK (followup_max_seconds BETWEEN followup_min_seconds AND 120);

CREATE FUNCTION public.sales_configure_followup_delay(
  p_campaign uuid, p_actor uuid, p_min integer, p_max integer
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NOT public.has_admin_section_access(p_actor,'communication','manage')
    OR NOT public.has_role_v2(p_actor,'super_admin') THEN
    RAISE EXCEPTION 'owner_required';
  END IF;
  IF p_min IS NULL OR p_max IS NULL OR p_min NOT BETWEEN 1 AND 60
    OR p_max < p_min OR p_max > 120 THEN RAISE EXCEPTION 'invalid_followup_delay'; END IF;
  UPDATE public.sales_campaigns
  SET followup_min_seconds=p_min,followup_max_seconds=p_max
  WHERE id=p_campaign AND code='cb21-owner-test';
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
  IF p.mode<>'owner_test' OR NOT c.started OR c.human_hold OR c.state NOT IN ('READY','WAIT_CUSTOMER')
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

-- Broadcasts do not turn an active conversation back into a slow opener.
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
