-- OTP records context only after consuming a valid code. No form answers or
-- external notifications are stored/sent by the confirmation function.
CREATE TABLE public.site_questionnaire_confirmations (
  page_id uuid NOT NULL REFERENCES public.site_pages(id),
  block_id uuid NOT NULL,
  user_id uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(page_id,block_id,user_id)
);
ALTER TABLE public.site_questionnaire_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_questionnaire_confirmations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.site_questionnaire_confirmations TO service_role;
ALTER TABLE public.broadcast_automation_deliveries ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.record_site_questionnaire_confirmation(p_page_id uuid,p_block_id uuid,p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_block jsonb; v_confirmation public.site_questionnaire_confirmations%ROWTYPE; v_count integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM profiles p JOIN auth.users u ON u.id=p.user_id
    WHERE p.user_id=p_user_id AND p.status='active' AND NOT coalesce(p.is_archived,false) AND p.merged_to_profile_id IS NULL
      AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
    RAISE EXCEPTION 'questionnaire_identity_invalid' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('site_questionnaire:'||p_user_id::text,0));
  SELECT count(*) INTO v_count FROM site_pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) b
    WHERE p.id=p_page_id AND p.status='published' AND b->>'id'=p_block_id::text AND b->>'type'='form';
  IF v_count<>1 THEN RAISE EXCEPTION 'questionnaire_form_ambiguous' USING ERRCODE='22023'; END IF;
  SELECT b INTO v_block FROM site_pages p CROSS JOIN LATERAL jsonb_array_elements(p.blocks) b
    WHERE p.id=p_page_id AND p.status='published' AND b->>'id'=p_block_id::text AND b->>'type'='form';
  IF v_block IS NULL OR v_block->'content'->'questionnaire_first' IS DISTINCT FROM 'true'::jsonb
    OR v_block->'content'->'auth_mode' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'questionnaire_form_unavailable' USING ERRCODE='22023';
  END IF;
  INSERT INTO site_questionnaire_confirmations(page_id,block_id,user_id) VALUES(p_page_id,p_block_id,p_user_id)
    ON CONFLICT DO NOTHING;
  SELECT * INTO v_confirmation FROM site_questionnaire_confirmations
    WHERE page_id=p_page_id AND block_id=p_block_id AND user_id=p_user_id;
  IF EXISTS(SELECT 1 FROM site_form_submissions s WHERE s.page_id=p_page_id AND s.status='processed'
    AND s.metadata->>'questionnaire_first'='true' AND s.metadata->>'block_id'=p_block_id::text AND s.metadata->>'user_id'=p_user_id::text) THEN RETURN; END IF;
  INSERT INTO broadcast_automation_deliveries(template_id,user_id,event_key,channel,available_at)
  SELECT bt.id,p_user_id,'site_form:'||p_page_id::text||':'||p_block_id::text||':email_confirmed_incomplete:email','email',
    v_confirmation.confirmed_at + make_interval(mins => (bt.metadata->'site_form_condition'->>'delay_minutes')::int)
  FROM broadcast_templates bt
  WHERE bt.trigger_kind='site_form_event' AND bt.status='recurring' AND bt.approval_status='approved'
    AND bt.metadata->'site_form_condition'->>'event'='email_confirmed_incomplete'
    AND bt.metadata->'site_form_condition'->>'page_id'=p_page_id::text
    AND bt.metadata->'site_form_condition'->>'block_id'=p_block_id::text
    AND bt.metadata->'site_form_condition'->>'delay_minutes' ~ '^[0-9]{1,5}$'
    AND CASE WHEN bt.metadata->'site_form_condition'->>'delay_minutes' ~ '^[0-9]{1,5}$'
      THEN (bt.metadata->'site_form_condition'->>'delay_minutes')::int BETWEEN 15 AND 10080 ELSE false END
    AND (CASE WHEN coalesce(array_length(bt.channels,1),0)>0 THEN bt.channels ELSE ARRAY[bt.channel] END)=ARRAY['email']::text[]
  ON CONFLICT(template_id,user_id,event_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.record_site_questionnaire_confirmation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_site_questionnaire_confirmation(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_completed_questionnaire_reminders()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status='processed' AND NEW.metadata->>'questionnaire_first'='true' THEN
    UPDATE broadcast_automation_deliveries SET status='failed',error='questionnaire_completed'
    WHERE user_id::text=NEW.metadata->>'user_id' AND status='pending'
      AND event_key='site_form:'||NEW.page_id::text||':'||(NEW.metadata->>'block_id')||':email_confirmed_incomplete:email';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_completed_questionnaire_reminders() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cancel_completed_questionnaire_reminders AFTER INSERT ON public.site_form_submissions
FOR EACH ROW EXECUTE FUNCTION public.cancel_completed_questionnaire_reminders();

CREATE OR REPLACE FUNCTION public.site_questionnaire_delivery_allowed(p_delivery_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_delivery public.broadcast_automation_deliveries%ROWTYPE; v_condition jsonb; v_complete boolean; v_channels text[]; v_delay integer;
BEGIN
  SELECT d.* INTO v_delivery FROM broadcast_automation_deliveries d WHERE d.id=p_delivery_id;
  SELECT metadata->'site_form_condition',CASE WHEN coalesce(array_length(channels,1),0)>0 THEN channels ELSE ARRAY[channel] END
    INTO v_condition,v_channels FROM broadcast_templates
    WHERE id=v_delivery.template_id AND trigger_kind='site_form_event' AND status='recurring' AND approval_status='approved';
  IF v_condition IS NULL OR NOT coalesce(v_delivery.channel=ANY(v_channels),false) THEN RETURN false; END IF;
  SELECT EXISTS(SELECT 1 FROM site_form_submissions s JOIN profiles p ON p.id=s.profile_id
    WHERE s.page_id::text=v_condition->>'page_id' AND p.user_id=v_delivery.user_id AND s.status='processed'
      AND s.metadata->>'questionnaire_first'='true' AND s.metadata->>'user_id'=v_delivery.user_id::text
      AND s.metadata->>'block_id'=v_condition->>'block_id') INTO v_complete;
  IF v_condition->>'event'='submitted' THEN
    RETURN v_complete AND v_delivery.event_key='site_form:'||(v_condition->>'page_id')||':'||(v_condition->>'block_id')||':submitted:'||v_delivery.channel;
  END IF;
  IF NOT coalesce(v_condition->>'delay_minutes' ~ '^[0-9]{1,5}$',false) THEN RETURN false; END IF;
  v_delay := (v_condition->>'delay_minutes')::int;
  RETURN v_condition->>'event'='email_confirmed_incomplete' AND v_channels=ARRAY['email']::text[] AND v_delay BETWEEN 15 AND 10080
    AND v_delivery.channel='email' AND NOT v_complete
    AND v_delivery.available_at<=now()
    AND v_delivery.event_key='site_form:'||(v_condition->>'page_id')||':'||(v_condition->>'block_id')||':email_confirmed_incomplete:email'
    AND EXISTS(SELECT 1 FROM site_questionnaire_confirmations c WHERE c.page_id::text=v_condition->>'page_id'
      AND c.block_id::text=v_condition->>'block_id' AND c.user_id=v_delivery.user_id
      AND c.confirmed_at+make_interval(mins=>v_delay)<=now());
END;
$$;
REVOKE ALL ON FUNCTION public.site_questionnaire_delivery_allowed(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_questionnaire_delivery_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_broadcast_automation_deliveries(_limit integer DEFAULT 50)
RETURNS SETOF public.broadcast_automation_deliveries LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
  RETURN QUERY WITH claimed AS (
    SELECT id FROM broadcast_automation_deliveries WHERE status='pending' AND available_at<=now()
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(_limit,1),100)
  ) UPDATE broadcast_automation_deliveries d SET status='processing',attempted_at=now(),error=NULL
    FROM claimed WHERE d.id=claimed.id RETURNING d.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_broadcast_automation_deliveries(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_broadcast_automation_deliveries(integer) TO service_role;
