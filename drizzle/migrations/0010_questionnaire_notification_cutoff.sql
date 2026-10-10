-- Optional activation boundary; malformed boundaries fail closed, existing rules are unchanged.
CREATE OR REPLACE FUNCTION public.site_questionnaire_after_cutoff(p_created_at timestamptz,p_condition jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE v_cutoff timestamptz; v_value text:=p_condition->>'submissions_from';
BEGIN
  IF v_value IS NULL THEN RETURN true; END IF;
  IF v_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN false; END IF;
  BEGIN v_cutoff:=v_value::timestamptz; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  RETURN coalesce(p_created_at>v_cutoff,false);
END;
$$;
REVOKE ALL ON FUNCTION public.site_questionnaire_after_cutoff(timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.site_questionnaire_after_cutoff(timestamptz,jsonb) TO service_role;

-- Queue new entrants immediately or after an explicit delay, without re-sending to previous entrants.
CREATE OR REPLACE FUNCTION public.queue_site_questionnaire_broadcasts(_submission_id uuid, _channel text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_submission public.site_form_submissions%ROWTYPE; v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_submission FROM public.site_form_submissions WHERE id = _submission_id;
  IF NOT FOUND OR v_submission.status <> 'processed' OR v_submission.metadata->>'questionnaire_first' IS DISTINCT FROM 'true' THEN RETURN; END IF;
  SELECT p.* INTO v_profile FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
  WHERE p.id = v_submission.profile_id AND p.status = 'active' AND NOT coalesce(p.is_archived,false)
    AND p.merged_to_profile_id IS NULL AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now());
  IF NOT FOUND OR v_profile.user_id::text IS DISTINCT FROM v_submission.metadata->>'user_id' THEN RETURN; END IF;
  INSERT INTO public.broadcast_automation_deliveries(template_id,user_id,event_key,channel,available_at)
  SELECT bt.id,v_profile.user_id,
    'site_form:' || v_submission.page_id::text || ':' || (v_submission.metadata->>'block_id') || ':submitted:' || ch.value,
    ch.value, now()+make_interval(mins=>coalesce((bt.metadata->'site_form_condition'->>'delay_minutes')::int,0))
  FROM public.broadcast_templates bt
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN coalesce(array_length(bt.channels,1),0) > 0 THEN to_jsonb(bt.channels) ELSE jsonb_build_array(bt.channel) END
  ) ch(value)
  WHERE bt.trigger_kind = 'site_form_event' AND bt.status = 'recurring' AND bt.approval_status = 'approved'
    AND bt.metadata->'site_form_condition'->>'event' = 'submitted'
    AND public.site_questionnaire_after_cutoff(v_submission.created_at,bt.metadata->'site_form_condition')
    AND bt.metadata->'site_form_condition'->>'page_id' = v_submission.page_id::text
    AND bt.metadata->'site_form_condition'->>'block_id' = v_submission.metadata->>'block_id'
    AND (bt.metadata->'site_form_condition'->>'delay_minutes' IS NULL OR
      CASE WHEN bt.metadata->'site_form_condition'->>'delay_minutes' ~ '^[0-9]{1,5}$' THEN
        (bt.metadata->'site_form_condition'->>'delay_minutes')::int BETWEEN 0 AND 10080 ELSE false END)
    AND ch.value IN ('email','telegram') AND (_channel IS NULL OR ch.value = _channel)
    AND (ch.value = 'email' OR v_profile.telegram_user_id IS NOT NULL)
  ON CONFLICT (template_id,user_id,event_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) TO service_role;

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
      AND s.metadata->>'block_id'=v_condition->>'block_id'
      AND (v_condition->>'event' IS DISTINCT FROM 'submitted' OR public.site_questionnaire_after_cutoff(s.created_at,v_condition))) INTO v_complete;
  IF v_condition->>'event'='submitted' THEN
    IF v_condition->>'delay_minutes' IS NOT NULL AND NOT coalesce(v_condition->>'delay_minutes' ~ '^[0-9]{1,5}$',false) THEN RETURN false; END IF;
    v_delay := coalesce((v_condition->>'delay_minutes')::int,0);
    RETURN v_delay BETWEEN 0 AND 10080 AND v_delivery.available_at<=now()
      AND v_delivery.created_at+make_interval(mins=>v_delay)<=now() AND v_complete AND v_delivery.event_key='site_form:'||(v_condition->>'page_id')||':'||(v_condition->>'block_id')||':submitted:'||v_delivery.channel;
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
