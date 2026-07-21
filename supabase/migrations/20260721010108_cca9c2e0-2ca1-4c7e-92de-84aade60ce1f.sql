-- Phase 4 hardening: serialize trigger/manual enqueues for one source row.

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
  PERFORM pg_advisory_xact_lock(hashtextextended(_cld_id::text || ':' || _reason, 0));
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
    ), NULL, NULL
  ) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT id INTO v_existing FROM public.company_sync_queue
   WHERE entity_id = _cld_id AND run_reason = _reason
     AND status IN ('queued','running') LIMIT 1;
  RETURN v_existing;
END $$;

REVOKE ALL ON FUNCTION public.crm_enqueue_from_source_change(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_enqueue_from_source_change(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_company_sync_enqueue(
  _cld_id uuid,
  _reason text,
  _expected_company_id uuid DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_owner uuid; v_purpose text; v_ctype text; v_is_admin boolean;
  v_key text; v_id uuid; v_existing uuid; v_map_company uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE='42501'; END IF;
  IF _reason NOT IN ('legal_details_upsert','manual_replay') THEN
    RAISE EXCEPTION 'unsupported reason: %', _reason USING ERRCODE='22023';
  END IF;
  SELECT cld.profile_id, cld.purpose, cld.client_type
    INTO v_owner, v_purpose, v_ctype FROM public.client_legal_details cld
   WHERE cld.id = _cld_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'client_legal_details % not found', _cld_id USING ERRCODE='23503';
  END IF;
  IF v_purpose <> 'billing' OR v_ctype NOT IN ('legal_entity','entrepreneur') THEN
    RAISE EXCEPTION 'CLD % not eligible (purpose=%, client_type=%)',
      _cld_id, v_purpose, v_ctype USING ERRCODE='22023';
  END IF;
  v_is_admin := public.has_role_v2(v_caller, 'admin')
    OR public.has_role_v2(v_caller, 'super_admin')
    OR public.has_role_v2(v_caller, 'menedzher');
  IF NOT v_is_admin AND NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_owner AND (p.user_id = v_caller OR p.id = v_caller)
  ) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _expected_company_id IS NOT NULL THEN
    SELECT m.company_id INTO v_map_company
      FROM public.client_legal_details_company_map m
     WHERE m.client_legal_details_id = _cld_id;
    IF v_map_company IS NOT NULL AND v_map_company <> _expected_company_id THEN
      RAISE EXCEPTION 'company_id mismatch for CLD %: expected=%, actual=%',
        _cld_id, _expected_company_id, v_map_company USING ERRCODE='22023';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_cld_id::text || ':' || _reason, 0));
  SELECT id INTO v_existing FROM public.company_sync_queue
   WHERE entity_id = _cld_id AND run_reason = _reason
     AND status IN ('queued','running') LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  v_key := 'company_sync:v2:' || _cld_id::text || ':' || _reason || ':' ||
           (extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  INSERT INTO public.company_sync_queue (
    entity_id, entity_type, run_reason, payload, status,
    idempotency_key, metadata, created_by, updated_by
  ) VALUES (
    _cld_id, 'client_legal_details', _reason, '{}'::jsonb, 'queued', v_key,
    jsonb_build_object(
      'enqueued_by', v_caller, 'enqueued_at', now(),
      'expected_company_id', _expected_company_id,
      'audit_trail', jsonb_build_array(jsonb_build_object(
        'at', now(), 'actor', v_caller, 'action', 'enqueue',
        'reason', _reason, 'expected_company_id', _expected_company_id))
    ), v_caller, v_caller
  ) ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT id INTO v_existing FROM public.company_sync_queue
   WHERE entity_id = _cld_id AND run_reason = _reason
     AND status IN ('queued','running') LIMIT 1;
  RETURN v_existing;
END
$fn$;

REVOKE ALL ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_company_sync_enqueue(uuid, text, uuid) TO service_role;