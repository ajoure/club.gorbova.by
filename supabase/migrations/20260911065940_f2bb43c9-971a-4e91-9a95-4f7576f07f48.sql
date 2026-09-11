-- Restore daily Telegram summaries at 06:15 Minsk without persisting a secret in
-- cron.job.command. The secret lives only in Vault, is read at invocation time
-- by a locked SECURITY DEFINER wrapper, and is verified by the Edge Function
-- through a service-role-only RPC.

DO $$
DECLARE
  v_secret_id uuid;
BEGIN
  SELECT id
    INTO v_secret_id
  FROM vault.secrets
  WHERE name = 'telegram_summary_cron_secret'
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'telegram_summary_cron_secret',
      'Authenticates the telegram-daily-summary pg_cron job only.'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.verify_telegram_summary_cron_secret(_candidate text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(_candidate, '') = (
      SELECT decrypted_secret
      FROM vault.decrypted_secrets
      WHERE name = 'telegram_summary_cron_secret'
      LIMIT 1
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.verify_telegram_summary_cron_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_telegram_summary_cron_secret(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_telegram_daily_summary()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'telegram_summary_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'Telegram summary cron secret is missing'
      USING ERRCODE = '42501';
  END IF;

  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/telegram-daily-summary',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-telegram-summary-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_telegram_daily_summary()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_telegram_daily_summary()
  TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
    INTO v_job_id
  FROM cron.job
  WHERE jobname = 'telegram-daily-summary'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    PERFORM cron.schedule(
      'telegram-daily-summary',
      '15 3 * * *',
      'SELECT public.invoke_telegram_daily_summary();'
    );
  ELSE
    PERFORM cron.alter_job(
      job_id := v_job_id,
      schedule := '15 3 * * *',
      command := 'SELECT public.invoke_telegram_daily_summary();',
      active := true
    );
  END IF;
END
$$;