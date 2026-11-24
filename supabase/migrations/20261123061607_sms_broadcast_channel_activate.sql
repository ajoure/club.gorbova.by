CREATE OR REPLACE FUNCTION public.telegram_funnel_activate_due(p_launch uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.telegram_funnel_launches;e public.telegram_funnel_enrollments;old public.telegram_funnel_enrollments;activated integer:=0;batch_ids uuid[];fence_id uuid;
BEGIN
 -- Select a bounded batch, then acquire every launch lock before any lifecycle fence.
 SELECT array_agg(id)INTO batch_ids FROM(SELECT ln.id FROM public.telegram_funnel_launches ln WHERE ln.status='active' AND ln.scheduled_for<=now() AND(p_launch IS NULL OR ln.id=p_launch) AND EXISTS(SELECT 1 FROM public.telegram_funnel_enrollments en WHERE en.launch_id=ln.id AND en.status='scheduled') ORDER BY ln.scheduled_for,ln.id LIMIT 10)due;
 PERFORM 1 FROM public.telegram_funnel_launches WHERE id=ANY(batch_ids)ORDER BY id FOR UPDATE;
 FOR fence_id IN SELECT DISTINCT funnel_id FROM public.telegram_funnel_launches WHERE id=ANY(batch_ids)ORDER BY funnel_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('telegram_funnel_lifecycle:'||fence_id::text,0));
 END LOOP;
 FOR l IN SELECT ln.* FROM public.telegram_funnel_launches ln WHERE ln.id=ANY(batch_ids)AND ln.status='active'AND ln.scheduled_for<=now()ORDER BY ln.scheduled_for,ln.id LOOP
 FOR e IN SELECT en.* FROM public.telegram_funnel_enrollments en WHERE en.launch_id=l.id AND en.status='scheduled' ORDER BY en.profile_id LIMIT 200 LOOP
  SELECT * INTO e FROM public.telegram_funnel_enrollments WHERE id=e.id FOR UPDATE;
  IF e.status<>'scheduled' THEN CONTINUE;END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles pr WHERE pr.id=e.profile_id AND pr.user_id IS NOT DISTINCT FROM e.user_id AND pr.is_archived IS NOT TRUE AND pr.status IS DISTINCT FROM 'archived' AND pr.merged_to_profile_id IS NULL AND CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(l.graph_snapshot->'blocks')b WHERE b->>'id'=l.graph_snapshot->>'start_block_id' AND b->>'channel'='sms') THEN public.sms_normalize_phone(pr.phone)=e.phone_e164 ELSE pr.telegram_user_id=e.telegram_user_id AND public.telegram_funnel_known_dialog(e.profile_id,l.bot_id) END) THEN
   UPDATE public.telegram_funnel_enrollments SET status='skipped',reason='recipient_binding_changed' WHERE id=e.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='recipient_binding_changed' WHERE enrollment_id=e.id AND status='queued';CONTINUE;
  END IF;
  SELECT * INTO old FROM public.telegram_funnel_enrollments WHERE funnel_id=l.funnel_id AND profile_id=e.profile_id AND status='active' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.telegram_funnel_deliveries d JOIN public.telegram_funnel_enrollments en ON en.id=d.enrollment_id WHERE en.funnel_id=l.funnel_id AND en.profile_id=e.profile_id AND d.status IN('sending','unknown')) THEN
   UPDATE public.telegram_funnel_enrollments SET reason='prior_delivery_unresolved' WHERE id=e.id;CONTINUE;
  END IF;
  IF old.id IS NOT NULL AND NOT l.restart_existing THEN
   UPDATE public.telegram_funnel_enrollments SET status='skipped',reason='already_active' WHERE id=e.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='already_active' WHERE enrollment_id=e.id AND status='queued';CONTINUE;
  END IF;
  IF old.id IS NOT NULL THEN
   UPDATE public.telegram_funnel_enrollments SET status='stopped',reason='explicit_restart',stopped_at=now() WHERE id=old.id;
   UPDATE public.telegram_funnel_callback_tokens SET revoked_at=now() WHERE enrollment_id=old.id;
   UPDATE public.telegram_funnel_deliveries SET status='skipped',error_code='explicit_restart' WHERE enrollment_id=old.id AND status='queued';
   INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)VALUES(old.id,'restart:'||l.id::text||':'||old.id::text,'restarted')ON CONFLICT(event_key)DO NOTHING;
  END IF;
  UPDATE public.telegram_funnel_enrollments SET status='active',reason=NULL WHERE id=e.id;
  INSERT INTO public.telegram_funnel_events(enrollment_id,event_key,kind)VALUES(e.id,'activate:'||e.id::text,'activated')ON CONFLICT(event_key)DO NOTHING;
  activated:=activated+1;
 END LOOP;END LOOP;RETURN activated;
END $$;
