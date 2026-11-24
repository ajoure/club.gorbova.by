
ALTER TABLE public.broadcast_automation_deliveries DROP CONSTRAINT IF EXISTS broadcast_automation_deliveries_channel_check;
ALTER TABLE public.broadcast_automation_deliveries ADD CONSTRAINT broadcast_automation_deliveries_channel_check CHECK(channel IN('email','telegram','sms'));
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
    AND ch.value IN ('email','telegram','sms') AND (_channel IS NULL OR ch.value = _channel)
    AND (ch.value = 'email' OR(ch.value='telegram' AND v_profile.telegram_user_id IS NOT NULL) OR(ch.value='sms' AND public.sms_normalize_phone(v_profile.phone) IS NOT NULL))
  ON CONFLICT (template_id,user_id,event_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) TO service_role;
