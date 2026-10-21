-- Keep the existing credential and its authorization scope unchanged. Move it
-- inside this database from two cron command literals to Vault. Never return,
-- log, hardcode, rotate or export the value; other CRON_SECRET consumers stay
-- untouched. One DO transaction rolls back all changes on any failed guard.
DO $health_schedule$
DECLARE
  j record;
  m text[];
  value_in_job text;
  existing_value text;
  secret_value text;
  secret_count integer;
  job_count integer;
  next_command text;
  expected_command text;
  redacted_command text;
  actual_normalized text;
  expected_normalized text;
  placeholder constant text := '''__EXISTING_HEALTH_SECRET__''';
  lookup_expression constant text := '(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''system_health_cron_secret'')';
  continuation_command constant text := $command$
    SELECT net.http_post(
      url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/system-health-full-check',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='system_health_cron_secret')),
      body := jsonb_build_object('source','cron','mode','continue'),
      timeout_milliseconds := 55000
    )
    FROM (
      SELECT report_json FROM public.system_health_reports
      WHERE source='cron' ORDER BY created_at DESC LIMIT 1
    ) latest
    WHERE latest.report_json->'availability_scan'->>'release' = 'health-bounded-preflight-2026-10-21-v1'
      AND latest.report_json->'availability_scan'->>'complete' = 'false'
      AND (latest.report_json->'availability_scan'->>'started_at')::timestamptz > now()-interval '15 minutes'
      AND coalesce((latest.report_json->'availability_scan'->>'resume_after')::timestamptz,now()) <= now();
  $command$;
BEGIN
  SELECT count(*) INTO job_count FROM cron.job
    WHERE jobname IN ('system-health-full-check-daily','nightly-system-health-hourly');
  IF job_count <> 2 THEN RAISE EXCEPTION 'health_cron_expected_two_jobs'; END IF;
  SELECT count(*),min(decrypted_secret) INTO secret_count,existing_value
    FROM vault.decrypted_secrets WHERE name='system_health_cron_secret';
  IF secret_count > 1 THEN RAISE EXCEPTION 'health_cron_duplicate_vault_name'; END IF;
  secret_value := existing_value;

  -- Validate both jobs and the shared value before making any changes.
  FOR j IN SELECT * FROM cron.job
    WHERE jobname IN ('system-health-full-check-daily','nightly-system-health-hourly')
  LOOP
    IF NOT j.active
      OR (j.jobname='system-health-full-check-daily' AND j.schedule <> '0 5 * * *')
      OR (j.jobname='nightly-system-health-hourly' AND j.schedule <> '0 * * * *')
    THEN RAISE EXCEPTION 'health_cron_baseline_changed'; END IF;
    expected_command := CASE WHEN j.jobname='system-health-full-check-daily' THEN $daily$
      SELECT net.http_post(
        url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/system-health-full-check',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__EXISTING_HEALTH_SECRET__'),
        body := jsonb_build_object('source','cron')
      );
    $daily$ ELSE $hourly$
      SELECT net.http_post(
        url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/nightly-system-health',
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','__EXISTING_HEALTH_SECRET__'),
        body := jsonb_build_object('source','cron-hourly','target_tz','Europe/London','target_hour',3)
      );
    $hourly$ END;
    m := regexp_match(j.command,$regex$('x-cron-secret'[[:space:]]*,[[:space:]]*)('([^']|'')*')$regex$);
    IF m IS NULL THEN
      IF existing_value IS NULL
      THEN RAISE EXCEPTION 'health_cron_secret_source_unrecognized'; END IF;
      redacted_command := j.command;
      expected_command := replace(expected_command,placeholder,lookup_expression);
    ELSE
      value_in_job := replace(substring(m[2] FROM 2 FOR length(m[2])-2),chr(39)||chr(39),chr(39));
      IF length(value_in_job)<16 OR (secret_value IS NOT NULL AND value_in_job IS DISTINCT FROM secret_value)
        OR (length(j.command)-length(replace(j.command,m[2],'')))/length(m[2]) <> 1
      THEN RAISE EXCEPTION 'health_cron_secret_baseline_mismatch'; END IF;
      secret_value := value_in_job;
      redacted_command := replace(j.command,m[2],placeholder);
    END IF;
    -- Tokenize quoted literals as a whole. Ignore only whitespace outside
    -- literals; changed URLs, bodies, header order, comments and extra SQL fail.
    SELECT string_agg(parts[1],'' ORDER BY ordinal) INTO actual_normalized
      FROM regexp_matches(redacted_command,$token$'(?:[^']|'')*'|[^[:space:]]$token$,'g') WITH ORDINALITY t(parts,ordinal);
    SELECT string_agg(parts[1],'' ORDER BY ordinal) INTO expected_normalized
      FROM regexp_matches(expected_command,$token$'(?:[^']|'')*'|[^[:space:]]$token$,'g') WITH ORDINALITY t(parts,ordinal);
    IF actual_normalized IS DISTINCT FROM expected_normalized
    THEN RAISE EXCEPTION 'health_cron_command_template_changed'; END IF;
  END LOOP;
  SELECT count(*) INTO job_count FROM cron.job WHERE jobname='system-health-full-check-continuation';
  IF job_count>1 THEN RAISE EXCEPTION 'health_cron_duplicate_continuation'; END IF;
  IF job_count=1 THEN
    SELECT * INTO j FROM cron.job WHERE jobname='system-health-full-check-continuation';
    SELECT string_agg(parts[1],'' ORDER BY ordinal) INTO actual_normalized
      FROM regexp_matches(j.command,$token$'(?:[^']|'')*'|[^[:space:]]$token$,'g') WITH ORDINALITY t(parts,ordinal);
    SELECT string_agg(parts[1],'' ORDER BY ordinal) INTO expected_normalized
      FROM regexp_matches(continuation_command,$token$'(?:[^']|'')*'|[^[:space:]]$token$,'g') WITH ORDINALITY t(parts,ordinal);
    IF j.schedule <> '* * * * *' OR NOT j.active OR actual_normalized IS DISTINCT FROM expected_normalized
    THEN RAISE EXCEPTION 'health_cron_existing_continuation_changed'; END IF;
  END IF;
  IF secret_value IS NULL THEN RAISE EXCEPTION 'health_cron_secret_missing'; END IF;
  IF existing_value IS NULL THEN
    PERFORM vault.create_secret(secret_value,'system_health_cron_secret','Existing health cron credential; moved from job commands without rotation.');
  END IF;
  FOR j IN SELECT * FROM cron.job
    WHERE jobname IN ('system-health-full-check-daily','nightly-system-health-hourly')
  LOOP
    m := regexp_match(j.command,$regex$('x-cron-secret'[[:space:]]*,[[:space:]]*)('([^']|'')*')$regex$);
    IF m IS NOT NULL THEN
      next_command := replace(j.command,m[2],lookup_expression);
      PERFORM cron.alter_job(j.jobid,command:=next_command);
    END IF;
  END LOOP;
  -- Same named job is updated on replay; no duplicate schedules.
  PERFORM cron.schedule('system-health-full-check-continuation','* * * * *',continuation_command);
  IF (SELECT count(*) FROM cron.job WHERE jobname='system-health-full-check-continuation')<>1
  THEN RAISE EXCEPTION 'health_cron_continuation_readback_failed'; END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname IN ('system-health-full-check-daily','nightly-system-health-hourly')
    AND (position(quote_literal(secret_value) IN command)>0 OR position('system_health_cron_secret' IN command)=0))
  THEN RAISE EXCEPTION 'health_cron_readback_failed'; END IF;
END $health_schedule$;
