BEGIN;

-- A numbered 29th–31st fires only in months that contain that date.  The
-- explicit last-day option is the stable choice for February and short months.
ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN recurrence_month_day smallint,
  ADD COLUMN recurrence_month_last boolean,
  ADD COLUMN recurrence_month_key text;

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_trigger_type_v12_chk,
  DROP CONSTRAINT crm_pipeline_automation_trigger_config_v12_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v13_chk CHECK (trigger_type IN ('deal_entered_stage','after_event','at_datetime','weekday','month_day')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v13_chk CHECK (
    (trigger_type IN ('deal_entered_stage','after_event') AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'at_datetime' AND scheduled_local_at IS NOT NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'weekday' AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND cardinality(recurrence_weekdays) BETWEEN 1 AND 7 AND recurrence_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND recurrence_local_time IS NOT NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type = 'month_day' AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND recurrence_weekdays IS NULL AND recurrence_last_key IS NULL AND recurrence_local_time IS NOT NULL AND ((recurrence_month_day BETWEEN 1 AND 31 AND recurrence_month_last IS NULL) OR (recurrence_month_day IS NULL AND recurrence_month_last = true)))
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_due_month_days_v13()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$
DECLARE _fired integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key='feature_crm_pipeline_automation_v1' AND coalesce((value #>> '{}')::boolean,false)) THEN RETURN 0; END IF;
  WITH due AS (
    SELECT r.*, (now() AT TIME ZONE r.timezone) AS local_now, to_char(now() AT TIME ZONE r.timezone,'YYYY-MM') AS month_key
    FROM public.crm_pipeline_automation_rules r
    WHERE r.status='active' AND r.trigger_type='month_day' AND (now() AT TIME ZONE r.timezone)::time >= r.recurrence_local_time
      AND r.recurrence_month_key IS DISTINCT FROM to_char(now() AT TIME ZONE r.timezone,'YYYY-MM')
      AND ((r.recurrence_month_last = true AND (now() AT TIME ZONE r.timezone)::date = (date_trunc('month', now() AT TIME ZONE r.timezone) + interval '1 month - 1 day')::date) OR (r.recurrence_month_day = extract(day FROM now() AT TIME ZONE r.timezone)::smallint))
    FOR UPDATE SKIP LOCKED
  ), queued AS (
    INSERT INTO public.crm_pipeline_automation_jobs(rule_id,logical_id,rule_version,deal_id,event_key,event_payload,available_at)
    SELECT r.id,r.logical_id,r.version,d.id,concat('month_day:',r.month_key),jsonb_build_object('month_key',r.month_key,'timezone',r.timezone),public.crm_pipeline_automation_next_available_at(now(),0,r.timezone,r.quiet_hours_start,r.quiet_hours_end)
    FROM due r JOIN public.orders_v2 d ON d.pipeline_id=r.pipeline_id AND d.pipeline_stage_id=r.stage_id AND NOT d.is_deleted
    ON CONFLICT (logical_id,rule_version,deal_id,event_key) DO NOTHING RETURNING rule_id
  ), marked AS (UPDATE public.crm_pipeline_automation_rules r SET recurrence_month_key=d.month_key FROM due d WHERE r.id=d.id RETURNING r.id)
  SELECT count(*) INTO _fired FROM marked; RETURN _fired;
END; $$;
REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_due_month_days_v13() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_enqueue_due_month_days_v13() TO service_role;
COMMIT;
