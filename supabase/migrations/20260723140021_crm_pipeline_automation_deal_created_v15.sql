BEGIN;

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_trigger_type_v14_chk,
  DROP CONSTRAINT crm_pipeline_automation_trigger_config_v14_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v15_chk
    CHECK (trigger_type IN ('deal_entered_stage', 'deal_left_stage', 'deal_created', 'after_event', 'at_datetime', 'weekday', 'month_day')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v15_chk CHECK (
    (trigger_type IN ('deal_entered_stage', 'deal_created')
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

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_deal_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_settings s
    WHERE s.key = 'feature_crm_pipeline_automation_v1'
      AND coalesce((s.value #>> '{}')::boolean, false)
  ) OR NEW.is_deleted OR NEW.pipeline_id IS NULL OR NEW.pipeline_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.crm_pipeline_automation_jobs(
    rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
  )
  SELECT
    r.id, r.logical_id, r.version, NEW.id,
    concat('deal_created:', NEW.pipeline_id::text, ':', NEW.pipeline_stage_id::text),
    jsonb_build_object(
      'event_type', 'deal_created', 'pipeline_id', NEW.pipeline_id,
      'new_stage_id', NEW.pipeline_stage_id, 'occurred_at', now(),
      'trigger_type', r.trigger_type
    ),
    public.crm_pipeline_automation_next_available_at(
      now(), r.delay_minutes, r.timezone, r.quiet_hours_start, r.quiet_hours_end
    )
  FROM public.crm_pipeline_automation_rules r
  WHERE r.pipeline_id = NEW.pipeline_id
    AND r.stage_id = NEW.pipeline_stage_id
    AND r.status = 'active'
    AND r.trigger_type = 'deal_created'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_deal_created() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_crm_pipeline_automation_deal_created
  AFTER INSERT ON public.orders_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_enqueue_deal_created();

COMMENT ON CONSTRAINT crm_pipeline_automation_trigger_config_v15_chk
  ON public.crm_pipeline_automation_rules IS
  'deal_created fires only from the orders_v2 INSERT path; later stage movement uses deal_entered_stage.';

COMMIT;
