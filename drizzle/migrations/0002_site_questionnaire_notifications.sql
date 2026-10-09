ALTER TABLE public.broadcast_templates DROP CONSTRAINT IF EXISTS broadcast_templates_trigger_kind_check;
ALTER TABLE public.broadcast_templates ADD CONSTRAINT broadcast_templates_trigger_kind_check
  CHECK (trigger_kind IN ('manual','lesson_event','scheduled_condition','site_form_event'));
ALTER TABLE public.broadcast_automation_deliveries ADD COLUMN IF NOT EXISTS channel text
  CHECK (channel IN ('email','telegram'));

-- Each channel owns one delivery journal per page/block/contact, regardless of
-- questionnaire retries or later edits. Existing lesson automations stay intact.
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
  INSERT INTO public.broadcast_automation_deliveries(template_id,user_id,event_key,channel)
  SELECT bt.id,v_profile.user_id,
    'site_form:' || v_submission.page_id::text || ':' || (v_submission.metadata->>'block_id') || ':submitted:' || ch.value,
    ch.value
  FROM public.broadcast_templates bt
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN coalesce(array_length(bt.channels,1),0) > 0 THEN to_jsonb(bt.channels) ELSE jsonb_build_array(bt.channel) END
  ) ch(value)
  WHERE bt.trigger_kind = 'site_form_event' AND bt.status = 'recurring' AND bt.approval_status = 'approved'
    AND bt.metadata->'site_form_condition'->>'event' = 'submitted'
    AND bt.metadata->'site_form_condition'->>'page_id' = v_submission.page_id::text
    AND bt.metadata->'site_form_condition'->>'block_id' = v_submission.metadata->>'block_id'
    AND ch.value IN ('email','telegram') AND (_channel IS NULL OR ch.value = _channel)
    AND (ch.value = 'email' OR v_profile.telegram_user_id IS NOT NULL)
  ON CONFLICT (template_id,user_id,event_key) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.queue_site_questionnaire_broadcasts(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_queue_site_questionnaire_broadcasts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.queue_site_questionnaire_broadcasts(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_queue_site_questionnaire_broadcasts() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_queue_site_questionnaire_broadcasts ON public.site_form_submissions;
CREATE TRIGGER trg_queue_site_questionnaire_broadcasts AFTER INSERT ON public.site_form_submissions
FOR EACH ROW EXECUTE FUNCTION public.trg_queue_site_questionnaire_broadcasts();

CREATE OR REPLACE FUNCTION public.trg_queue_linked_site_questionnaire_broadcasts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_submission uuid;
BEGIN
  IF NEW.telegram_user_id IS NULL OR NEW.telegram_user_id IS NOT DISTINCT FROM OLD.telegram_user_id THEN RETURN NEW; END IF;
  FOR v_submission IN SELECT id FROM public.site_form_submissions WHERE profile_id = NEW.id
    AND metadata->>'questionnaire_first' = 'true' AND status = 'processed' LOOP
    PERFORM public.queue_site_questionnaire_broadcasts(v_submission,'telegram');
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_queue_linked_site_questionnaire_broadcasts() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_queue_linked_site_questionnaire_broadcasts ON public.profiles;
CREATE TRIGGER trg_queue_linked_site_questionnaire_broadcasts AFTER UPDATE OF telegram_user_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.trg_queue_linked_site_questionnaire_broadcasts();
