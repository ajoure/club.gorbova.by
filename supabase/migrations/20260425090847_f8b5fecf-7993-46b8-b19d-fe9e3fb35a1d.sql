CREATE OR REPLACE FUNCTION public.diag_broadcast_cron_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $$
DECLARE
  jobs jsonb;
  recent jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'jobid', jobid, 'jobname', jobname, 'schedule', schedule, 'active', active, 'command', command
  )) INTO jobs
  FROM cron.job
  WHERE jobname ILIKE '%broadcast%' OR command ILIKE '%process-scheduled-broadcasts%';

  SELECT jsonb_agg(jsonb_build_object(
    'jobid', jobid, 'runid', runid, 'status', status, 'return_message', return_message,
    'start_time', start_time, 'end_time', end_time
  ) ORDER BY start_time DESC) INTO recent
  FROM (
    SELECT * FROM cron.job_run_details
    WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname ILIKE '%broadcast%' OR command ILIKE '%process-scheduled-broadcasts%')
    ORDER BY start_time DESC LIMIT 20
  ) sub;

  RETURN jsonb_build_object('jobs', COALESCE(jobs, '[]'::jsonb), 'recent_runs', COALESCE(recent, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.diag_broadcast_cron_state() TO authenticated, service_role;