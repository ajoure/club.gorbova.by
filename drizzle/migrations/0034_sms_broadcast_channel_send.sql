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
