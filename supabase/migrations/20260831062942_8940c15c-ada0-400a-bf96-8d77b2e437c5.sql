-- Harden only the two existing reconciliation jobs. Preserve their commands,
-- gateway credentials, schedules and bodies; never embed a new secret in Git.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

DO $guard$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname IN
      ('payments-reconcile-morning', 'payments-reconcile-evening')) <> 2 THEN
    RAISE EXCEPTION 'Expected exactly two payments-reconcile jobs';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname IN
      ('payments-reconcile-morning', 'payments-reconcile-evening') AND
      (NOT active OR schedule <> CASE jobname WHEN 'payments-reconcile-morning'
        THEN '0 6 * * *' ELSE '0 18 * * *' END OR
       command NOT LIKE '%https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/payments-reconcile%')) THEN
    RAISE EXCEPTION 'Unexpected reconciliation job configuration';
  END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'payments_reconcile_cron_secret') > 1 THEN
    RAISE EXCEPTION 'Ambiguous reconciliation Vault secret';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'payments_reconcile_cron_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'),
      'payments_reconcile_cron_secret', 'Authenticates the two payments-reconcile cron jobs only.');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.payments_reconcile_cron_secret()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_secret text;
BEGIN
  IF (auth.jwt()->>'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;
  SELECT decrypted_secret INTO STRICT v_secret FROM vault.decrypted_secrets
    WHERE name = 'payments_reconcile_cron_secret';
  IF v_secret IS NULL OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Reconciliation cron secret missing';
  END IF;
  RETURN v_secret;
END $function$;
REVOKE ALL ON FUNCTION public.payments_reconcile_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payments_reconcile_cron_secret() TO service_role;

DO $jobs$
DECLARE r record; v_header text; v_command text;
BEGIN
  FOR r IN SELECT jobid, command FROM cron.job WHERE jobname IN
      ('payments-reconcile-morning', 'payments-reconcile-evening') LOOP
    IF position('x-payments-reconcile-cron-secret' IN r.command) > 0 THEN
      IF position('payments_reconcile_cron_secret' IN r.command) = 0 THEN
        RAISE EXCEPTION 'Unexpected existing reconciliation auth';
      END IF;
      CONTINUE;
    END IF;
    v_header := substring(r.command FROM $rx$headers\s*:=\s*'[^']*'::jsonb$rx$);
    IF v_header IS NULL OR
      (SELECT count(*) FROM regexp_matches(r.command, $rx$headers\s*:=$rx$, 'g')) <> 1 THEN
      RAISE EXCEPTION 'Unrecognized reconciliation job headers';
    END IF;
    v_command := replace(r.command, v_header, v_header ||
      ' || jsonb_build_object(''x-payments-reconcile-cron-secret'', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = ''payments_reconcile_cron_secret''))');
    PERFORM cron.alter_job(r.jobid, command := v_command);
  END LOOP;
END $jobs$;