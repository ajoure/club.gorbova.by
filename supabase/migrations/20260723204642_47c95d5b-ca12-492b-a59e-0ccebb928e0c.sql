-- === 20260723094605_crm_pipeline_automation_delay_journal_v2.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN delay_minutes integer NOT NULL DEFAULT 0
    CHECK (delay_minutes BETWEEN 0 AND 525600),
  ADD COLUMN require_same_stage boolean NOT NULL DEFAULT true;

ALTER TABLE public.crm_pipeline_automation_jobs
  DROP CONSTRAINT crm_pipeline_automation_jobs_status_check,
  ADD CONSTRAINT crm_pipeline_automation_jobs_status_check
    CHECK (status IN ('pending','running','succeeded','skipped','failed','dead'));

CREATE INDEX crm_pipeline_automation_jobs_rule_created_idx
  ON public.crm_pipeline_automation_jobs(rule_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

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

  IF NEW.is_deleted OR NEW.pipeline_stage_id IS NULL THEN
    RETURN NEW;
  END IF;
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
    now() + make_interval(mins => r.delay_minutes)
  FROM public.crm_pipeline_automation_rules r
  WHERE r.stage_id = NEW.pipeline_stage_id
    AND r.pipeline_id = NEW.pipeline_id
    AND r.status = 'active'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_skip_job(
  _job_id uuid,
  _reason text,
  _result jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.crm_pipeline_automation_jobs
  SET status = 'skipped',
      result = coalesce(_result, '{}'::jsonb) || jsonb_build_object('skip_reason', _reason),
      last_error = NULL,
      finished_at = now(),
      locked_at = NULL,
      locked_by = NULL
  WHERE id = _job_id AND status = 'running';
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_skip_job(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_skip_job(uuid, text, jsonb)
  TO service_role;

-- === 20260723101002_crm_pipeline_automation_schedule_retry_v3.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Warsaw',
  ADD COLUMN quiet_hours_start time,
  ADD COLUMN quiet_hours_end time,
  ADD CONSTRAINT crm_pipeline_automation_quiet_hours_pair_chk CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
    OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_next_available_at(
  _base timestamptz,
  _delay_minutes integer,
  _timezone text,
  _quiet_start time,
  _quiet_end time
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  _candidate timestamptz := _base + make_interval(mins => _delay_minutes);
  _local timestamp;
  _local_time time;
  _resume_local timestamp;
BEGIN
  IF _quiet_start IS NULL OR _quiet_end IS NULL OR _quiet_start = _quiet_end THEN
    RETURN _candidate;
  END IF;

  _local := _candidate AT TIME ZONE _timezone;
  _local_time := _local::time;

  IF _quiet_start < _quiet_end THEN
    IF _local_time >= _quiet_start AND _local_time < _quiet_end THEN
      _resume_local := _local::date + _quiet_end;
      RETURN _resume_local AT TIME ZONE _timezone;
    END IF;
  ELSE
    IF _local_time >= _quiet_start THEN
      _resume_local := (_local::date + 1) + _quiet_end;
      RETURN _resume_local AT TIME ZONE _timezone;
    ELSIF _local_time < _quiet_end THEN
      _resume_local := _local::date + _quiet_end;
      RETURN _resume_local AT TIME ZONE _timezone;
    END IF;
  END IF;

  RETURN _candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_next_available_at(
  timestamptz, integer, text, time, time
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'automation_timezone_invalid' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end, NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end, OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

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
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_retry_job(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := (select auth.uid());
BEGIN
  IF _uid IS NULL OR NOT (
    public.has_role_v2(_uid, 'admin')
    OR public.has_role_v2(_uid, 'super_admin')
  ) THEN
    RAISE EXCEPTION 'forbidden_admin_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.crm_pipeline_automation_jobs
  SET status = 'pending',
      attempt_count = 0,
      available_at = now(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      finished_at = NULL,
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'manual_retry_at', now(),
        'manual_retry_by', _uid
      )
  WHERE id = _job_id AND status IN ('failed','dead');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_job_not_retryable' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_retry_job(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_retry_job(uuid)
  TO authenticated;

-- === 20260723102144_crm_pipeline_automation_email_action_v4.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_rules_action_type_check,
  ALTER COLUMN task_type_id DROP NOT NULL,
  ALTER COLUMN title_template DROP NOT NULL,
  ADD COLUMN email_template_id uuid REFERENCES public.email_templates(id) ON DELETE RESTRICT,
  ADD COLUMN email_account_id uuid REFERENCES public.email_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN email_subject_template text,
  ADD COLUMN email_html_template text,
  ADD COLUMN email_text_template text,
  ADD COLUMN recipient_strategy text NOT NULL DEFAULT 'customer_email'
    CHECK (recipient_strategy IN ('customer_email')),
  ADD CONSTRAINT crm_pipeline_automation_rules_action_type_check
    CHECK (action_type IN ('create_task','send_email')),
  ADD CONSTRAINT crm_pipeline_automation_action_config_chk CHECK (
    (
      action_type = 'create_task'
      AND task_type_id IS NOT NULL
      AND title_template IS NOT NULL
      AND length(btrim(title_template)) BETWEEN 1 AND 240
      AND email_template_id IS NULL
      AND email_subject_template IS NULL
      AND email_html_template IS NULL
    )
    OR
    (
      action_type = 'send_email'
      AND task_type_id IS NULL
      AND title_template IS NULL
      AND email_template_id IS NOT NULL
      AND email_subject_template IS NOT NULL
      AND length(btrim(email_subject_template)) BETWEEN 1 AND 500
      AND email_html_template IS NOT NULL
      AND length(btrim(email_html_template)) BETWEEN 1 AND 200000
    )
  );

CREATE UNIQUE INDEX email_logs_automation_idempotency_idx
  ON public.email_logs ((meta->>'automation_idempotency_key'))
  WHERE meta->>'automation_idempotency_key' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'automation_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_email_template_not_active' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end,
      NEW.email_template_id, NEW.email_account_id, NEW.email_subject_template,
      NEW.email_html_template, NEW.email_text_template, NEW.recipient_strategy,
      NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end,
      OLD.email_template_id, OLD.email_account_id, OLD.email_subject_template,
      OLD.email_html_template, OLD.email_text_template, OLD.recipient_strategy,
      OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

-- === 20260723103331_crm_pipeline_automation_telegram_action_v5.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_rules_action_type_check,
  DROP CONSTRAINT crm_pipeline_automation_action_config_chk,
  ADD COLUMN telegram_message_template text,
  ADD CONSTRAINT crm_pipeline_automation_rules_action_type_check
    CHECK (action_type IN ('create_task','send_email','send_telegram')),
  ADD CONSTRAINT crm_pipeline_automation_action_config_chk CHECK (
    (
      action_type = 'create_task'
      AND task_type_id IS NOT NULL
      AND title_template IS NOT NULL
      AND length(btrim(title_template)) BETWEEN 1 AND 240
      AND email_template_id IS NULL
      AND email_subject_template IS NULL
      AND email_html_template IS NULL
      AND telegram_message_template IS NULL
    )
    OR
    (
      action_type = 'send_email'
      AND task_type_id IS NULL
      AND title_template IS NULL
      AND email_template_id IS NOT NULL
      AND email_subject_template IS NOT NULL
      AND length(btrim(email_subject_template)) BETWEEN 1 AND 500
      AND email_html_template IS NOT NULL
      AND length(btrim(email_html_template)) BETWEEN 1 AND 200000
      AND telegram_message_template IS NULL
    )
    OR
    (
      action_type = 'send_telegram'
      AND task_type_id IS NULL
      AND title_template IS NULL
      AND email_template_id IS NULL
      AND email_subject_template IS NULL
      AND email_html_template IS NULL
      AND telegram_message_template IS NOT NULL
      AND length(btrim(telegram_message_template)) BETWEEN 1 AND 4096
    )
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'automation_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_email_template_not_active' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end,
      NEW.email_template_id, NEW.email_account_id, NEW.email_subject_template,
      NEW.email_html_template, NEW.email_text_template, NEW.recipient_strategy,
      NEW.telegram_message_template, NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end,
      OLD.email_template_id, OLD.email_account_id, OLD.email_subject_template,
      OLD.email_html_template, OLD.email_text_template, OLD.recipient_strategy,
      OLD.telegram_message_template, OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

-- === 20260723105137_crm_pipeline_automation_channel_fallback_v6.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN fallback_action_type text,
  ADD COLUMN fallback_email_template_id uuid REFERENCES public.email_templates(id) ON DELETE RESTRICT,
  ADD COLUMN fallback_email_account_id uuid REFERENCES public.email_accounts(id) ON DELETE RESTRICT,
  ADD COLUMN fallback_email_subject_template text,
  ADD COLUMN fallback_email_html_template text,
  ADD COLUMN fallback_email_text_template text,
  ADD COLUMN fallback_telegram_message_template text,
  ADD CONSTRAINT crm_pipeline_automation_fallback_action_type_chk CHECK (
    fallback_action_type IS NULL
    OR (
      action_type IN ('send_email','send_telegram')
      AND fallback_action_type IN ('send_email','send_telegram')
      AND fallback_action_type <> action_type
    )
  ),
  ADD CONSTRAINT crm_pipeline_automation_fallback_config_chk CHECK (
    (
      fallback_action_type IS NULL
      AND fallback_email_template_id IS NULL
      AND fallback_email_account_id IS NULL
      AND fallback_email_subject_template IS NULL
      AND fallback_email_html_template IS NULL
      AND fallback_email_text_template IS NULL
      AND fallback_telegram_message_template IS NULL
    )
    OR
    (
      fallback_action_type = 'send_email'
      AND fallback_email_template_id IS NOT NULL
      AND fallback_email_subject_template IS NOT NULL
      AND length(btrim(fallback_email_subject_template)) BETWEEN 1 AND 500
      AND fallback_email_html_template IS NOT NULL
      AND length(btrim(fallback_email_html_template)) BETWEEN 1 AND 200000
      AND fallback_telegram_message_template IS NULL
    )
    OR
    (
      fallback_action_type = 'send_telegram'
      AND fallback_email_template_id IS NULL
      AND fallback_email_account_id IS NULL
      AND fallback_email_subject_template IS NULL
      AND fallback_email_html_template IS NULL
      AND fallback_email_text_template IS NULL
      AND fallback_telegram_message_template IS NOT NULL
      AND length(btrim(fallback_telegram_message_template)) BETWEEN 1 AND 4096
    )
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'automation_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_email_template_not_active' USING ERRCODE = '22023';
  END IF;
  IF NEW.fallback_action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.fallback_email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_fallback_email_template_not_active'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end,
      NEW.email_template_id, NEW.email_account_id, NEW.email_subject_template,
      NEW.email_html_template, NEW.email_text_template, NEW.recipient_strategy,
      NEW.telegram_message_template, NEW.fallback_action_type,
      NEW.fallback_email_template_id, NEW.fallback_email_account_id,
      NEW.fallback_email_subject_template, NEW.fallback_email_html_template,
      NEW.fallback_email_text_template, NEW.fallback_telegram_message_template,
      NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end,
      OLD.email_template_id, OLD.email_account_id, OLD.email_subject_template,
      OLD.email_html_template, OLD.email_text_template, OLD.recipient_strategy,
      OLD.telegram_message_template, OLD.fallback_action_type,
      OLD.fallback_email_template_id, OLD.fallback_email_account_id,
      OLD.fallback_email_subject_template, OLD.fallback_email_html_template,
      OLD.fallback_email_text_template, OLD.fallback_telegram_message_template,
      OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

-- === 20260723110257_crm_pipeline_automation_conditions_v7.sql ===

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_conditions_valid(_conditions jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  _item jsonb;
  _operator text;
  _field text;
  _key_count integer;
BEGIN
  IF _conditions = '{}'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(_conditions) <> 'object' THEN RETURN false; END IF;
  SELECT count(*) INTO _key_count FROM jsonb_object_keys(_conditions);
  IF _key_count > 2
    OR (_conditions->>'logic') NOT IN ('and','or')
    OR jsonb_typeof(_conditions->'items') <> 'array'
    OR jsonb_array_length(_conditions->'items') NOT BETWEEN 1 AND 10
  THEN
    RETURN false;
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_conditions->'items')
  LOOP
    IF jsonb_typeof(_item) <> 'object' THEN RETURN false; END IF;
    SELECT count(*) INTO _key_count FROM jsonb_object_keys(_item);
    IF _key_count > 4 THEN RETURN false; END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(_item) AS keys(key)
      WHERE key NOT IN ('field','operator','value','not')
    ) THEN
      RETURN false;
    END IF;

    _field := _item->>'field';
    _operator := _item->>'operator';
    IF _field NOT IN (
      'status','currency','is_trial','product_id','tariff_id',
      'responsible_user_id','customer_email','paid_amount','final_price'
    ) OR _operator NOT IN (
      'eq','neq','contains','not_contains','is_empty','is_not_empty',
      'gt','gte','lt','lte'
    ) THEN
      RETURN false;
    END IF;
    IF _item ? 'not' AND jsonb_typeof(_item->'not') <> 'boolean' THEN RETURN false; END IF;
    IF _operator NOT IN ('is_empty','is_not_empty') AND NOT (_item ? 'value') THEN
      RETURN false;
    END IF;
    IF _item ? 'value'
      AND jsonb_typeof(_item->'value') NOT IN ('string','number','boolean','null')
    THEN
      RETURN false;
    END IF;
    IF _operator IN ('contains','not_contains')
      AND _field NOT IN ('status','currency','customer_email')
    THEN
      RETURN false;
    END IF;
    IF _operator IN ('gt','gte','lt','lte') THEN
      IF _field NOT IN ('paid_amount','final_price')
        OR jsonb_typeof(_item->'value') <> 'number'
      THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_conditions_valid(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_pipeline_automation_conditions_valid(jsonb)
  TO authenticated, service_role;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD CONSTRAINT crm_pipeline_automation_conditions_shape_chk
  CHECK (public.crm_pipeline_automation_conditions_valid(conditions));

COMMENT ON COLUMN public.crm_pipeline_automation_rules.conditions IS
  'Validated v1 condition group: {logic: and|or, items: [{field, operator, value?, not?}]}; max 10 predicates.';

-- === 20260723112927_crm_pipeline_automation_no_branch_v8.sql ===

ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS pipeline_automation_rule_id uuid
    REFERENCES public.crm_pipeline_automation_rules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_tasks_pipeline_automation_rule_deal_uniq
  ON public.crm_tasks (pipeline_automation_rule_id, deal_id)
  WHERE pipeline_automation_rule_id IS NOT NULL AND deal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_task_create(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _type_key text;
  _type_id uuid;
  _type_row public.crm_task_types%ROWTYPE;
  _title text;
  _due_at timestamptz;
  _remind_at timestamptz;
  _source text;
  _new_id uuid;
  _company_id uuid;
  _company public.companies%ROWTYPE;
BEGIN
  PERFORM public._crm_tasks_assert_staff();
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid_payload' USING ERRCODE='22023';
  END IF;
  _title := nullif(trim(payload->>'title'),'');
  IF _title IS NULL THEN RAISE EXCEPTION 'title_required' USING ERRCODE='22023'; END IF;
  IF payload ? 'task_type_id' AND nullif(payload->>'task_type_id','') IS NOT NULL THEN
    _type_id := (payload->>'task_type_id')::uuid;
    SELECT * INTO _type_row FROM public.crm_task_types WHERE id=_type_id;
  ELSIF payload ? 'task_type' AND nullif(payload->>'task_type','') IS NOT NULL THEN
    _type_key := payload->>'task_type';
    SELECT * INTO _type_row FROM public.crm_task_types WHERE key=_type_key AND is_active=true;
  ELSE
    RAISE EXCEPTION 'task_type_required' USING ERRCODE='22023';
  END IF;
  IF _type_row.id IS NULL THEN RAISE EXCEPTION 'task_type_not_found' USING ERRCODE='22023'; END IF;
  _company_id := nullif(payload->>'company_id','')::uuid;
  IF _company_id IS NOT NULL THEN
    SELECT * INTO _company FROM public.companies WHERE id=_company_id;
    IF _company.id IS NULL OR _company.status <> 'active' THEN
      RAISE EXCEPTION 'company_not_active' USING ERRCODE='22023';
    END IF;
  END IF;
  IF payload ? 'due_at' AND nullif(payload->>'due_at','') IS NOT NULL THEN
    _due_at := (payload->>'due_at')::timestamptz;
  ELSIF _type_row.default_due_offset_minutes IS NOT NULL THEN
    _due_at := now() + make_interval(mins => _type_row.default_due_offset_minutes);
  END IF;
  IF payload ? 'remind_at' AND nullif(payload->>'remind_at','') IS NOT NULL THEN
    _remind_at := (payload->>'remind_at')::timestamptz;
  ELSIF _due_at IS NOT NULL AND _type_row.default_reminder_offset_minutes IS NOT NULL THEN
    _remind_at := _due_at - make_interval(mins => _type_row.default_reminder_offset_minutes);
  END IF;
  _source := coalesce(nullif(payload->>'source',''),'manual');
  IF _source NOT IN ('manual','auto','system') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;

  INSERT INTO public.crm_tasks(
    task_type_id,title,description,contact_id,company_id,deal_id,order_id,
    pipeline_id,pipeline_stage_id,offer_id,product_id,tariff_id,assignee_user_id,
    due_at,remind_at,status,source,automation_rule_id,pipeline_automation_rule_id,
    created_by,updated_by,meta
  ) VALUES (
    _type_row.id,_title,nullif(payload->>'description',''),
    nullif(payload->>'contact_id','')::uuid,_company_id,
    nullif(payload->>'deal_id','')::uuid,nullif(payload->>'order_id','')::uuid,
    nullif(payload->>'pipeline_id','')::uuid,nullif(payload->>'pipeline_stage_id','')::uuid,
    nullif(payload->>'offer_id','')::uuid,nullif(payload->>'product_id','')::uuid,
    nullif(payload->>'tariff_id','')::uuid,nullif(payload->>'assignee_user_id','')::uuid,
    _due_at,_remind_at,coalesce(nullif(payload->>'status',''),'open'),_source,
    nullif(payload->>'automation_rule_id','')::uuid,
    nullif(payload->>'pipeline_automation_rule_id','')::uuid,
    _uid,_uid,coalesce(payload->'meta','{}'::jsonb)
  ) RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN no_branch_task_type_id uuid REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  ADD COLUMN no_branch_title_template text,
  ADD COLUMN no_branch_description_template text,
  ADD COLUMN no_branch_assignee_strategy text,
  ADD COLUMN no_branch_assignee_user_id uuid,
  ADD COLUMN no_branch_due_offset_minutes integer,
  ADD CONSTRAINT crm_pipeline_automation_no_branch_config_chk CHECK (
    (
      no_branch_task_type_id IS NULL
      AND no_branch_title_template IS NULL
      AND no_branch_description_template IS NULL
      AND no_branch_assignee_strategy IS NULL
      AND no_branch_assignee_user_id IS NULL
      AND no_branch_due_offset_minutes IS NULL
    ) OR (
      no_branch_task_type_id IS NOT NULL
      AND length(btrim(no_branch_title_template)) BETWEEN 1 AND 240
      AND no_branch_assignee_strategy IN ('deal_owner','fixed_user')
      AND (no_branch_assignee_strategy <> 'fixed_user' OR no_branch_assignee_user_id IS NOT NULL)
      AND no_branch_due_offset_minutes BETWEEN 0 AND 525600
    )
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_pipeline_stages s
    WHERE s.id = NEW.stage_id AND s.pipeline_id = NEW.pipeline_id
  ) THEN
    RAISE EXCEPTION 'automation_stage_not_in_pipeline' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'automation_timezone_invalid' USING ERRCODE = '22023';
  END IF;
  IF NEW.action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_email_template_not_active' USING ERRCODE = '22023';
  END IF;
  IF NEW.fallback_action_type = 'send_email' AND NOT EXISTS (
    SELECT 1 FROM public.email_templates t
    WHERE t.id = NEW.fallback_email_template_id AND t.is_active = true
  ) THEN
    RAISE EXCEPTION 'automation_fallback_email_template_not_active' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived') THEN
    IF ROW(
      NEW.pipeline_id, NEW.stage_id, NEW.trigger_type, NEW.action_type,
      NEW.task_type_id, NEW.title_template, NEW.description_template,
      NEW.assignee_strategy, NEW.assignee_user_id, NEW.due_offset_minutes,
      NEW.reminder_offset_minutes, NEW.delay_minutes, NEW.require_same_stage,
      NEW.timezone, NEW.quiet_hours_start, NEW.quiet_hours_end,
      NEW.email_template_id, NEW.email_account_id, NEW.email_subject_template,
      NEW.email_html_template, NEW.email_text_template, NEW.recipient_strategy,
      NEW.telegram_message_template, NEW.fallback_action_type,
      NEW.fallback_email_template_id, NEW.fallback_email_account_id,
      NEW.fallback_email_subject_template, NEW.fallback_email_html_template,
      NEW.fallback_email_text_template, NEW.fallback_telegram_message_template,
      NEW.no_branch_task_type_id, NEW.no_branch_title_template,
      NEW.no_branch_description_template, NEW.no_branch_assignee_strategy,
      NEW.no_branch_assignee_user_id, NEW.no_branch_due_offset_minutes,
      NEW.conditions
    ) IS DISTINCT FROM ROW(
      OLD.pipeline_id, OLD.stage_id, OLD.trigger_type, OLD.action_type,
      OLD.task_type_id, OLD.title_template, OLD.description_template,
      OLD.assignee_strategy, OLD.assignee_user_id, OLD.due_offset_minutes,
      OLD.reminder_offset_minutes, OLD.delay_minutes, OLD.require_same_stage,
      OLD.timezone, OLD.quiet_hours_start, OLD.quiet_hours_end,
      OLD.email_template_id, OLD.email_account_id, OLD.email_subject_template,
      OLD.email_html_template, OLD.email_text_template, OLD.recipient_strategy,
      OLD.telegram_message_template, OLD.fallback_action_type,
      OLD.fallback_email_template_id, OLD.fallback_email_account_id,
      OLD.fallback_email_subject_template, OLD.fallback_email_html_template,
      OLD.fallback_email_text_template, OLD.fallback_telegram_message_template,
      OLD.no_branch_task_type_id, OLD.no_branch_title_template,
      OLD.no_branch_description_template, OLD.no_branch_assignee_strategy,
      OLD.no_branch_assignee_user_id, OLD.no_branch_due_offset_minutes,
      OLD.conditions
    ) THEN
      RAISE EXCEPTION 'published_automation_version_is_immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  IF NEW.status = 'active' AND NEW.published_at IS NULL THEN NEW.published_at := now(); END IF;
  NEW.updated_by := (select auth.uid());
  RETURN NEW;
END;
$$;

-- === 20260723114145_crm_pipeline_automation_error_branch_v9.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  ADD COLUMN error_branch_task_type_id uuid REFERENCES public.crm_task_types(id) ON DELETE RESTRICT,
  ADD COLUMN error_branch_title_template text,
  ADD COLUMN error_branch_description_template text,
  ADD COLUMN error_branch_assignee_strategy text,
  ADD COLUMN error_branch_assignee_user_id uuid,
  ADD COLUMN error_branch_due_offset_minutes integer,
  ADD CONSTRAINT crm_pipeline_automation_error_branch_config_chk CHECK (
    (
      error_branch_task_type_id IS NULL
      AND error_branch_title_template IS NULL
      AND error_branch_description_template IS NULL
      AND error_branch_assignee_strategy IS NULL
      AND error_branch_assignee_user_id IS NULL
      AND error_branch_due_offset_minutes IS NULL
    ) OR (
      error_branch_task_type_id IS NOT NULL
      AND length(btrim(error_branch_title_template)) BETWEEN 1 AND 240
      AND error_branch_assignee_strategy IN ('deal_owner','fixed_user')
      AND (error_branch_assignee_strategy <> 'fixed_user' OR error_branch_assignee_user_id IS NOT NULL)
      AND error_branch_due_offset_minutes BETWEEN 0 AND 525600
    )
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_validate_error_branch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IN ('active','paused','archived')
    AND ROW(
      NEW.error_branch_task_type_id, NEW.error_branch_title_template,
      NEW.error_branch_description_template, NEW.error_branch_assignee_strategy,
      NEW.error_branch_assignee_user_id, NEW.error_branch_due_offset_minutes
    ) IS DISTINCT FROM ROW(
      OLD.error_branch_task_type_id, OLD.error_branch_title_template,
      OLD.error_branch_description_template, OLD.error_branch_assignee_strategy,
      OLD.error_branch_assignee_user_id, OLD.error_branch_due_offset_minutes
    )
  THEN
    RAISE EXCEPTION 'published_automation_version_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_pipeline_automation_validate_error_branch
  ON public.crm_pipeline_automation_rules;
CREATE TRIGGER trg_crm_pipeline_automation_validate_error_branch
  BEFORE INSERT OR UPDATE ON public.crm_pipeline_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_validate_error_branch();

-- === 20260723120944_crm_pipeline_automation_at_datetime_v10.sql ===

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

-- === 20260723122623_crm_pipeline_automation_after_event_v11.sql ===

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

-- === 20260723124201_crm_pipeline_automation_weekday_v12.sql ===

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

-- === 20260723132118_crm_pipeline_automation_month_day_v13.sql ===

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

-- === 20260723135618_crm_pipeline_automation_deal_left_stage_v14.sql ===

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

-- === 20260723140021_crm_pipeline_automation_deal_created_v15.sql ===

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

-- === 20260723140234_crm_pipeline_automation_payment_received_v16.sql ===

ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_trigger_type_v15_chk,
  DROP CONSTRAINT crm_pipeline_automation_trigger_config_v15_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v16_chk
    CHECK (trigger_type IN ('deal_entered_stage', 'deal_left_stage', 'deal_created', 'payment_received', 'after_event', 'at_datetime', 'weekday', 'month_day')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v16_chk CHECK (
    (trigger_type IN ('deal_entered_stage', 'deal_created', 'payment_received')
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

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_payment_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  _deal public.orders_v2%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_settings s
    WHERE s.key = 'feature_crm_pipeline_automation_v1'
      AND coalesce((s.value #>> '{}')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.is_deleted
    OR NEW.order_id IS NULL
    OR NEW.status::text <> 'succeeded'
    OR coalesce(NEW.transaction_type::text, 'payment') = 'refund'
    OR (TG_OP = 'UPDATE' AND OLD.status::text = 'succeeded')
  THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _deal
  FROM public.orders_v2 d
  WHERE d.id = NEW.order_id
    AND d.is_deleted = false
    AND d.pipeline_id IS NOT NULL
    AND d.pipeline_stage_id IS NOT NULL;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.crm_pipeline_automation_jobs(
    rule_id, logical_id, rule_version, deal_id, event_key, event_payload, available_at
  )
  SELECT
    r.id, r.logical_id, r.version, _deal.id,
    concat('payment_received:', NEW.id::text),
    jsonb_build_object(
      'event_type', 'payment_received', 'payment_id', NEW.id,
      'payment_provider', NEW.provider, 'payment_amount', NEW.amount,
      'payment_currency', NEW.currency, 'payment_paid_at', NEW.paid_at,
      'order_id', _deal.id, 'pipeline_id', _deal.pipeline_id,
      'pipeline_stage_id', _deal.pipeline_stage_id, 'occurred_at', now(),
      'trigger_type', r.trigger_type
    ),
    public.crm_pipeline_automation_next_available_at(
      now(), r.delay_minutes, r.timezone, r.quiet_hours_start, r.quiet_hours_end
    )
  FROM public.crm_pipeline_automation_rules r
  WHERE r.pipeline_id = _deal.pipeline_id
    AND r.stage_id = _deal.pipeline_stage_id
    AND r.status = 'active'
    AND r.trigger_type = 'payment_received'
  ON CONFLICT (logical_id, rule_version, deal_id, event_key) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_payment_received() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_crm_pipeline_automation_payment_received
  AFTER INSERT OR UPDATE OF status, is_deleted, order_id, transaction_type
  ON public.payments_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_enqueue_payment_received();

-- === 20260723140518_crm_pipeline_automation_deal_field_changed_v17.sql ===

ALTER TABLE public.crm_pipeline_automation_rules ADD COLUMN trigger_field text;
ALTER TABLE public.crm_pipeline_automation_rules
  DROP CONSTRAINT crm_pipeline_automation_trigger_type_v16_chk,
  DROP CONSTRAINT crm_pipeline_automation_trigger_config_v16_chk,
  ADD CONSTRAINT crm_pipeline_automation_trigger_type_v17_chk CHECK (trigger_type IN ('deal_entered_stage','deal_left_stage','deal_created','payment_received','deal_field_changed','after_event','at_datetime','weekday','month_day')),
  ADD CONSTRAINT crm_pipeline_automation_trigger_config_v17_chk CHECK (
    (trigger_type IN ('deal_entered_stage','deal_created','payment_received') AND trigger_field IS NULL AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type='deal_left_stage' AND require_same_stage=false AND trigger_field IS NULL AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type='deal_field_changed' AND trigger_field IN ('status','currency','is_trial','product_id','tariff_id','responsible_user_id','customer_email','paid_amount','final_price') AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type='after_event' AND trigger_field IS NULL AND delay_minutes BETWEEN 1 AND 525600 AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type='at_datetime' AND trigger_field IS NULL AND scheduled_local_at IS NOT NULL AND recurrence_weekdays IS NULL AND recurrence_local_time IS NULL AND recurrence_last_key IS NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type='weekday' AND trigger_field IS NULL AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND cardinality(recurrence_weekdays) BETWEEN 1 AND 7 AND recurrence_weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[] AND recurrence_local_time IS NOT NULL AND recurrence_month_day IS NULL AND recurrence_month_last IS NULL AND recurrence_month_key IS NULL)
    OR (trigger_type='month_day' AND trigger_field IS NULL AND scheduled_local_at IS NULL AND scheduled_fired_at IS NULL AND recurrence_weekdays IS NULL AND recurrence_last_key IS NULL AND recurrence_local_time IS NOT NULL AND ((recurrence_month_day BETWEEN 1 AND 31 AND recurrence_month_last IS NULL) OR (recurrence_month_day IS NULL AND recurrence_month_last=true)))
  );

CREATE OR REPLACE FUNCTION public.crm_pipeline_automation_enqueue_deal_field_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings s WHERE s.key='feature_crm_pipeline_automation_v1' AND coalesce((s.value #>> '{}')::boolean,false))
    OR NEW.is_deleted OR NEW.pipeline_id IS NULL OR NEW.pipeline_stage_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.crm_pipeline_automation_jobs(rule_id,logical_id,rule_version,deal_id,event_key,event_payload,available_at)
  SELECT r.id,r.logical_id,r.version,NEW.id,
    concat('deal_field_changed:',r.trigger_field,':',coalesce(to_jsonb(OLD)->>r.trigger_field,'null'),':',coalesce(to_jsonb(NEW)->>r.trigger_field,'null')),
    jsonb_build_object('event_type','deal_field_changed','field',r.trigger_field,'old_value',to_jsonb(OLD)->r.trigger_field,'new_value',to_jsonb(NEW)->r.trigger_field,'deal_id',NEW.id,'pipeline_id',NEW.pipeline_id,'pipeline_stage_id',NEW.pipeline_stage_id,'occurred_at',now(),'trigger_type',r.trigger_type),
    public.crm_pipeline_automation_next_available_at(now(),r.delay_minutes,r.timezone,r.quiet_hours_start,r.quiet_hours_end)
  FROM public.crm_pipeline_automation_rules r
  WHERE r.pipeline_id=NEW.pipeline_id AND r.stage_id=NEW.pipeline_stage_id AND r.status='active'
    AND r.trigger_type='deal_field_changed'
    AND (to_jsonb(NEW)->r.trigger_field) IS DISTINCT FROM (to_jsonb(OLD)->r.trigger_field)
  ON CONFLICT (logical_id,rule_version,deal_id,event_key) DO NOTHING;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.crm_pipeline_automation_enqueue_deal_field_changed() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_crm_pipeline_automation_deal_field_changed
  AFTER UPDATE OF status,currency,is_trial,product_id,tariff_id,responsible_user_id,customer_email,paid_amount,final_price ON public.orders_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_pipeline_automation_enqueue_deal_field_changed();