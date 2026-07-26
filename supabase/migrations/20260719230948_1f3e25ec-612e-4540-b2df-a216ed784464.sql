
-- =========================================================================
-- Phase 3B identity remediation: service-only backfill writer
-- Scope: schema-only. NO DML, NO RLS/policy/table changes, NO sequences.
-- =========================================================================

-- ---------- PREFLIGHT ----------
DO $preflight$
DECLARE v_secdef boolean;
BEGIN
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_company_upsert_from_billing'
     AND pg_get_function_identity_arguments(p.oid)='_client_legal_details_id uuid';
  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'preflight: crm_company_upsert_from_billing(uuid) missing or wrong signature';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'preflight: crm_company_upsert_from_billing must be SECURITY DEFINER';
  END IF;

  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_company_link_contact'
     AND pg_get_function_identity_arguments(p.oid)=
         '_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid';
  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'preflight: crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) missing or wrong signature';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'preflight: crm_company_link_contact must be SECURITY DEFINER';
  END IF;

  IF has_function_privilege('service_role',
       'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'preflight: service_role must NOT have EXECUTE on crm_company_link_contact';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'preflight: authenticated must have EXECUTE on crm_company_link_contact';
  END IF;
  IF has_function_privilege('anon',
       'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'preflight: anon must NOT have EXECUTE on crm_company_link_contact';
  END IF;

  IF NOT has_function_privilege('service_role',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'preflight: service_role must have EXECUTE on crm_company_upsert_from_billing';
  END IF;
  IF has_function_privilege('authenticated',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'preflight: authenticated must NOT have EXECUTE on crm_company_upsert_from_billing';
  END IF;
  IF has_function_privilege('anon',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'preflight: anon must NOT have EXECUTE on crm_company_upsert_from_billing';
  END IF;
END $preflight$;

-- ---------- 1) Modify ONLY the authorization gate of crm_company_link_contact ----------
-- Add service_role bypass so that owner-executed wrappers can call this SECURITY DEFINER
-- function on behalf of a service-only backfill path. GRANTs are NOT changed below;
-- service_role still cannot invoke this function directly.
CREATE OR REPLACE FUNCTION public.crm_company_link_contact(
  _company_id uuid,
  _profile_id uuid,
  _relationship_type text,
  _is_billing_contact boolean,
  _source text,
  _source_client_legal_details_map_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_existing public.company_contacts%ROWTYPE;
        v_material boolean := false; v_first_insert boolean := false;
        v_company public.companies%ROWTYPE;
        v_activity_key text;
BEGIN
  -- Gate: admin/super_admin/menedzher OR service_role (for internal owner-executed wrappers).
  IF NOT (auth.role() = 'service_role'
       OR has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  IF _profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id required in phase 2' USING ERRCODE='22023';
  END IF;
  IF _relationship_type IS NULL OR length(btrim(_relationship_type)) = 0 THEN
    RAISE EXCEPTION 'relationship_type required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id=_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_company.status = 'merged' THEN
    RAISE EXCEPTION 'merged company is not linkable' USING ERRCODE='22023';
  END IF;

  IF _is_billing_contact THEN
    IF _source <> 'billing_requisites' THEN
      RAISE EXCEPTION 'billing flag requires source=billing_requisites' USING ERRCODE='22023';
    END IF;
    IF _source_client_legal_details_map_id IS NULL THEN
      RAISE EXCEPTION 'source_client_legal_details_map_id required for billing contact' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.client_legal_details_company_map
     WHERE id = _source_client_legal_details_map_id AND company_id = _company_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'map does not belong to company' USING ERRCODE='23503';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'crm_company_link_contact:' || _company_id::text || ':' || _profile_id::text || ':' || btrim(_relationship_type), 0));

  SELECT * INTO v_existing FROM public.company_contacts
   WHERE company_id=_company_id AND profile_id=_profile_id AND relationship_type=_relationship_type
   FOR UPDATE;

  IF FOUND THEN
    v_id := v_existing.id;
    IF (COALESCE(v_existing.is_billing_contact,false) = false AND COALESCE(_is_billing_contact,false) = true)
       OR (v_existing.source_client_legal_details_map_id IS NULL AND _source_client_legal_details_map_id IS NOT NULL)
       OR (v_existing.source IS DISTINCT FROM _source AND _source = 'billing_requisites') THEN
      v_material := true;
    END IF;

    UPDATE public.company_contacts SET
      is_billing_contact = v_existing.is_billing_contact OR COALESCE(_is_billing_contact,false),
      source_client_legal_details_map_id = COALESCE(v_existing.source_client_legal_details_map_id,
                                                    _source_client_legal_details_map_id),
      source = CASE WHEN v_existing.source='billing_requisites' OR _source='billing_requisites'
                    THEN 'billing_requisites' ELSE COALESCE(v_existing.source, _source) END,
      updated_by = auth.uid(), updated_at = now()
    WHERE id = v_id;
  ELSE
    BEGIN
      INSERT INTO public.company_contacts (
        company_id, profile_id, relationship_type,
        is_billing_contact, source, source_client_legal_details_map_id,
        created_by, updated_by
      ) VALUES (
        _company_id, _profile_id, _relationship_type,
        COALESCE(_is_billing_contact,false), _source, _source_client_legal_details_map_id,
        auth.uid(), auth.uid()
      )
      RETURNING id INTO v_id;
      v_first_insert := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT * INTO v_existing FROM public.company_contacts
       WHERE company_id=_company_id AND profile_id=_profile_id AND relationship_type=_relationship_type
       FOR UPDATE;
      IF NOT FOUND THEN RAISE; END IF;
      v_id := v_existing.id;
      IF (COALESCE(v_existing.is_billing_contact,false) = false AND COALESCE(_is_billing_contact,false) = true)
         OR (v_existing.source_client_legal_details_map_id IS NULL AND _source_client_legal_details_map_id IS NOT NULL)
         OR (v_existing.source IS DISTINCT FROM _source AND _source = 'billing_requisites') THEN
        v_material := true;
      END IF;
      UPDATE public.company_contacts SET
        is_billing_contact = v_existing.is_billing_contact OR COALESCE(_is_billing_contact,false),
        source_client_legal_details_map_id = COALESCE(v_existing.source_client_legal_details_map_id,
                                                      _source_client_legal_details_map_id),
        source = CASE WHEN v_existing.source='billing_requisites' OR _source='billing_requisites'
                      THEN 'billing_requisites' ELSE COALESCE(v_existing.source, _source) END,
        updated_by = auth.uid(), updated_at = now()
      WHERE id = v_id;
    END;
  END IF;

  IF v_first_insert THEN
    v_activity_key := 'company.linked_to_contact:' || v_id::text;
    PERFORM public._crm_company_emit_domain_event(
      'company.linked_to_contact.v1',
      _company_id,
      v_activity_key,
      jsonb_build_object(
        'version', 1, 'company_id', _company_id, 'contact_id', v_id, 'profile_id', _profile_id,
        'relationship_type', _relationship_type, 'is_billing_contact', COALESCE(_is_billing_contact,false),
        'source', _source, 'source_map_id', _source_client_legal_details_map_id,
        'occurred_at', now(),
        'idempotency_key', v_activity_key
      )
    );
  ELSIF v_material THEN
    v_activity_key := 'company.linked_to_contact.updated:' || v_id::text || ':' ||
      md5(coalesce(_source,'') || ':' || coalesce(_is_billing_contact::text,'') || ':' ||
          coalesce(_source_client_legal_details_map_id::text,''));
    PERFORM public._crm_company_emit_domain_event(
      'company.linked_to_contact.v1',
      _company_id,
      v_activity_key,
      jsonb_build_object(
        'version', 1, 'company_id', _company_id, 'contact_id', v_id, 'update', true,
        'occurred_at', now(),
        'idempotency_key', v_activity_key
      )
    );
  END IF;

  IF v_activity_key IS NOT NULL THEN
    INSERT INTO public.crm_activity_log (
      activity_type, source_entity_id, source_entity_type,
      user_id, idempotency_key, metadata
    )
    SELECT 'company.linked_to_contact', _company_id, 'company', auth.uid(),
           v_activity_key,
           jsonb_build_object(
             'contact_id', v_id,
             'profile_id', _profile_id,
             'relationship_type', _relationship_type,
             'is_billing_contact', COALESCE(_is_billing_contact,false),
             'source', _source,
             'source_map_id', _source_client_legal_details_map_id,
             'update', NOT v_first_insert
           )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.crm_activity_log
       WHERE source_entity_type='company' AND source_entity_id=_company_id
         AND idempotency_key=v_activity_key
    );
  END IF;

  RETURN v_id;
END $function$;

-- Explicitly re-assert existing ACL to guarantee it is preserved verbatim.
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;

-- ---------- 2) New internal service-only writer ----------
CREATE OR REPLACE FUNCTION public.crm_company_backfill_billing_cld(_client_legal_details_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_profile uuid;
  v_company_id uuid;
  v_map public.client_legal_details_company_map%ROWTYPE;
  v_map_id uuid;
  v_map_created boolean := false;
  v_map_reused  boolean := false;
  v_contact_id uuid;
  v_contact_pre uuid;
BEGIN
  -- Identity gate: service_role only. Do NOT rely on BYPASSRLS or sandbox roles.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: crm_company_backfill_billing_cld is service_role only'
      USING ERRCODE='42501';
  END IF;
  IF _client_legal_details_id IS NULL THEN
    RAISE EXCEPTION 'client_legal_details_id required' USING ERRCODE='22023';
  END IF;

  -- Deterministic row-lock on the source CLD; extract profile_id.
  SELECT profile_id INTO v_profile
    FROM public.client_legal_details
   WHERE id = _client_legal_details_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_legal_details % not found', _client_legal_details_id USING ERRCODE='23503';
  END IF;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'client_legal_details % has null profile_id', _client_legal_details_id USING ERRCODE='23502';
  END IF;

  -- Canonical company via existing Phase-2 RPC (SECURITY DEFINER, service_role EXECUTE).
  v_company_id := public.crm_company_upsert_from_billing(_client_legal_details_id);
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'crm_company_upsert_from_billing returned NULL for cld %', _client_legal_details_id
      USING ERRCODE='22004';
  END IF;

  -- MAP: read-then-insert; equality check on company_id; never blind ON CONFLICT.
  SELECT * INTO v_map
    FROM public.client_legal_details_company_map
   WHERE client_legal_details_id = _client_legal_details_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_map.company_id IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION
        'map conflict for cld %: existing company % != expected %',
        _client_legal_details_id, v_map.company_id, v_company_id
        USING ERRCODE='23505';
    END IF;
    v_map_id := v_map.id;
    v_map_reused := true;
  ELSE
    BEGIN
      INSERT INTO public.client_legal_details_company_map (
        client_legal_details_id,
        company_id,
        metadata
      ) VALUES (
        _client_legal_details_id,
        v_company_id,
        jsonb_build_object(
          'source', 'billing_requisites',
          'writer', 'crm_company_backfill_billing_cld',
          'writer_version', 1
        )
      )
      RETURNING id INTO v_map_id;
      v_map_created := true;
    EXCEPTION WHEN unique_violation THEN
      -- Concurrent insert — re-read and verify equality; never overwrite a mismatch.
      SELECT * INTO v_map
        FROM public.client_legal_details_company_map
       WHERE client_legal_details_id = _client_legal_details_id
       FOR UPDATE;
      IF NOT FOUND THEN RAISE; END IF;
      IF v_map.company_id IS DISTINCT FROM v_company_id THEN
        RAISE EXCEPTION
          'map conflict on retry for cld %: existing company % != expected %',
          _client_legal_details_id, v_map.company_id, v_company_id
          USING ERRCODE='23505';
      END IF;
      v_map_id := v_map.id;
      v_map_reused := true;
    END;
  END IF;

  -- Snapshot whether the billing_contact already exists (for created/reused indicator).
  SELECT id INTO v_contact_pre
    FROM public.company_contacts
   WHERE company_id = v_company_id
     AND profile_id = v_profile
     AND relationship_type = 'billing_contact';

  -- Delegate to existing linker (idempotency, events, activity log preserved).
  v_contact_id := public.crm_company_link_contact(
    v_company_id,
    v_profile,
    'billing_contact',
    true,
    'billing_requisites',
    v_map_id
  );

  RETURN jsonb_build_object(
    'client_legal_details_id', _client_legal_details_id,
    'profile_id',              v_profile,
    'company_id',              v_company_id,
    'map_id',                  v_map_id,
    'map_created',             v_map_created,
    'map_reused',              v_map_reused,
    'contact_id',              v_contact_id,
    'contact_created',         v_contact_pre IS NULL,
    'contact_reused',          v_contact_pre IS NOT NULL,
    'writer',                  'crm_company_backfill_billing_cld',
    'writer_version',          1
  );
END
$fn$;

-- Narrow ACL: service_role only.
REVOKE ALL ON FUNCTION public.crm_company_backfill_billing_cld(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_backfill_billing_cld(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_backfill_billing_cld(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.crm_company_backfill_billing_cld(uuid) TO service_role;

-- ---------- POSTFLIGHT ----------
DO $post$
BEGIN
  -- crm_company_link_contact grants strictly preserved.
  IF has_function_privilege('service_role',
       'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: service_role must NOT have EXECUTE on crm_company_link_contact';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: authenticated must retain EXECUTE on crm_company_link_contact';
  END IF;
  IF has_function_privilege('anon',
       'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: anon must NOT have EXECUTE on crm_company_link_contact';
  END IF;

  -- crm_company_upsert_from_billing grants strictly unchanged.
  IF NOT has_function_privilege('service_role',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: service_role must retain EXECUTE on crm_company_upsert_from_billing';
  END IF;
  IF has_function_privilege('authenticated',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: authenticated must NOT have EXECUTE on crm_company_upsert_from_billing';
  END IF;
  IF has_function_privilege('anon',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: anon must NOT have EXECUTE on crm_company_upsert_from_billing';
  END IF;

  -- New writer: service_role only.
  IF NOT has_function_privilege('service_role',
       'public.crm_company_backfill_billing_cld(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: service_role must have EXECUTE on crm_company_backfill_billing_cld';
  END IF;
  IF has_function_privilege('authenticated',
       'public.crm_company_backfill_billing_cld(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: authenticated must NOT have EXECUTE on crm_company_backfill_billing_cld';
  END IF;
  IF has_function_privilege('anon',
       'public.crm_company_backfill_billing_cld(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: anon must NOT have EXECUTE on crm_company_backfill_billing_cld';
  END IF;

  -- SECURITY DEFINER + search_path retained on modified linker.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_company_link_contact'
     AND p.prosecdef=true
     AND 'search_path=public' = ANY (p.proconfig);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'postflight: crm_company_link_contact lost SECURITY DEFINER or search_path=public';
  END IF;

  -- New writer hardening.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_company_backfill_billing_cld'
     AND p.prosecdef=true
     AND 'search_path=public' = ANY (p.proconfig);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'postflight: crm_company_backfill_billing_cld missing SECURITY DEFINER or search_path=public';
  END IF;
END $post$;
