-- Phase 4C observability: processing-time statistics and explicit alert flags.
-- The queue health RPC remains service-only; this extends its JSON contract
-- without exposing queue rows or payloads to browser roles.

CREATE OR REPLACE FUNCTION public.crm_company_sync_health()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $fn$
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
  v_completed_count int;
  v_processing_avg_ms numeric;
  v_processing_p95_ms numeric;
  v_terminal_count int;
  v_recent_failure_count int;
  v_failure_rate numeric;
  v_oldest_alert boolean;
  v_failure_alert boolean;
  v_window_hours constant int := 24;
  v_oldest_threshold_seconds constant int := 900;
  v_failure_threshold numeric := 0.20;
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

  SELECT count(*)::int,
         round(coalesce(avg(extract(epoch FROM (updated_at - first_attempted_at)) * 1000), 0)::numeric, 1),
         round(coalesce(percentile_cont(0.95) WITHIN GROUP (
           ORDER BY extract(epoch FROM (updated_at - first_attempted_at)) * 1000
         ), 0)::numeric, 1)
    INTO v_completed_count, v_processing_avg_ms, v_processing_p95_ms
    FROM public.company_sync_queue
   WHERE status IN ('done','failed','dead_letter','skipped')
     AND first_attempted_at IS NOT NULL
     AND updated_at >= now() - make_interval(hours => v_window_hours);

  SELECT count(*)::int,
         count(*) FILTER (WHERE status IN ('failed','dead_letter'))::int
    INTO v_terminal_count, v_recent_failure_count
    FROM public.company_sync_queue
   WHERE status IN ('done','failed','dead_letter','skipped')
     AND updated_at >= now() - make_interval(hours => v_window_hours);

  v_failure_rate := CASE WHEN v_terminal_count = 0 THEN 0
    ELSE round(v_recent_failure_count::numeric / v_terminal_count::numeric, 4) END;
  v_oldest_alert := v_oldest_pending IS NOT NULL
    AND v_oldest_pending < now() - make_interval(secs => v_oldest_threshold_seconds);
  v_failure_alert := v_terminal_count >= 5 AND v_failure_rate >= v_failure_threshold;

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
      'avg_ms', v_processing_avg_ms,
      'p95_ms', v_processing_p95_ms
    ),
    'alerts', jsonb_build_object(
      'oldest_pending', v_oldest_alert,
      'failure_rate', v_failure_alert,
      'failure_rate_value', v_failure_rate,
      'oldest_pending_threshold_seconds', v_oldest_threshold_seconds,
      'failure_rate_threshold', v_failure_threshold,
      'evaluated_window_hours', v_window_hours
    ),
    'recent_failures', v_recent
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_health() TO service_role;

