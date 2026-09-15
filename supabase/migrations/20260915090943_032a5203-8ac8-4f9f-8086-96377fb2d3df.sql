-- lovable-cron-fallback-reviewed: 288 runs/day; bounded availability safety net for fresh bePaid webhook payments only (last hour, batch 5); without it a missed inline recovery waits up to 12h for the 06:00/18:00 reconciliation.
-- Successful bePaid webhooks now invoke exact canonical recovery inline. This
-- separate job is only a bounded availability safety net: it can see webhook
-- rows created in the last hour, never a historical import/backlog.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $secret$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT id
    INTO v_secret_id
  FROM vault.secrets
  WHERE name = 'bepaid_webhook_realtime_queue_cron_secret'
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'bepaid_webhook_realtime_queue_cron_secret',
      'Authenticates the bounded fresh-webhook bePaid queue fallback only.'
    );
  END IF;
END
$secret$;

CREATE OR REPLACE FUNCTION public.verify_bepaid_webhook_realtime_queue_cron_secret(
  _candidate text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $function$
  SELECT COALESCE(
    NULLIF(_candidate, '') = (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'bepaid_webhook_realtime_queue_cron_secret'
      LIMIT 1
    ),
    false
  );
$function$;

REVOKE ALL ON FUNCTION public.verify_bepaid_webhook_realtime_queue_cron_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_bepaid_webhook_realtime_queue_cron_secret(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_bepaid_webhook_realtime_queue()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $function$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'bepaid_webhook_realtime_queue_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'bePaid realtime queue cron secret is missing'
      USING ERRCODE = '42501';
  END IF;

  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/bepaid-queue-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-bepaid-webhook-realtime-cron-secret', v_secret
    ),
    body := jsonb_build_object(
      'webhookRealtime', true,
      'batchSize', 5,
      'maxAttempts', 5,
      'excludeFileImport', true,
      'excludeCancelled', true
    )
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_bepaid_webhook_realtime_queue()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_bepaid_webhook_realtime_queue()
  TO service_role;

DO $job$
DECLARE
  v_job_id bigint;
BEGIN
  IF (SELECT count(*) FROM cron.job
      WHERE jobname = 'bepaid-webhook-realtime-queue-every-5-minutes') > 1 THEN
    RAISE EXCEPTION 'Ambiguous bePaid realtime queue fallback jobs';
  END IF;

  SELECT jobid
    INTO v_job_id
  FROM cron.job
  WHERE jobname = 'bepaid-webhook-realtime-queue-every-5-minutes'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    PERFORM cron.schedule(
      'bepaid-webhook-realtime-queue-every-5-minutes',
      '*/5 * * * *',
      'SELECT public.invoke_bepaid_webhook_realtime_queue();'
    );
  ELSE
    PERFORM cron.alter_job(
      job_id := v_job_id,
      schedule := '*/5 * * * *',
      command := 'SELECT public.invoke_bepaid_webhook_realtime_queue();',
      active := true
    );
  END IF;
END
$job$;