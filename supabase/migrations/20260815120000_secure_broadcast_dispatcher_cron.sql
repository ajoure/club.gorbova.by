-- Secure the existing broadcast dispatcher cron without persisting a secret in
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
  WHERE name = 'broadcast_dispatcher_cron_secret'
  LIMIT 1;

  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'broadcast_dispatcher_cron_secret',
      'Authenticates the process-scheduled-broadcasts pg_cron job only.'
    );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.verify_broadcast_dispatcher_cron_secret(_candidate text)
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
      WHERE name = 'broadcast_dispatcher_cron_secret'
      LIMIT 1
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.verify_broadcast_dispatcher_cron_secret(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_broadcast_dispatcher_cron_secret(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_broadcasts()
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
  WHERE name = 'broadcast_dispatcher_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR v_secret = '' THEN
    RAISE EXCEPTION 'broadcast dispatcher cron secret is missing'
      USING ERRCODE = '42501';
  END IF;

  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/process-scheduled-broadcasts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-broadcast-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  )
  INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_scheduled_broadcasts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_process_scheduled_broadcasts()
  TO service_role;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
    INTO v_job_id
  FROM cron.job
  WHERE jobname = 'process-scheduled-broadcasts-every-minute'
  LIMIT 1;

  IF v_job_id IS NULL THEN
    PERFORM cron.schedule(
      'process-scheduled-broadcasts-every-minute',
      '* * * * *',
      'SELECT public.invoke_process_scheduled_broadcasts();'
    );
  ELSE
    PERFORM cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *',
      command := 'SELECT public.invoke_process_scheduled_broadcasts();',
      active := true
    );
  END IF;
END
$$;
