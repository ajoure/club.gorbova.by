-- The two existing jobs enqueue HTTP with pg_net's default 5-second timeout.
-- Give the bounded canonical recovery worker time to finish. No business DML,
-- schedule change, secret export, manual execution or new cron job.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $jobs$
DECLARE r record; v_command text;
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN
      ('payments-reconcile-morning', 'payments-reconcile-evening')) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two reconciliation jobs';
  END IF;
  FOR r IN SELECT * FROM cron.job WHERE jobname IN
      ('payments-reconcile-morning', 'payments-reconcile-evening') LOOP
    IF NOT r.active OR r.schedule <> (CASE r.jobname WHEN 'payments-reconcile-morning'
        THEN '0 6 * * *' ELSE '0 18 * * *' END) OR
       r.command NOT LIKE '%https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/payments-reconcile%' OR
       r.command NOT LIKE '%x-payments-reconcile-cron-secret%' OR
       r.command NOT LIKE '%payments_reconcile_cron_secret%' OR
       (SELECT count(*) FROM regexp_matches(r.command, 'net\.http_post\s*\(', 'g')) <> 1 THEN
      RAISE EXCEPTION 'Unexpected reconciliation job configuration';
    END IF;
    IF r.command ~* 'timeout_milliseconds' THEN
      IF r.command !~* 'timeout_milliseconds\s*:=\s*120000\s*\)' OR
         (SELECT count(*) FROM regexp_matches(r.command, 'timeout_milliseconds', 'gi')) <> 1 THEN
        RAISE EXCEPTION 'Unexpected existing reconciliation timeout';
      END IF;
      CONTINUE;
    END IF;
    IF r.command !~* '\)\s*(AS\s+request_id)?\s*;?\s*$' THEN
      RAISE EXCEPTION 'Unrecognized reconciliation HTTP command';
    END IF;
    v_command := regexp_replace(r.command, '(\)\s*(AS\s+request_id)?\s*;?\s*)$',
      ', timeout_milliseconds := 120000\1', 'i');
    PERFORM cron.alter_job(r.jobid, command := v_command);
  END LOOP;
END $jobs$;