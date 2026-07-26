-- Phase 4C observability & ops slice
-- Preflight
DO $$
DECLARE v_c int; v_m int; v_b int; v_s bigint; v_q int;
BEGIN
  SELECT count(*) INTO v_c FROM public.companies;
  SELECT count(*) INTO v_m FROM public.client_legal_details_company_map;
  SELECT count(*) INTO v_b FROM public.company_contacts WHERE is_billing_contact=true;
  SELECT last_value INTO v_s FROM public.public_id_sequences WHERE entity_type='company';
  SELECT count(*) INTO v_q FROM public.company_sync_queue;
  IF (v_c, v_m, v_b, v_s, v_q) <> (16, 17, 17, 16, 0) THEN
    RAISE EXCEPTION 'Phase 4C obs preflight FAIL: c=%/m=%/b=%/seq=%/q=%', v_c, v_m, v_b, v_s, v_q;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='crm_company_backfill_billing_cld') THEN
    RAISE EXCEPTION 'permanent writer missing';
  END IF;
END $$;

-- (A) Active-only dedup partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS csq_active_dedup_idx
  ON public.company_sync_queue (entity_id, run_reason)
  WHERE status IN ('queued','running');

-- (B) Rewrite enqueue: active-only dedup, optional foreign-map guard, per-run idempotency key
DROP FUNCTION IF EXISTS public.crm_company_sync_enqueue(uuid, text);
CREATE OR REPLACE FUNCTION public.crm_company_sync_enqueue(
  _cld_id uuid,
  _reason text,
  _expected_company_id uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid;
  v_purpose text;
  v_ctype   text;
  v_is_admin boolean;
  v_key text;
  v_id uuid;
  v_existing uuid;
  v_map_company uuid;
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

  -- Optional foreign-map guard: reject a mismatched expected_company_id
  IF _expected_company_id IS NOT NULL THEN
    SELECT m.company_id INTO v_map_company
      FROM public.client_legal_details_company_map m
     WHERE m.client_legal_details_id = _cld_id;
    IF v_map_company IS NOT NULL AND v_map_company <> _expected_company_id THEN
      RAISE EXCEPTION 'company_id mismatch for CLD %: expected=%, actual=%',
        _cld_id, _expected_company_id, v_map_company USING ERRCODE='22023';
    END IF;
  END IF;

  -- Active-only dedup: return existing queued/running job if present
  SELECT id INTO v_existing
    FROM public.company_sync_queue
   WHERE entity_id = _cld_id
     AND run_reason = _reason
     AND status IN ('queued','running')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Terminal-history rows (done/failed/skipped/dead_letter) do NOT block a new
  -- enqueue. Per-run epoch suffix keeps the UNIQUE(idempotency_key) constraint
  -- from colliding; active-duplicate protection lives in csq_active_dedup_idx.
  v_key := 'company_sync:v2:' || _cld_id::text || ':' || _reason || ':' ||
           (extract(epoch from clock_timestamp()) * 1000)::bigint::text;

  INSERT INTO public.company_sync_queue (
    entity_id, entity_type, run_reason, payload, status,
    idempotency_key, metadata, created_by, updated_by
  ) VALUES (
    _cld_id, 'client_legal_details', _reason, '{}'::jsonb, 'queued',
    v_key,
    jsonb_build_object(
      'enqueued_by', v_caller,
      'enqueued_at', now(),
      'expected_company_id', _expected_company_id,
      'audit_trail', jsonb_build_array(
        jsonb_build_object(
          'at', now(), 'actor', v_caller,
          'action', 'enqueue', 'reason', _reason,
          'expected_company_id', _expected_company_id
        )
      )
    ),
    v_caller, v_caller
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) TO service_role;

-- (C) Health summary — service_role only
CREATE OR REPLACE FUNCTION public.crm_company_sync_health()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $fn$
DECLARE
  v_status_counts jsonb;
  v_oldest_pending timestamptz;
  v_stuck int;
  v_dl int;
  v_last_dl timestamptz;
  v_fail int;
  v_attempts int;
  v_recent jsonb;
  v_total int;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT coalesce(jsonb_object_agg(status, c), '{}'::jsonb), coalesce(sum(c)::int, 0)
    INTO v_status_counts, v_total
    FROM (SELECT status, count(*)::int c FROM public.company_sync_queue GROUP BY status) s;

  SELECT min(next_run_at) INTO v_oldest_pending
    FROM public.company_sync_queue WHERE status='queued';

  SELECT count(*)::int INTO v_stuck
    FROM public.company_sync_queue WHERE status='running' AND next_run_at < now();

  SELECT count(*)::int, max(updated_at) INTO v_dl, v_last_dl
    FROM public.company_sync_queue WHERE status='dead_letter';

  SELECT count(*)::int INTO v_fail
    FROM public.company_sync_queue WHERE status IN ('failed','dead_letter');

  SELECT coalesce(sum(attempts)::int, 0) INTO v_attempts
    FROM public.company_sync_queue;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_recent
    FROM (
      SELECT jsonb_build_object(
               'id', id, 'entity_id', entity_id, 'status', status,
               'attempts', attempts, 'updated_at', updated_at,
               'last_error', left(coalesce(last_error,''), 300)
             ) AS x
        FROM public.company_sync_queue
       WHERE status IN ('failed','dead_letter')
       ORDER BY updated_at DESC
       LIMIT 5
    ) r;

  RETURN jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'baseline', jsonb_build_object(
      'companies', (SELECT count(*) FROM public.companies),
      'maps', (SELECT count(*) FROM public.client_legal_details_company_map),
      'billing_contacts', (SELECT count(*) FROM public.company_contacts WHERE is_billing_contact=true),
      'seq_company', (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company')
    ),
    'queue', jsonb_build_object(
      'total', v_total,
      'by_status', v_status_counts,
      'oldest_pending_next_run', v_oldest_pending,
      'stuck_running', v_stuck,
      'dead_letter_count', v_dl,
      'last_dead_letter_at', v_last_dl,
      'failure_count', v_fail,
      'total_attempts', v_attempts
    ),
    'recent_failures', v_recent
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_sync_health() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_health() TO service_role;

-- (D) Admin retry — service_role only. Explicit admin actor required (activity log user_id is NOT NULL).
CREATE OR REPLACE FUNCTION public.crm_company_sync_admin_retry(
  _id uuid, _actor_user_id uuid, _reason text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $fn$
DECLARE
  v_row public.company_sync_queue%ROWTYPE;
  v_correlation uuid := gen_random_uuid();
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'actor required' USING ERRCODE='22023';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars)' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(p.user_id, p.id) INTO v_actor
    FROM public.profiles p
   WHERE p.id = _actor_user_id OR p.user_id = _actor_user_id
   LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'actor % not found in profiles', _actor_user_id USING ERRCODE='23503';
  END IF;

  SELECT * INTO v_row FROM public.company_sync_queue WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % not found', _id USING ERRCODE='23503';
  END IF;
  IF v_row.status NOT IN ('failed','dead_letter') THEN
    RAISE EXCEPTION 'job % not retryable from status %', _id, v_row.status USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_sync_queue
     WHERE entity_id = v_row.entity_id
       AND run_reason = v_row.run_reason
       AND status IN ('queued','running')
       AND id <> _id
  ) THEN
    RAISE EXCEPTION 'active duplicate exists for entity=%/reason=%',
      v_row.entity_id, v_row.run_reason USING ERRCODE='22023';
  END IF;

  UPDATE public.company_sync_queue
     SET status = 'queued',
         next_run_at = now(),
         locked_by = NULL, locked_at = NULL,
         last_error = NULL,
         attempts = 0,
         updated_at = now(),
         updated_by = v_actor,
         metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
           'audit_trail',
           coalesce(metadata->'audit_trail','[]'::jsonb) || jsonb_build_array(
             jsonb_build_object(
               'at', now(), 'actor', v_actor, 'action', 'admin_retry',
               'reason', _reason, 'correlation_id', v_correlation,
               'from_status', v_row.status, 'prior_attempts', v_row.attempts
             )
           )
         )
   WHERE id = _id;

  INSERT INTO public.crm_activity_log
    (user_id, activity_type, source_entity_type, source_entity_id, metadata)
  VALUES
    (v_actor, 'company_sync_admin_retry', 'company_sync_queue', _id,
     jsonb_build_object(
       'reason', _reason, 'correlation_id', v_correlation,
       'from_status', v_row.status, 'entity_id', v_row.entity_id,
       'run_reason', v_row.run_reason
     ));

  RETURN jsonb_build_object('ok', true, 'id', _id, 'correlation_id', v_correlation);
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_sync_admin_retry(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_admin_retry(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_sync_admin_retry(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_admin_retry(uuid, uuid, text) TO service_role;

-- (E) Admin dismiss with reason — service_role only.
CREATE OR REPLACE FUNCTION public.crm_company_sync_admin_dismiss(
  _id uuid, _actor_user_id uuid, _reason text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $fn$
DECLARE
  v_row public.company_sync_queue%ROWTYPE;
  v_correlation uuid := gen_random_uuid();
  v_actor uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'actor required' USING ERRCODE='22023';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'reason required (min 3 chars)' USING ERRCODE='22023';
  END IF;

  SELECT COALESCE(p.user_id, p.id) INTO v_actor
    FROM public.profiles p
   WHERE p.id = _actor_user_id OR p.user_id = _actor_user_id
   LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'actor % not found in profiles', _actor_user_id USING ERRCODE='23503';
  END IF;

  SELECT * INTO v_row FROM public.company_sync_queue WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job % not found', _id USING ERRCODE='23503';
  END IF;
  IF v_row.status NOT IN ('queued','failed','dead_letter') THEN
    RAISE EXCEPTION 'job % not dismissable from status %', _id, v_row.status USING ERRCODE='22023';
  END IF;

  UPDATE public.company_sync_queue
     SET status = 'skipped',
         locked_by = NULL, locked_at = NULL,
         updated_at = now(),
         updated_by = v_actor,
         last_error = coalesce(nullif(last_error,'') || E'\n','') || 'dismissed: ' || _reason,
         metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
           'audit_trail',
           coalesce(metadata->'audit_trail','[]'::jsonb) || jsonb_build_array(
             jsonb_build_object(
               'at', now(), 'actor', v_actor, 'action', 'admin_dismiss',
               'reason', _reason, 'correlation_id', v_correlation,
               'from_status', v_row.status
             )
           )
         )
   WHERE id = _id;

  INSERT INTO public.crm_activity_log
    (user_id, activity_type, source_entity_type, source_entity_id, metadata)
  VALUES
    (v_actor, 'company_sync_admin_dismiss', 'company_sync_queue', _id,
     jsonb_build_object(
       'reason', _reason, 'correlation_id', v_correlation,
       'from_status', v_row.status, 'entity_id', v_row.entity_id,
       'run_reason', v_row.run_reason
     ));

  RETURN jsonb_build_object('ok', true, 'id', _id, 'correlation_id', v_correlation);
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_sync_admin_dismiss(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_admin_dismiss(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_sync_admin_dismiss(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_admin_dismiss(uuid, uuid, text) TO service_role;

-- Postflight
DO $$
DECLARE v_c int; v_m int; v_b int; v_s bigint; v_q int; v_idx int; v_fns int;
BEGIN
  SELECT count(*) INTO v_c FROM public.companies;
  SELECT count(*) INTO v_m FROM public.client_legal_details_company_map;
  SELECT count(*) INTO v_b FROM public.company_contacts WHERE is_billing_contact=true;
  SELECT last_value INTO v_s FROM public.public_id_sequences WHERE entity_type='company';
  SELECT count(*) INTO v_q FROM public.company_sync_queue;
  SELECT count(*) INTO v_idx FROM pg_indexes
    WHERE tablename='company_sync_queue' AND indexname='csq_active_dedup_idx';
  SELECT count(*) INTO v_fns FROM pg_proc
    WHERE proname IN ('crm_company_sync_health',
                      'crm_company_sync_admin_retry',
                      'crm_company_sync_admin_dismiss');
  IF (v_c, v_m, v_b, v_s, v_q, v_idx, v_fns) <> (16, 17, 17, 16, 0, 1, 3) THEN
    RAISE EXCEPTION 'Phase 4C obs postflight FAIL: c=%/m=%/b=%/seq=%/q=%/idx=%/fns=%',
      v_c, v_m, v_b, v_s, v_q, v_idx, v_fns;
  END IF;
  IF md5(pg_get_functiondef((SELECT oid FROM pg_proc WHERE proname='crm_company_backfill_billing_cld')))
     <> '36b5ee9763bb813b66dec59df53102d6' THEN
    RAISE EXCEPTION 'permanent writer hash changed unexpectedly';
  END IF;
END $$;