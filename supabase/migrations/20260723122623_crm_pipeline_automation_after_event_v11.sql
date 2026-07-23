BEGIN;

-- `after_event` is a distinct, publishable trigger contract. In v1 its only
-- allowed source is entry into the selected stage; future source events can be
-- added without turning an existing delay field into an ambiguous scheduler.
ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT IF EXISTS crm_pipeline_automation_trigger_type_v10_chk,
  DROP CONSTRAINT IF EXISTS crm_pipeline_automation_schedule_config_v10_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v11_chk
    CHECK (trigger_type IN ('deal_entered_stage', 'after_event', 'at_datetime')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v11_chk CHECK (
    (trigger_type = 'deal_entered_stage'
      AND scheduled_local_at IS NULL
      AND scheduled_fired_at IS NULL)
    OR
    (trigger_type = 'after_event'
      AND scheduled_local_at IS NULL
      AND scheduled_fired_at IS NULL
      AND delay_minutes BETWEEN 1 AND 525600)
    OR
    (trigger_type = 'at_datetime' AND scheduled_local_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_stage_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _event_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_settings s
    WHERE s.key = 'feature_crm_pipeline_automation_v1'
      AND coalesce((s.value #>> '{}')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;
  IF NEW.is_deleted OR NEW.pipeline_stage_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.pipeline_stage_id IS NOT DISTINCT FROM OLD.pipeline_stage_id THEN
    RETURN NEW;
  END IF;

  _event_key := concat(
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'moved' END,
    ':', CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.pipeline_stage_id::text, 'none') ELSE 'none' END,
    ':', NEW.pipeline_stage_id::text
  );

  INSERT INTO public.crm_pipeline_automation_jobs(
    rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
  )
  SELECT
    r.id, r.logical_id, r.version, NEW.id, _event_key,
    jsonb_build_object(
      'pipeline_id', NEW.pipeline_id,
      'old_stage_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.pipeline_stage_id ELSE NULL END,
      'new_stage_id', NEW.pipeline_stage_id,
      'occurred_at', now(),
      'trigger_type', r.trigger_type
    ),
    public.crm_pipeline_automation_next_available_at(
      now(), r.delay_minutes, r.timezone, r.quiet_hours_start, r.quiet_hours_end
    )
  FROM public.crm_pipeline_automation_rules r
  WHERE r.stage_id = NEW.pipeline_stage_id
    AND r.pipeline_id = NEW.pipeline_id
    AND r.status = 'active'
    AND r.trigger_type IN ('deal_entered_stage', 'after_event')
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON CONSTRAINT crm_pipeline_automation_trigger_config_v11_chk
  ON public.crm_pipeline_automation_rules IS
  'after_event v1 is delayed stage entry; at_datetime requires a local timestamp.';

COMMIT;
