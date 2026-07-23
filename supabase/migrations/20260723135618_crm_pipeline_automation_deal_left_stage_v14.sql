BEGIN;

-- Leaving a stage is deliberately a distinct event from entering a stage. Its
-- rules must not require the deal to still be in the old stage when the worker
-- executes them.
ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_trigger_type_v13_chk,
  DROP CONSTRAINT crm_pipeline_automation_trigger_config_v13_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v14_chk
    CHECK (trigger_type IN ('deal_entered_stage', 'deal_left_stage', 'after_event', 'at_datetime', 'weekday', 'month_day')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v14_chk CHECK (
    (trigger_type = 'deal_entered_stage'
      AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL
      AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL
      AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'deal_left_stage'
      AND require_same_stage = false
      AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL
      AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL
      AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'after_event'
      AND delay_minutes BETWEEN 1 AND 525600
      AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL
      AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL
      AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'at_datetime'
      AND scheduled_local_at IS NOT NULL
      AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL
      AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'weekday'
      AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL
      AND cardinality(recurrence_weekdays) BETWEEN 1 AND 7
      AND recurrence_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
      AND recurrence_local_time IS NOT NULL
      AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'month_day'
      AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL
      AND recurrence_weekdays IS NULL AND recurrence_last_key IS NULL
      AND recurrence_local_time IS NOT NULL
      AND ((recurrence_month_day BETWEEN 1 AND 31 AND recurrence_month_last IS NULL)
        OR (recurrence_month_day IS NULL AND recurrence_month_last = true)))
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_stage_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  _entry_event_key text;
  _left_event_key text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_settings s
    WHERE s.key = 'feature_crm_pipeline_automation_v1'
      AND coalesce((s.value #>> '{}')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.is_deleted THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
    AND NEW.pipeline_stage_id IS NOT DISTINCT FROM OLD.pipeline_stage_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.pipeline_id IS NOT NULL AND NEW.pipeline_stage_id IS NOT NULL THEN
    _entry_event_key := concat(
      'stage_entered:',
      CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.pipeline_id::text, 'none') ELSE 'none' END,
      ':', CASE WHEN TG_OP = 'UPDATE' THEN coalesce(OLD.pipeline_stage_id::text, 'none') ELSE 'none' END,
      ':', NEW.pipeline_id::text, ':', NEW.pipeline_stage_id::text
    );

    INSERT INTO public.crm_pipeline_automation_jobs(
      rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
    )
    SELECT
      r.id, r.logical_id, r.version, NEW.id, _entry_event_key,
      jsonb_build_object(
        'event_type', 'stage_entered', 'pipeline_id', NEW.pipeline_id,
        'old_pipeline_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.pipeline_id ELSE NULL END,
        'old_stage_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.pipeline_stage_id ELSE NULL END,
        'new_stage_id', NEW.pipeline_stage_id, 'occurred_at', now(),
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
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.pipeline_id IS NOT NULL
    AND OLD.pipeline_stage_id IS NOT NULL
  THEN
    _left_event_key := concat(
      'stage_left:', OLD.pipeline_id::text, ':', OLD.pipeline_stage_id::text,
      ':', coalesce(NEW.pipeline_id::text, 'none'), ':', coalesce(NEW.pipeline_stage_id::text, 'none')
    );

    INSERT INTO public.crm_pipeline_automation_jobs(
      rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
    )
    SELECT
      r.id, r.logical_id, r.version, NEW.id, _left_event_key,
      jsonb_build_object(
        'event_type', 'stage_left', 'pipeline_id', OLD.pipeline_id,
        'old_stage_id', OLD.pipeline_stage_id,
        'new_pipeline_id', NEW.pipeline_id, 'new_stage_id', NEW.pipeline_stage_id,
        'occurred_at', now(), 'trigger_type', r.trigger_type
      ),
      public.crm_pipeline_automation_next_available_at(
        now(), r.delay_minutes, r.timezone, r.quiet_hours_start, r.quiet_hours_end
      )
    FROM public.crm_pipeline_automation_rules r
    WHERE r.stage_id = OLD.pipeline_stage_id
      AND r.pipeline_id = OLD.pipeline_id
      AND r.status = 'active'
      AND r.trigger_type = 'deal_left_stage'
    ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_stage_entry() FROM PUBLIC, anon, authenticated;

COMMENT ON CONSTRAINT crm_pipeline_automation_trigger_config_v14_chk
  ON public.crm_pipeline_automation_rules IS
  'deal_left_stage runs after leaving its configured stage and cannot require the old stage at execution time.';

COMMIT;
