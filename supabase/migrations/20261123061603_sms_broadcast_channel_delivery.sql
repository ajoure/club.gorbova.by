CREATE OR REPLACE FUNCTION public.sms_funnel_audience(p_segment jsonb,p_offset integer DEFAULT 0,p_limit integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public.telegram_funnel_can_manage() THEN RAISE EXCEPTION 'communication_manage_required' USING ERRCODE='42501';END IF;
 PERFORM public.telegram_funnel_validate_segment(p_segment);
 IF p_offset IS NULL OR p_limit IS NULL OR p_offset NOT BETWEEN 0 AND 1000000 OR p_limit NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'funnel_page_invalid';END IF;
 WITH candidates AS MATERIALIZED(SELECT p.id profile_id,p.user_id,p.full_name,public.sms_normalize_phone(p.phone) phone FROM private.telegram_funnel_matching_profiles(p_segment)m JOIN public.profiles p ON p.id=m), matched AS MATERIALIZED(SELECT c.profile_id,c.user_id,c.full_name,(c.phone IS NOT NULL AND row_number()OVER(PARTITION BY c.phone ORDER BY(c.user_id IS NOT NULL)DESC,c.profile_id)=1) has_dialog FROM candidates c),
 paged AS(SELECT * FROM matched ORDER BY profile_id LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM matched),'available_count',(SELECT count(*) FROM matched WHERE has_dialog),'recipients',coalesce((SELECT jsonb_agg(to_jsonb(pg) ORDER BY profile_id) FROM paged pg),'[]')) INTO result;RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.sms_funnel_audience(jsonb,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sms_funnel_audience(jsonb,integer,integer) TO authenticated;
CREATE OR REPLACE FUNCTION public.sms_funnel_claim_send(p_delivery uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments;d public.telegram_funnel_deliveries;l public.telegram_funnel_launches;b jsonb;lease uuid;sms uuid;
BEGIN
 -- Preserve the Telegram transport lock order: enrollment -> delivery.
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found');END IF;
 SELECT * INTO l FROM public.telegram_funnel_launches WHERE id=e.launch_id;
 IF e.status='scheduled' OR l.scheduled_for>now() THEN RETURN jsonb_build_object('state','scheduled');END IF;
 IF e.status<>'active' OR l.status<>'active' THEN RETURN jsonb_build_object('state','stopped');END IF;
 IF d.status<>'queued' THEN
  IF d.status='sending' AND d.started_at<now()-interval '2 minutes' THEN UPDATE public.telegram_funnel_deliveries SET status='unknown',error_code='interrupted_send' WHERE id=d.id;RETURN jsonb_build_object('state','unknown');END IF;
  RETURN jsonb_build_object('state',d.status);
 END IF;
 SELECT value INTO b FROM jsonb_array_elements(l.graph_snapshot->'blocks') WHERE value->>'id'=d.block_id::text;
 IF b->>'channel' IS DISTINCT FROM 'sms' OR length(coalesce(b->>'text','')) NOT BETWEEN 1 AND 1000 OR jsonb_array_length(b->'buttons')<>0 OR coalesce(b->>'image_path','')<>'' THEN RAISE EXCEPTION 'funnel_sms_plain_text_required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=e.profile_id AND p.user_id IS NOT DISTINCT FROM e.user_id AND p.is_archived IS NOT TRUE AND p.status IS DISTINCT FROM 'archived' AND p.merged_to_profile_id IS NULL AND public.sms_normalize_phone(p.phone)=e.phone_e164) THEN
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE id=d.id;
  UPDATE public.telegram_funnel_enrollments SET status='error',reason='recipient_binding_changed' WHERE id=e.id;
  RETURN jsonb_build_object('state','recipient_binding_changed');
 END IF;
 lease:=gen_random_uuid();
 INSERT INTO public.sms_messages(contact_id,phone_e164,text,provider,status,initiator_user_id,dispatch_key,funnel_delivery_id)
 VALUES(e.profile_id,e.phone_e164,b->>'text','smsby','sending',l.created_by,'funnel:'||l.id::text||':'||d.block_id::text||':'||e.phone_e164,d.id) ON CONFLICT(dispatch_key)WHERE dispatch_key IS NOT NULL DO NOTHING RETURNING id INTO sms;
 IF sms IS NULL THEN
  UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='duplicate_sms_phone',finished_at=now() WHERE id=d.id;
  UPDATE public.telegram_funnel_enrollments SET status='completed',reason='duplicate_sms_phone' WHERE id=e.id AND status='active';
  INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'sms_duplicate:'||d.id::text,'skipped',jsonb_build_object('channel','sms','reason','duplicate_sms_phone'))ON CONFLICT(event_key)DO NOTHING;
  RETURN jsonb_build_object('state','duplicate_sms_phone');
 END IF;
 UPDATE public.telegram_funnel_deliveries SET status='sending',lease_id=lease,started_at=now() WHERE id=d.id;
 RETURN jsonb_build_object('state','claimed','lease_id',lease,'sms_id',sms,'phone',e.phone_e164,'text',b->>'text');
END $$;
CREATE OR REPLACE FUNCTION public.sms_funnel_finish_send(p_delivery uuid,p_lease uuid,p_outcome text,p_external text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.telegram_funnel_enrollments;d public.telegram_funnel_deliveries;
BEGIN
 SELECT en.* INTO e FROM public.telegram_funnel_enrollments en JOIN public.telegram_funnel_deliveries ds ON ds.enrollment_id=en.id WHERE ds.id=p_delivery FOR UPDATE OF en;
 SELECT * INTO d FROM public.telegram_funnel_deliveries WHERE id=p_delivery FOR UPDATE;
 IF NOT FOUND OR d.lease_id IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'funnel_lease_mismatch';END IF;
 IF d.status='sent' THEN RETURN jsonb_build_object('state','sent');END IF;
 IF d.status NOT IN('sending','unknown') OR p_outcome NOT IN('sent','failed','unknown') OR(p_outcome='sent' AND coalesce(p_external,'')='') THEN RAISE EXCEPTION 'funnel_finish_invalid';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sms_messages WHERE funnel_delivery_id=d.id) THEN RAISE EXCEPTION 'funnel_sms_receipt_missing';END IF;
 UPDATE public.sms_messages SET status=p_outcome,external_id=p_external,error=left(p_error,100),updated_at=now() WHERE funnel_delivery_id=d.id;
 UPDATE public.telegram_funnel_deliveries SET status=p_outcome,error_code=left(p_error,100),finished_at=now() WHERE id=d.id;
 IF p_outcome='failed' THEN UPDATE public.telegram_funnel_enrollments SET status='error',reason='delivery_failed' WHERE id=e.id AND status='active';END IF;
 IF p_outcome='sent' THEN
  UPDATE public.telegram_funnel_enrollments SET current_delivery_id=d.id WHERE id=e.id;
  IF e.status='active' AND NOT EXISTS(SELECT 1 FROM public.telegram_funnel_callback_tokens WHERE enrollment_id=e.id AND dispatch_id IS NULL AND revoked_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries WHERE enrollment_id=e.id AND status IN('queued','sending','unknown')) THEN UPDATE public.telegram_funnel_enrollments SET status='completed' WHERE id=e.id;END IF;
 END IF;
 INSERT INTO public.telegram_funnel_events(enrollment_id,delivery_id,event_key,kind,detail) VALUES(e.id,d.id,'finish:'||d.id::text||':'||p_outcome,p_outcome,jsonb_build_object('channel','sms','provider_id',p_external,'error_code',left(p_error,100))) ON CONFLICT(event_key)DO NOTHING;
 RETURN jsonb_build_object('state',p_outcome);
END $$;
REVOKE ALL ON FUNCTION public.sms_funnel_claim_send(uuid),public.sms_funnel_finish_send(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_funnel_claim_send(uuid),public.sms_funnel_finish_send(uuid,uuid,text,text,text) TO service_role;

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

CREATE OR REPLACE FUNCTION public.sms_broadcast_summary(p_dispatch uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('dispatch_id',p_dispatch,'queued',count(*) FILTER(WHERE status='queued'),'sent',count(*) FILTER(WHERE status IN('sent','delivered')),'failed',count(*) FILTER(WHERE status='failed'),'unknown',count(*) FILTER(WHERE status IN('sending','unknown')),'skipped',count(*) FILTER(WHERE status='skipped'),'total',count(*),'sms_ids',coalesce((SELECT jsonb_agg(id) FROM(SELECT id FROM public.sms_messages WHERE dispatch_id=p_dispatch ORDER BY id LIMIT 20)s),'[]'::jsonb),'delivery_status','not_confirmed') FROM public.sms_messages WHERE dispatch_id=p_dispatch;
$$;
REVOKE ALL ON FUNCTION public.sms_broadcast_summary(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_summary(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sms_broadcast_audience_count(p_filters jsonb) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*) FROM public.resolve_sms_broadcast_contacts(p_filters);
$$;
REVOKE ALL ON FUNCTION public.sms_broadcast_audience_count(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sms_broadcast_audience_count(jsonb) TO service_role;
