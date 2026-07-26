BEGIN;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN recurrence_weekdays smallint[],
  ADD COLUMN recurrence_local_time time,
  ADD COLUMN recurrence_last_key date;

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT IF EXISTS crm_pipeline_automation_trigger_type_v11_chk,
  DROP CONSTRAINT IF EXISTS crm_pipeline_automation_trigger_config_v11_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v12_chk
    CHECK (trigger_type IN ('deal_entered_stage', 'after_event', 'at_datetime', 'weekday')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v12_chk CHECK (
    (trigger_type IN ('deal_entered_stage', 'after_event') AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL)
    OR (trigger_type = 'at_datetime' AND scheduled_local_at IS NOT NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL)
    OR (trigger_type = 'weekday' AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL
      AND cardinality(recurrence_weekdays) BETWEEN 1 AND 7
      AND recurrence_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
      AND recurrence_local_time IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_due_weekdays_v12()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE _fired_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings s WHERE s.key = 'feature_crm_pipeline_automation_v1' AND coalesce((s.value #>> '{}')::boolean, false)) THEN RETURN 0; END IF;
  WITH due_rules AS (
    SELECT r.id, r.logical_id, r.version, r.pipeline_id, r.stage_id, r.timezone,
      r.recurrence_local_time, r.quiet_hours_start, r.quiet_hours_end,
      (now() AT TIME ZONE r.timezone)::date AS local_date
    FROM public.crm_pipeline_automation_rules r
    WHERE r.status = 'active' AND r.trigger_type = 'weekday'
      AND extract(isodow FROM now() AT TIME ZONE r.timezone)::smallint = ANY(r.recurrence_weekdays)
      AND (now() AT TIME ZONE r.timezone)::time >= r.recurrence_local_time
      AND r.recurrence_last_key IS DISTINCT FROM (now() AT TIME ZONE r.timezone)::date
    FOR UPDATE SKIP LOCKED
  ), queued AS (
    INSERT INTO public.crm_pipeline_automation_jobs(rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at)
    SELECT r.id, r.logical_id, r.version, d.id, concat('weekday:', r.local_date::text),
      jsonb_build_object('pipeline_id', r.pipeline_id, 'stage_id', r.stage_id, 'weekday_key', r.local_date, 'timezone', r.timezone),
      public.crm_pipeline_automation_next_available_at(now(), 0, r.timezone, r.quiet_hours_start, r.quiet_hours_end)
    FROM due_rules r JOIN public.orders_v2 d ON d.pipeline_id = r.pipeline_id AND d.pipeline_stage_id = r.stage_id AND NOT d.is_deleted
    ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING
    RETURNING rule_id
  ), fired AS (
    UPDATE public.crm_pipeline_automation_rules r SET recurrence_last_key = due.local_date
    FROM due_rules due WHERE r.id = due.id RETURNING r.id
  ) SELECT count(*) INTO _fired_count FROM fired;
  RETURN _fired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_due_weekdays_v12() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_enqueue_due_weekdays_v12() TO service_role;

COMMIT;
