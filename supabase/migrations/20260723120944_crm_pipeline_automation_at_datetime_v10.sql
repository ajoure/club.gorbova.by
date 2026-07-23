BEGIN;

-- v10: one-off local date/time trigger.  The local timestamp is deliberately
-- retained alongside the rule timezone so its meaning does not change when an
-- admin opens the rule from another browser timezone.
ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN scheduled_local_at timestamp without time zone,
  ADD COLUMN scheduled_fired_at timestamptz;

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT IF EXISTS crm_pipeline_automation_rules_trigger_type_check,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v10_chk
    CHECK (trigger_type IN ('deal_entered_stage', 'at_datetime')),
  ADD CONSTRAINT crm_pipeline_automation_schedule_config_v10_chk CHECK (
    (trigger_type = 'deal_entered_stage'
      AND scheduled_local_at IS NULL
      AND scheduled_fired_at IS NULL)
    OR
    (trigger_type = 'at_datetime' AND scheduled_local_at IS NOT NULL)
  );

CREATE INDEX crm_pipeline_automation_due_schedule_v10_idx
  ON public.crm_pipeline_automation_rules (scheduled_local_at, timezone)
  WHERE status = 'active'
    AND trigger_type = 'at_datetime'
    AND scheduled_fired_at IS NULL;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_schedule_v10()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.trigger_type = 'at_datetime'
    AND NEW.scheduled_local_at IS NULL
  THEN
    RAISE EXCEPTION 'automation_schedule_datetime_required' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived')
    AND ROW(NEW.scheduled_local_at, NEW.timezone) IS DISTINCT FROM
        ROW(OLD.scheduled_local_at, OLD.timezone)
  THEN
    RAISE EXCEPTION 'published_automation_version_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_automation_validate_schedule_v10
  ON public.crm_pipeline_automation_rules;
CREATE TRIGGER trg_crm_pipeline_automation_validate_schedule_v10
  BEFORE INSERT OR UPDATE ON public.crm_pipeline_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_validate_schedule_v10();

-- The existing deal-stage trigger must never create a job for a calendar rule.
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
      'occurred_at', now()
    ),
    public.crm_pipeline_automation_next_available_at(
      now(), r.delay_minutes, r.timezone, r.quiet_hours_start, r.quiet_hours_end
    )
  FROM public.crm_pipeline_automation_rules r
  WHERE r.stage_id = NEW.pipeline_stage_id
    AND r.pipeline_id = NEW.pipeline_id
    AND r.status = 'active'
    AND r.trigger_type = 'deal_entered_stage'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

-- A worker tick atomically claims due rules, snapshots the current stage cohort
-- into regular jobs, and marks the one-off trigger consumed.  It is safe for
-- concurrent worker invocations; job uniqueness is a second idempotency guard.
CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_due_schedules_v10()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  _fired_count integer := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.app_settings s
    WHERE s.key = 'feature_crm_pipeline_automation_v1'
      AND coalesce((s.value #>> '{}')::boolean, false)
  ) THEN
    RETURN 0;
  END IF;

  WITH due_rules AS (
    SELECT r.id, r.logical_id, r.version, r.pipeline_id, r.stage_id,
      r.scheduled_local_at, r.timezone, r.quiet_hours_start, r.quiet_hours_end
    FROM public.crm_pipeline_automation_rules r
    WHERE r.status = 'active'
      AND r.trigger_type = 'at_datetime'
      AND r.scheduled_fired_at IS NULL
      AND (r.scheduled_local_at AT TIME ZONE r.timezone) <= now()
    ORDER BY r.scheduled_local_at, r.created_at
    FOR UPDATE SKIP LOCKED
  ), queued AS (
    INSERT INTO public.crm_pipeline_automation_jobs(
      rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
    )
    SELECT
      r.id, r.logical_id, r.version, d.id,
      concat('at_datetime:', r.scheduled_local_at::text),
      jsonb_build_object(
        'pipeline_id', r.pipeline_id,
        'stage_id', r.stage_id,
        'scheduled_local_at', r.scheduled_local_at,
        'timezone', r.timezone,
        'enqueued_at', now()
      ),
      public.crm_pipeline_automation_next_available_at(
        r.scheduled_local_at AT TIME ZONE r.timezone,
        0, r.timezone, r.quiet_hours_start, r.quiet_hours_end
      )
    FROM due_rules r
    JOIN public.orders_v2 d
      ON d.pipeline_id = r.pipeline_id
      AND d.pipeline_stage_id = r.stage_id
      AND NOT d.is_deleted
    ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING
    RETURNING rule_id
  ), fired AS (
    UPDATE public.crm_pipeline_automation_rules r
    SET scheduled_fired_at = now()
    FROM due_rules due
    WHERE r.id = due.id
    RETURNING r.id
  )
  SELECT count(*) INTO _fired_count FROM fired;

  RETURN _fired_count;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_due_schedules_v10()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_enqueue_due_schedules_v10()
  TO service_role;

COMMENT ON COLUMN public.crm_pipeline_automation_rules.scheduled_local_at IS
  'One-off local timestamp for trigger_type=at_datetime; interpreted in timezone.';
COMMENT ON COLUMN public.crm_pipeline_automation_rules.scheduled_fired_at IS
  'Worker consumption marker for the one-off date/time trigger.';

COMMIT;
