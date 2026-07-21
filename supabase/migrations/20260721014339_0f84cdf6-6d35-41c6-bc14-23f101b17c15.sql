CREATE OR REPLACE FUNCTION public.crm_company_sync_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status_counts jsonb;
  v_oldest_pending timestamptz;
  v_stuck int;
  v_dl int;
  v_last_dl timestamptz;
  v_fail int;
  v_attempts int;
  v_recent jsonb;
  v_total int;
  v_window_hours int := 24;
  v_completed_count int := 0;
  v_avg_ms numeric;
  v_p95_ms numeric;
  v_terminal_count int := 0;
  v_terminal_failed int := 0;
  v_failure_rate numeric;
  v_alert_oldest_pending boolean := false;
  v_alert_failure_rate boolean := false;
  v_oldest_pending_age_seconds numeric;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(jsonb_object_agg(status, c), '{}'::jsonb), coalesce(sum(c)::int, 0)
    INTO v_status_counts, v_total
    FROM (SELECT status, count(*)::int c FROM public.company_sync_queue GROUP BY status) s;

  SELECT min(next_run_at) INTO v_oldest_pending
    FROM public.company_sync_queue WHERE status='queued';

  SELECT count(*)::int INTO v_stuck
    FROM public.company_sync_queue WHERE status='running' AND next_run_at < now();

  SELECT count(*)::int, max(updated_at) INTO v_dl, v_last_dl
    FROM public.company_sync_queue WHERE status='dead_letter';

  SELECT count(*)::int INTO v_fail
    FROM public.company_sync_queue WHERE status IN ('failed','dead_letter');

  SELECT coalesce(sum(attempts)::int, 0) INTO v_attempts
    FROM public.company_sync_queue;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_recent
    FROM (
      SELECT jsonb_build_object(
               'id', id, 'entity_id', entity_id, 'status', status,
               'attempts', attempts, 'updated_at', updated_at,
               'last_error', left(coalesce(last_error,''), 300)
             ) AS x
        FROM public.company_sync_queue
       WHERE status IN ('failed','dead_letter')
       ORDER BY updated_at DESC
       LIMIT 5
    ) r;

  -- Processing metrics: completed jobs within window_hours
  SELECT
    count(*)::int,
    avg(extract(epoch FROM (updated_at - first_attempted_at)) * 1000.0),
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY extract(epoch FROM (updated_at - first_attempted_at)) * 1000.0
    )
  INTO v_completed_count, v_avg_ms, v_p95_ms
  FROM public.company_sync_queue
  WHERE status = 'done'
    AND first_attempted_at IS NOT NULL
    AND updated_at >= now() - make_interval(hours => v_window_hours);

  -- Alerts
  IF v_oldest_pending IS NOT NULL THEN
    v_oldest_pending_age_seconds := extract(epoch FROM (now() - v_oldest_pending));
    IF v_oldest_pending_age_seconds > 15 * 60 THEN
      v_alert_oldest_pending := true;
    END IF;
  END IF;

  SELECT count(*)::int,
         count(*) FILTER (WHERE status IN ('failed','dead_letter'))::int
    INTO v_terminal_count, v_terminal_failed
    FROM public.company_sync_queue
   WHERE status IN ('done','failed','dead_letter');

  IF v_terminal_count >= 5 THEN
    v_failure_rate := v_terminal_failed::numeric / v_terminal_count::numeric;
    IF v_failure_rate > 0.20 THEN
      v_alert_failure_rate := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'baseline', jsonb_build_object(
      'companies', (SELECT count(*) FROM public.companies),
      'maps', (SELECT count(*) FROM public.client_legal_details_company_map),
      'billing_contacts', (SELECT count(*) FROM public.company_contacts WHERE is_billing_contact=true),
      'seq_company', (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company')
    ),
    'queue', jsonb_build_object(
      'total', v_total,
      'by_status', v_status_counts,
      'oldest_pending_next_run', v_oldest_pending,
      'stuck_running', v_stuck,
      'dead_letter_count', v_dl,
      'last_dead_letter_at', v_last_dl,
      'failure_count', v_fail,
      'total_attempts', v_attempts
    ),
    'processing', jsonb_build_object(
      'window_hours', v_window_hours,
      'completed_count', v_completed_count,
      'avg_ms', v_avg_ms,
      'p95_ms', v_p95_ms
    ),
    'alerts', jsonb_build_object(
      'oldest_pending', jsonb_build_object(
        'threshold_minutes', 15,
        'triggered', v_alert_oldest_pending,
        'oldest_pending_next_run', v_oldest_pending,
        'age_seconds', v_oldest_pending_age_seconds
      ),
      'failure_rate', jsonb_build_object(
        'threshold', 0.20,
        'min_terminal_rows', 5,
        'triggered', v_alert_failure_rate,
        'terminal_count', v_terminal_count,
        'failed_count', v_terminal_failed,
        'rate', v_failure_rate
      )
    ),
    'recent_failures', v_recent
  );
END
$function$;

REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_health() TO service_role;