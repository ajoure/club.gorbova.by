-- `subscription-charge` initiates real recurring bePaid charges. Its previous
-- jobs used the public anon JWT, which allowed anyone who knew the endpoint to
-- invoke an execute run. Create a per-job secret inside Vault, never in Git.
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets
  WHERE name = 'subscription_charge_cron_secret';

  IF v_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'subscription_charge_cron_secret',
      'Authenticates subscription-charge pg_cron jobs only.'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.subscription_charge_cron_secret()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE v_secret text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'subscription_charge_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'subscription charge cron secret missing';
  END IF;

  RETURN v_secret;
END $$;

REVOKE ALL ON FUNCTION public.subscription_charge_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_charge_cron_secret() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription-charge-morning') THEN
    PERFORM cron.unschedule('subscription-charge-morning');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'subscription-charge-evening') THEN
    PERFORM cron.unschedule('subscription-charge-evening');
  END IF;
END $$;

-- The anon API key only passes the edge gateway. The Vault secret is the
-- authorization factor and is evaluated by pg_cron at each invocation.
SELECT cron.schedule(
  'subscription-charge-morning',
  '0 6 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/subscription-charge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E',
        'x-subscription-charge-cron-secret',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'subscription_charge_cron_secret')
      ),
      body := '{"source":"cron-morning","mode":"execute"}'::jsonb
    );
  $cron$
);

SELECT cron.schedule(
  'subscription-charge-evening',
  '0 18 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/subscription-charge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E',
        'x-subscription-charge-cron-secret',
          (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'subscription_charge_cron_secret')
      ),
      body := '{"source":"cron-evening","mode":"execute"}'::jsonb
    );
  $cron$
);
