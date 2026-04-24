-- RPC для INV-P0-4: чтение cron.job_run_details из system-health-full-check
-- SECURITY DEFINER, потому что cron schema недоступен анонимному/service role напрямую через PostgREST
CREATE OR REPLACE FUNCTION public.get_cron_runs_24h_count()
RETURNS TABLE(succ_runs_24h bigint, failed_runs_24h bigint, total_runs_24h bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::bigint AS succ_runs_24h,
    COUNT(*) FILTER (WHERE status = 'failed')::bigint    AS failed_runs_24h,
    COUNT(*)::bigint                                      AS total_runs_24h
  FROM cron.job_run_details
  WHERE start_time >= NOW() - INTERVAL '24 hours';
$$;

REVOKE ALL ON FUNCTION public.get_cron_runs_24h_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_runs_24h_count() TO service_role;

COMMENT ON FUNCTION public.get_cron_runs_24h_count() IS
'Read-only counter of pg_cron job runs in last 24h for INV-P0-4 invariant in system-health-full-check edge function. SECURITY DEFINER required because cron schema is not exposed to PostgREST roles. Service-role only.';