-- Never-applied v1 was rejected by the managed capability. This correction
-- changes only the cadence of an existing opaque request configuration.
-- Deploy/attest the v2 daily-gated handler BEFORE applying this migration.
DO $health_schedule$
DECLARE daily_job record; hourly_job record;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN
    ('system-health-full-check-daily','nightly-system-health-hourly')) <> 2
  THEN RAISE EXCEPTION 'health_cron_expected_two_jobs'; END IF;
  SELECT jobid,jobname,schedule,active INTO daily_job FROM cron.job
    WHERE jobname='system-health-full-check-daily';
  SELECT jobid,jobname,schedule,active INTO hourly_job FROM cron.job
    WHERE jobname='nightly-system-health-hourly';
  IF daily_job.jobid IS DISTINCT FROM 29 OR daily_job.active IS DISTINCT FROM true
    OR daily_job.schedule IS NULL OR daily_job.schedule NOT IN ('0 5 * * *','* * * * *')
    OR hourly_job.jobid IS DISTINCT FROM 28 OR hourly_job.active IS DISTINCT FROM true
    OR hourly_job.schedule IS DISTINCT FROM '0 * * * *'
    OR EXISTS(SELECT 1 FROM cron.job WHERE jobname='system-health-full-check-continuation')
  THEN RAISE EXCEPTION 'health_cron_baseline_changed'; END IF;
  IF daily_job.schedule='0 5 * * *' THEN
    PERFORM cron.alter_job(daily_job.jobid,schedule:='* * * * *');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=29 AND jobname='system-health-full-check-daily'
    AND active AND schedule='* * * * *')
    OR NOT EXISTS(SELECT 1 FROM cron.job WHERE jobid=28 AND jobname='nightly-system-health-hourly'
      AND active AND schedule='0 * * * *')
  THEN RAISE EXCEPTION 'health_cron_schedule_readback_failed'; END IF;
END $health_schedule$;
