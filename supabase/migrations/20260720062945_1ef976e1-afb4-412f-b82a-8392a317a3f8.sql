-- Phase 4B: minimal company sync queue DDL + service/authenticated helpers.

DO $$
DECLARE
  v_companies int; v_maps int; v_billing int; v_seq int; v_queue int; v_failed int;
  v_hash text;
BEGIN
  SELECT count(*) INTO v_companies FROM public.companies;
  SELECT count(*) INTO v_maps      FROM public.client_legal_details_company_map;
  SELECT count(*) INTO v_billing   FROM public.company_contacts WHERE is_billing_contact = true;
  SELECT last_value INTO v_seq     FROM public.public_id_sequences WHERE entity_type='company';
  SELECT count(*) INTO v_queue     FROM public.company_sync_queue;
  SELECT count(*) INTO v_failed    FROM public.company_sync_queue WHERE status IN ('failed','dead_letter');
  IF v_companies <> 16 OR v_maps <> 17 OR v_billing <> 17 OR v_seq <> 16 THEN
    RAISE EXCEPTION 'Phase4B preflight FAIL: canonical baseline drift (c=%, m=%, b=%, s=%)',
      v_companies, v_maps, v_billing, v_seq;
  END IF;
  IF v_queue <> 0 OR v_failed <> 0 THEN
    RAISE EXCEPTION 'Phase4B preflight FAIL: queue not empty (total=%, failed=%)', v_queue, v_failed;
  END IF;
  SELECT md5(pg_get_functiondef(oid)) INTO v_hash
  FROM pg_proc WHERE proname='crm_company_backfill_billing_cld';
  IF v_hash <> '36b5ee9763bb813b66dec59df53102d6' THEN
    RAISE EXCEPTION 'Phase4B preflight FAIL: writer signature drift (hash=%)', v_hash;
  END IF;
END $$;

ALTER TABLE public.company_sync_queue
  ADD COLUMN IF NOT EXISTS first_attempted_at timestamptz NULL;

ALTER TABLE public.company_sync_queue
  DROP CONSTRAINT IF EXISTS company_sync_queue_status_check;

ALTER TABLE public.company_sync_queue
  ADD CONSTRAINT company_sync_queue_status_check
  CHECK (status = ANY (ARRAY['queued','running','done','failed','skipped','dead_letter']));

CREATE INDEX IF NOT EXISTS csq_deadletter_idx
  ON public.company_sync_queue (updated_at)
  WHERE status = 'dead_letter';

