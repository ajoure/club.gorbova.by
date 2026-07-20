
-- 1. Vault secret (generated in-DB, no plaintext outside vault).
DO $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'phase4_worker_shared_secret';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'phase4_worker_shared_secret',
      'Phase 4D shared secret for company-sync-worker invocations from pg_cron.'
    );
  END IF;
END $$;

-- 2. Service-only readers.
CREATE OR REPLACE FUNCTION public.crm_phase4_worker_secret()
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_secret text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE='42501';
  END IF;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
   WHERE name='phase4_worker_shared_secret' LIMIT 1;
  RETURN v_secret;
END $$;

REVOKE ALL ON FUNCTION public.crm_phase4_worker_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_phase4_worker_secret() TO service_role;

-- 3. Source-boundary enqueue helper (SECURITY DEFINER, called only by trigger).
CREATE OR REPLACE FUNCTION public.crm_enqueue_from_source_change(
  _cld_id uuid, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_existing uuid; v_key text; v_id uuid; v_expected uuid;
  v_purpose text; v_ctype text; v_profile uuid;
BEGIN
  SELECT profile_id, purpose, client_type INTO v_profile, v_purpose, v_ctype
    FROM public.client_legal_details WHERE id = _cld_id;
  IF v_profile IS NULL THEN RETURN NULL; END IF;
  IF v_purpose <> 'billing' OR v_ctype NOT IN ('legal_entity','entrepreneur') THEN
    RETURN NULL;
  END IF;

  SELECT company_id INTO v_expected FROM public.client_legal_details_company_map
   WHERE client_legal_details_id = _cld_id;

  SELECT id INTO v_existing FROM public.company_sync_queue
   WHERE entity_id = _cld_id AND run_reason = _reason
     AND status IN ('queued','running') LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_key := 'company_sync:v2:'||_cld_id::text||':'||_reason||':'||
           (extract(epoch from clock_timestamp())*1000)::bigint::text;

  INSERT INTO public.company_sync_queue (
    entity_id, entity_type, run_reason, payload, status,
    idempotency_key, metadata, created_by, updated_by
  ) VALUES (
    _cld_id, 'client_legal_details', _reason, '{}'::jsonb, 'queued', v_key,
    jsonb_build_object(
      'enqueued_by', NULL, 'enqueued_at', now(),
      'expected_company_id', v_expected, 'source','trigger',
      'audit_trail', jsonb_build_array(jsonb_build_object(
        'at', now(),'action','enqueue_trigger','reason',_reason,
        'expected_company_id', v_expected))
    ),
    NULL, NULL
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_enqueue_from_source_change(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_enqueue_from_source_change(uuid,text) TO service_role;

-- 4. Trigger function — enqueue only for genuinely-new billing rows or when
--    billing-relevant columns change. Historical rows already in the table
--    are NOT touched (trigger only fires on future writes).
CREATE OR REPLACE FUNCTION public.crm_client_legal_details_enqueue_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.purpose <> 'billing' OR NEW.client_type NOT IN ('legal_entity','entrepreneur') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.crm_enqueue_from_source_change(NEW.id, 'legal_details_upsert');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.leg_unp IS DISTINCT FROM NEW.leg_unp
       OR OLD.leg_name IS DISTINCT FROM NEW.leg_name
       OR OLD.leg_org_form IS DISTINCT FROM NEW.leg_org_form
       OR OLD.leg_address IS DISTINCT FROM NEW.leg_address
       OR OLD.profile_id IS DISTINCT FROM NEW.profile_id
       OR OLD.purpose IS DISTINCT FROM NEW.purpose
       OR OLD.client_type IS DISTINCT FROM NEW.client_type
       OR OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM public.crm_enqueue_from_source_change(NEW.id, 'legal_details_upsert');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS client_legal_details_enqueue_company_sync_trg ON public.client_legal_details;
CREATE TRIGGER client_legal_details_enqueue_company_sync_trg
AFTER INSERT OR UPDATE ON public.client_legal_details
FOR EACH ROW EXECUTE FUNCTION public.crm_client_legal_details_enqueue_trg();

-- 5. pg_cron activation — invoke worker every 2 minutes via pg_net using the
--    vault-stored secret; the URL is fixed to the project's edge domain.
DO $$
DECLARE v_secret text; v_url text; v_apikey text;
BEGIN
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets
    WHERE name='phase4_worker_shared_secret';
  IF v_secret IS NULL THEN RAISE EXCEPTION 'vault secret missing'; END IF;
END $$;

-- Unschedule any existing job with the same name (idempotent activation).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='phase4-company-sync-worker') THEN
    PERFORM cron.unschedule('phase4-company-sync-worker');
  END IF;
END $$;

SELECT cron.schedule(
  'phase4-company-sync-worker',
  '*/2 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://hdjgkjceownmmnrqqtuz.supabase.co/functions/v1/company-sync-worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-Worker-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='phase4_worker_shared_secret'),
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhkamdramNlb3dubW1ucnFxdHV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NTczNjMsImV4cCI6MjA4MjIzMzM2M30.bg4ALwTFZ57YYDLgB4IwLqIDrt0XcQGIlDEGllNBX0E'
    ),
    body := jsonb_build_object('source','pg_cron','batch',10,'lease_seconds',60)
  );
  $cron$
);
