-- Dedicated v2 RPC for the production health check. A new function name
-- avoids stale PostgREST schema-cache state around the legacy RPC.
CREATE OR REPLACE FUNCTION public.get_cron_runs_24h_count_v2()
RETURNS TABLE(
  succ_runs_24h bigint,
  failed_runs_24h bigint,
  total_runs_24h bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cron
AS $function$
  SELECT
    COUNT(*) FILTER (WHERE status = 'succeeded')::bigint,
    COUNT(*) FILTER (WHERE status = 'failed')::bigint,
    COUNT(*)::bigint
  FROM cron.job_run_details
  WHERE start_time >= NOW() - INTERVAL '24 hours';
$function$;

REVOKE ALL ON FUNCTION public.get_cron_runs_24h_count_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_runs_24h_count_v2() TO service_role;

COMMENT ON FUNCTION public.get_cron_runs_24h_count_v2() IS
'Service-role-only pg_cron counter for system-health-full-check. No mutation.';

NOTIFY pgrst, 'reload schema';