CREATE OR REPLACE FUNCTION public.crm_company_sync_enqueue(
  _cld_id uuid,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_purpose text;
  v_ctype   text;
  v_is_admin boolean;
  v_key text;
  v_id  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE='42501';
  END IF;
  IF _reason NOT IN ('legal_details_upsert','manual_replay') THEN
    RAISE EXCEPTION 'unsupported reason: %', _reason USING ERRCODE='22023';
  END IF;

  SELECT cld.profile_id, cld.purpose, cld.client_type
    INTO v_owner, v_purpose, v_ctype
  FROM public.client_legal_details cld
  WHERE cld.id = _cld_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'client_legal_details % not found', _cld_id USING ERRCODE='23503';
  END IF;
  IF v_purpose <> 'billing' OR v_ctype NOT IN ('legal_entity','entrepreneur') THEN
    RAISE EXCEPTION 'CLD % not eligible (purpose=%, client_type=%)',
      _cld_id, v_purpose, v_ctype USING ERRCODE='22023';
  END IF;

  v_is_admin :=
       public.has_role_v2(v_caller, 'admin')
    OR public.has_role_v2(v_caller, 'super_admin')
    OR public.has_role_v2(v_caller, 'menedzher');

  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_owner AND (p.user_id = v_caller OR p.id = v_caller)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  v_key := 'company_sync:v1:' || _cld_id::text || ':' || _reason;

  INSERT INTO public.company_sync_queue (
    entity_id, entity_type, run_reason, payload, status,
    idempotency_key, metadata, created_by, updated_by
  ) VALUES (
    _cld_id, 'client_legal_details', _reason, '{}'::jsonb, 'queued',
    v_key,
    jsonb_build_object('enqueued_by', v_caller, 'enqueued_at', now()),
    v_caller, v_caller
  )
  ON CONFLICT (idempotency_key) DO UPDATE
    SET updated_at = public.company_sync_queue.updated_at
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_sync_enqueue(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_enqueue(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_company_sync_worker_claim(
  _batch int DEFAULT 10,
  _lease_seconds int DEFAULT 60
) RETURNS SETOF public.company_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_worker text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE='42501';
  END IF;
  IF _batch IS NULL OR _batch <= 0 OR _batch > 100 THEN
    RAISE EXCEPTION 'invalid batch size' USING ERRCODE='22023';
  END IF;
  IF _lease_seconds IS NULL OR _lease_seconds < 15 OR _lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid lease seconds' USING ERRCODE='22023';
  END IF;

  v_worker := 'worker:' || encode(gen_random_bytes(6), 'hex');

  RETURN QUERY
  WITH cte AS (
    SELECT q.id
    FROM public.company_sync_queue q
    WHERE ((q.status='queued'  AND q.next_run_at <= now())
        OR (q.status='running' AND q.next_run_at <= now()))
    ORDER BY q.next_run_at
    FOR UPDATE SKIP LOCKED
    LIMIT _batch
  )
  UPDATE public.company_sync_queue q
     SET status='running',
         attempts = q.attempts + 1,
         locked_by = v_worker,
         locked_at = now(),
         next_run_at = now() + make_interval(secs => _lease_seconds),
         first_attempted_at = COALESCE(q.first_attempted_at, now()),
         updated_at = now()
    FROM cte
   WHERE q.id = cte.id
  RETURNING q.*;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_sync_worker_claim(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_worker_claim(int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_company_sync_worker_complete(
  _id uuid,
  _status text,
  _error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.company_sync_queue%ROWTYPE;
  v_backoff int;
  v_jitter numeric;
  v_max_attempts constant int := 8;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE='42501';
  END IF;
  IF _status NOT IN ('done','retry','dead_letter','skipped') THEN
    RAISE EXCEPTION 'invalid status: %', _status USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.company_sync_queue WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % not found', _id USING ERRCODE='23503';
  END IF;
  IF v_row.status <> 'running' THEN
    RAISE EXCEPTION 'job % not in running state (status=%)', _id, v_row.status USING ERRCODE='22023';
  END IF;

  IF _status = 'done' THEN
    UPDATE public.company_sync_queue
       SET status='done', last_error=NULL, locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id=_id;
  ELSIF _status = 'skipped' THEN
    UPDATE public.company_sync_queue
       SET status='skipped', last_error=_error, locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id=_id;
  ELSIF _status = 'dead_letter' THEN
    UPDATE public.company_sync_queue
       SET status='dead_letter', last_error=_error, locked_by=NULL, locked_at=NULL, updated_at=now()
     WHERE id=_id;
  ELSE
    IF v_row.attempts >= v_max_attempts THEN
      UPDATE public.company_sync_queue
         SET status='dead_letter',
             last_error=COALESCE(_error,'max attempts reached'),
             locked_by=NULL, locked_at=NULL, updated_at=now()
       WHERE id=_id;
    ELSE
      v_backoff := LEAST(3600, 30 * (2 ^ GREATEST(v_row.attempts - 1, 0))::int);
      v_jitter  := 0.8 + (random() * 0.4);
      UPDATE public.company_sync_queue
         SET status='queued',
             last_error=_error,
             locked_by=NULL,
             locked_at=NULL,
             next_run_at = now() + make_interval(secs => (v_backoff * v_jitter)::int),
             updated_at = now()
       WHERE id=_id;
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_sync_worker_complete(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_worker_complete(uuid, text, text) TO service_role;

DO $$
DECLARE
  v_companies int; v_maps int; v_billing int; v_seq int; v_queue int;
  v_hash text; v_has_col boolean; v_has_idx boolean; v_status_ok boolean; v_bad int;
BEGIN
  SELECT count(*) INTO v_companies FROM public.companies;
  SELECT count(*) INTO v_maps      FROM public.client_legal_details_company_map;
  SELECT count(*) INTO v_billing   FROM public.company_contacts WHERE is_billing_contact = true;
  SELECT last_value INTO v_seq     FROM public.public_id_sequences WHERE entity_type='company';
  SELECT count(*) INTO v_queue     FROM public.company_sync_queue;
  IF v_companies <> 16 OR v_maps <> 17 OR v_billing <> 17 OR v_seq <> 16 OR v_queue <> 0 THEN
    RAISE EXCEPTION 'Phase4B postflight FAIL: baseline drift (c=%, m=%, b=%, s=%, q=%)',
      v_companies, v_maps, v_billing, v_seq, v_queue;
  END IF;

  SELECT md5(pg_get_functiondef(oid)) INTO v_hash
    FROM pg_proc WHERE proname='crm_company_backfill_billing_cld';
  IF v_hash <> '36b5ee9763bb813b66dec59df53102d6' THEN
    RAISE EXCEPTION 'Phase4B postflight FAIL: writer hash drift (%)', v_hash;
  END IF;

  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='company_sync_queue' AND column_name='first_attempted_at')
    INTO v_has_col;
  IF NOT v_has_col THEN RAISE EXCEPTION 'Phase4B postflight FAIL: first_attempted_at missing'; END IF;

  SELECT EXISTS(SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND tablename='company_sync_queue' AND indexname='csq_deadletter_idx')
    INTO v_has_idx;
  IF NOT v_has_idx THEN RAISE EXCEPTION 'Phase4B postflight FAIL: csq_deadletter_idx missing'; END IF;

  SELECT EXISTS(SELECT 1 FROM pg_constraint
    WHERE conname='company_sync_queue_status_check'
      AND pg_get_constraintdef(oid) ILIKE '%dead_letter%')
    INTO v_status_ok;
  IF NOT v_status_ok THEN RAISE EXCEPTION 'Phase4B postflight FAIL: status check missing dead_letter'; END IF;

  -- Worker helpers: only service_role EXECUTE
  SELECT count(*) INTO v_bad
  FROM information_schema.role_routine_grants
  WHERE routine_schema='public'
    AND routine_name IN ('crm_company_sync_worker_claim','crm_company_sync_worker_complete')
    AND grantee IN ('PUBLIC','anon','authenticated');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Phase4B postflight FAIL: worker helpers exposed (bad=%)', v_bad;
  END IF;

  -- Enqueue: no PUBLIC/anon
  SELECT count(*) INTO v_bad
  FROM information_schema.role_routine_grants
  WHERE routine_schema='public' AND routine_name='crm_company_sync_enqueue'
    AND grantee IN ('PUBLIC','anon');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Phase4B postflight FAIL: enqueue exposed to PUBLIC/anon';
  END IF;

  -- Table ACL untouched (no anon/authenticated on company_sync_queue)
  SELECT count(*) INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='company_sync_queue'
    AND grantee IN ('anon','authenticated','PUBLIC');
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'Phase4B postflight FAIL: company_sync_queue table exposed';
  END IF;
END $$;
