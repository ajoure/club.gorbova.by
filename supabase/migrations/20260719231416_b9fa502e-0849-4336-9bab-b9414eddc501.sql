
-- =========================================================================
-- Phase 3B CORRECTIVE (schema-only): resolve NOT NULL actor for service_role
-- path inside crm_company_link_contact. NO DML, NO RLS/policy/table changes,
-- NO sequences, NO backfill.
-- =========================================================================

-- ---------- PREFLIGHT ----------
DO $preflight$
DECLARE r record; v_nullable text;
BEGIN
  -- Signature + SECURITY DEFINER + search_path invariants
  SELECT p.prosecdef, p.proconfig INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_company_link_contact'
     AND pg_get_function_identity_arguments(p.oid)=
         '_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'preflight: crm_company_link_contact signature missing';
  END IF;
  IF NOT r.prosecdef THEN
    RAISE EXCEPTION 'preflight: crm_company_link_contact must be SECURITY DEFINER';
  END IF;
  IF NOT ('search_path=public' = ANY (r.proconfig)) THEN
    RAISE EXCEPTION 'preflight: crm_company_link_contact must have search_path=public';
  END IF;

  -- ACL invariant
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

  -- Nullability facts we rely on
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='crm_activity_log' AND column_name='user_id';
  IF v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'preflight: expected crm_activity_log.user_id NOT NULL, got %', v_nullable;
  END IF;
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='id';
  IF v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'preflight: expected profiles.id NOT NULL, got %', v_nullable;
  END IF;
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='user_id';
  IF v_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'preflight: expected profiles.user_id NULLABLE, got %', v_nullable;
  END IF;

  -- Baseline canonical must remain empty (defence in depth vs accidental DML upstream)
  IF (SELECT count(*) FROM public.companies) <> 0 THEN
    RAISE EXCEPTION 'preflight: companies not empty; aborting corrective migration';
  END IF;
  IF (SELECT count(*) FROM public.client_legal_details_company_map) <> 0 THEN
    RAISE EXCEPTION 'preflight: client_legal_details_company_map not empty';
  END IF;
  IF (SELECT count(*) FROM public.company_contacts) <> 0 THEN
    RAISE EXCEPTION 'preflight: company_contacts not empty';
  END IF;
  IF (SELECT count(*) FROM public.crm_activity_log
        WHERE activity_type='company.linked_to_contact') <> 0 THEN
    RAISE EXCEPTION 'preflight: crm_activity_log has company.linked_to_contact rows';
  END IF;
  IF (SELECT last_value FROM public.public_id_sequences WHERE entity_type='company') <> 0 THEN
    RAISE EXCEPTION 'preflight: public_id_sequences.company last_value != 0';
  END IF;
END $preflight$;

-- ---------- CORRECTIVE: crm_company_link_contact ----------
-- Only diff vs the prior version:
--   * v_actor_user_id resolution at the top of BEGIN:
--       - service_role path: COALESCE(profiles.user_id, profiles.id) FROM _profile_id;
--         hard exception if profile missing or both null.
--       - all other paths: v_actor_user_id := auth.uid()  (byte-equivalent to prior).
--   * created_by / updated_by / crm_activity_log.user_id now use v_actor_user_id
--     instead of auth.uid().
-- Everything else — gate, advisory lock, unique_violation retry, domain events,
-- INSERT/UPDATE branches, error codes — is preserved verbatim.
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
        v_actor_user_id uuid;
BEGIN
  -- Gate (unchanged from previous version).
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

  -- Actor resolution.
  IF auth.role() = 'service_role' THEN
    SELECT COALESCE(p.user_id, p.id) INTO v_actor_user_id
      FROM public.profiles p
     WHERE p.id = _profile_id;
    IF v_actor_user_id IS NULL THEN
      RAISE EXCEPTION 'service actor unresolved: profile % missing or has no user_id/id', _profile_id
        USING ERRCODE='23502';
    END IF;
  ELSE
    v_actor_user_id := auth.uid();
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
      updated_by = v_actor_user_id, updated_at = now()
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
        v_actor_user_id, v_actor_user_id
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
        updated_by = v_actor_user_id, updated_at = now()
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
    SELECT 'company.linked_to_contact', _company_id, 'company', v_actor_user_id,
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

-- Explicitly re-assert ACL invariants (identical to prior state).
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) FROM service_role;
GRANT  EXECUTE ON FUNCTION public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid) TO authenticated;

-- ---------- POSTFLIGHT ----------
DO $post$
BEGIN
  -- Signature + SECURITY DEFINER + search_path retained.
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='crm_company_link_contact'
     AND p.prosecdef=true
     AND 'search_path=public' = ANY (p.proconfig)
     AND pg_get_function_identity_arguments(p.oid)=
         '_company_id uuid, _profile_id uuid, _relationship_type text, _is_billing_contact boolean, _source text, _source_client_legal_details_map_id uuid';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'postflight: crm_company_link_contact signature/SECDEF/search_path drift';
  END IF;

  -- ACL preserved.
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

  -- Writer + upsert ACL invariants unchanged.
  IF NOT has_function_privilege('service_role',
       'public.crm_company_backfill_billing_cld(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: writer lost service_role EXECUTE';
  END IF;
  IF has_function_privilege('authenticated',
       'public.crm_company_backfill_billing_cld(uuid)','EXECUTE')
     OR has_function_privilege('anon',
       'public.crm_company_backfill_billing_cld(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: writer must remain service_role-only';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: upsert lost service_role EXECUTE';
  END IF;
  IF has_function_privilege('authenticated',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('anon',
       'public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'postflight: upsert ACL drift';
  END IF;
END $post$;
