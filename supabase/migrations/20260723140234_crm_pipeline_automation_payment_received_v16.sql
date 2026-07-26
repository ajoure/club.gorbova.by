BEGIN;

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

COMMENT ON CONSTRAINT crm_pipeline_automation_trigger_config_v16_chk
  ON public.crm_pipeline_automation_rules IS
  'payment_received fires only once per active, non-refund payments_v2 row after it reaches succeeded.';

COMMIT;
