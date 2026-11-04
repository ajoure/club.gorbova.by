-- Schema/API only. No existing contact or business data is changed on install.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Fail closed rather than replace a newer writer with an old definition.
DO $preflight$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)')) IS DISTINCT FROM '61c974fb8d8ae18192d245614ba55b5c' THEN
    RAISE EXCEPTION 'canonical writer drift: crm_company_link_contact; review before installation';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = pg_catalog.to_regprocedure('public.crm_company_backfill_billing_cld(uuid)')) IS DISTINCT FROM '4790edf5b068b8e3db32e0ed6571aa19' THEN
    RAISE EXCEPTION 'canonical writer drift: crm_company_backfill_billing_cld; review before installation';
  END IF;
  -- Both repository bodies have identical executable lines. The deployed
  -- 20260719221105 body omits comments present in 20260719235959; do not
  -- overwrite it or accept an arbitrary new body on that basis.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure('public.crm_company_upsert_from_billing(uuid)')
       AND md5(prosrc) IN ('bca55d5657e53ad4beab03ac9af9b983', '25975fbe8e69295d21c311df4a33844b')) THEN
    RAISE EXCEPTION 'canonical writer drift: crm_company_upsert_from_billing; review before installation';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
       WHERE conrelid = 'public.company_contacts'::regclass
         AND conname = 'company_contacts_relationship_type_check') IS DISTINCT FROM
     $check$CHECK ((relationship_type = ANY (ARRAY['billing_contact'::text, 'signatory'::text, 'director'::text, 'representative'::text, 'external_contact'::text, 'other'::text])))$check$ THEN
    RAISE EXCEPTION 'registered company contact role constraint drift';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)'::regprocedure,
      'public.crm_company_backfill_billing_cld(uuid)'::regprocedure,
      'public.crm_company_upsert_from_billing(uuid)'::regprocedure
    ) AND (NOT p.prosecdef OR NOT COALESCE('search_path=public' = ANY(p.proconfig), false))
  ) THEN RAISE EXCEPTION 'canonical writer security configuration drift'; END IF;
  IF NOT has_function_privilege('authenticated','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.crm_company_link_contact(uuid,uuid,text,boolean,text,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.crm_company_backfill_billing_cld(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.crm_company_backfill_billing_cld(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_backfill_billing_cld(uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.crm_company_upsert_from_billing(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.crm_company_upsert_from_billing(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'canonical writer ACL drift';
  END IF;
END $preflight$;

-- The existing UI already names employee, but the registered-profile relation
-- rejected it. Extend only its taxonomy; billing guards and all RLS/ACL stay.
-- No profile/contact is created by this migration.
ALTER TABLE public.company_contacts
  DROP CONSTRAINT company_contacts_relationship_type_check,
  ADD CONSTRAINT company_contacts_relationship_type_check CHECK (relationship_type IN (
    'billing_contact', 'signatory', 'director', 'representative', 'external_contact', 'other', 'employee'
  ));

-- Retain the map and the legal details. Archive only the mistaken CRM edge.
-- RESTRICT deliberately prevents deletion/retargeting of its audit lineage.
CREATE TABLE public.crm_company_billing_link_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  client_legal_details_id uuid NOT NULL REFERENCES public.client_legal_details(id) ON DELETE RESTRICT,
  map_id uuid NOT NULL REFERENCES public.client_legal_details_company_map(id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL,
  contact_snapshot jsonb NOT NULL CHECK (jsonb_typeof(contact_snapshot) = 'object'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE UNIQUE INDEX crm_company_billing_suppression_active
  ON public.crm_company_billing_link_suppressions(company_id, profile_id, client_legal_details_id)
  WHERE revoked_at IS NULL;
CREATE INDEX crm_company_billing_suppression_map
  ON public.crm_company_billing_link_suppressions(map_id) WHERE revoked_at IS NULL;
ALTER TABLE public.crm_company_billing_link_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_company_billing_link_suppressions FROM PUBLIC, anon, authenticated, service_role;
-- Only guarded SECURITY DEFINER functions write this private history.
GRANT SELECT ON public.crm_company_billing_link_suppressions TO authenticated;
CREATE POLICY crm_company_billing_suppression_admin_read
  ON public.crm_company_billing_link_suppressions FOR SELECT TO authenticated
  USING (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin'));

-- Also protect callers that write the table directly instead of using the RPC.
CREATE FUNCTION public._crm_company_guard_suppressed_billing_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Same company lock as the canonical linker and correction RPCs. BEFORE INSERT
  -- executes before insertion, so either writer-first or unlink-first is safe.
  PERFORM 1 FROM public.companies WHERE id = NEW.company_id FOR UPDATE;
  IF NEW.relationship_type = 'billing_contact' AND EXISTS (
    SELECT 1 FROM public.crm_company_billing_link_suppressions s
    WHERE s.company_id = NEW.company_id AND s.profile_id = NEW.profile_id
      AND s.map_id = NEW.source_client_legal_details_map_id AND s.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'billing contact is explicitly unlinked; restore it first' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._crm_company_guard_suppressed_billing_contact() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER crm_company_guard_suppressed_billing_contact
  BEFORE INSERT OR UPDATE ON public.company_contacts
  FOR EACH ROW EXECUTE FUNCTION public._crm_company_guard_suppressed_billing_contact();

CREATE FUNCTION public._crm_company_guard_suppressed_billing_map()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.company_id IS DISTINCT FROM OLD.company_id
      OR NEW.client_legal_details_id IS DISTINCT FROM OLD.client_legal_details_id
      OR NEW.id IS DISTINCT FROM OLD.id)
     AND EXISTS (SELECT 1 FROM public.crm_company_billing_link_suppressions s
                 WHERE s.map_id = OLD.id AND s.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'map has an active billing contact unlink; resolve before retargeting or merge'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._crm_company_guard_suppressed_billing_map() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER crm_company_guard_suppressed_billing_map
  BEFORE UPDATE ON public.client_legal_details_company_map
  FOR EACH ROW EXECUTE FUNCTION public._crm_company_guard_suppressed_billing_map();

CREATE FUNCTION public.crm_company_unlink_billing_contact(
  _company_id uuid, _profile_id uuid, _client_legal_details_id uuid,
  _expected_contact_id uuid, _reason text, _initiator_user_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_service boolean := COALESCE(auth.role() = 'service_role', false);
  v_actor uuid;
  v_cld public.client_legal_details%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_map public.client_legal_details_company_map%ROWTYPE;
  v_contact public.company_contacts%ROWTYPE;
  v_s public.crm_company_billing_link_suppressions%ROWTYPE;
  v_id uuid;
  v_count integer;
BEGIN
  -- Managed Lovable Cloud operations use their existing service identity.
  -- Require an explicit administrator initiator instead of fabricating a user
  -- JWT/auth.uid(). Interactive calls always retain their actual auth.uid().
  v_actor := CASE WHEN v_service THEN _initiator_user_id ELSE auth.uid() END;
  IF NOT v_service AND _initiator_user_id IS NOT NULL
     AND _initiator_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'forbidden: cannot override interactive initiator' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL OR NOT COALESCE(public.has_role_v2(v_actor, 'admin')
       OR public.has_role_v2(v_actor, 'super_admin'), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _company_id IS NULL OR _profile_id IS NULL OR _client_legal_details_id IS NULL
     OR _expected_contact_id IS NULL OR _reason IS NULL
     OR length(btrim(_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'exact identifiers and a reason (1..500 characters) are required' USING ERRCODE = '22023';
  END IF;

  -- Match worker order: CLD -> company -> advisory -> map -> contact.
  -- Taking the advisory lock before CLD/company would deadlock with backfill.
  SELECT * INTO v_cld FROM public.client_legal_details WHERE id = _client_legal_details_id FOR UPDATE;
  IF NOT FOUND OR v_cld.profile_id IS DISTINCT FROM _profile_id
     OR v_cld.purpose IS DISTINCT FROM 'billing'
     OR v_cld.client_type NOT IN ('legal_entity', 'entrepreneur') THEN
    RAISE EXCEPTION 'billing details/owner mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_company FROM public.companies WHERE id = _company_id FOR UPDATE;
  IF NOT FOUND OR v_company.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'company must be active' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'crm_company_link_contact:' || _company_id::text || ':' || _profile_id::text || ':billing_contact', 0));
  SELECT * INTO v_map FROM public.client_legal_details_company_map
    WHERE client_legal_details_id = _client_legal_details_id FOR UPDATE;
  IF NOT FOUND OR v_map.company_id IS DISTINCT FROM _company_id THEN
    RAISE EXCEPTION 'map/company mismatch' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_s FROM public.crm_company_billing_link_suppressions
    WHERE company_id = _company_id AND profile_id = _profile_id
      AND client_legal_details_id = _client_legal_details_id AND revoked_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF v_s.contact_id IS DISTINCT FROM _expected_contact_id OR v_s.map_id IS DISTINCT FROM v_map.id
       OR EXISTS (SELECT 1 FROM public.company_contacts WHERE company_id = _company_id AND profile_id = _profile_id) THEN
      RAISE EXCEPTION 'unlink retry conflicts with current state' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('suppression_id', v_s.id, 'unlinked', 0, 'already_unlinked', true);
  END IF;

  SELECT * INTO v_contact FROM public.company_contacts WHERE id = _expected_contact_id FOR UPDATE;
  IF NOT FOUND OR v_contact.company_id IS DISTINCT FROM _company_id
     OR v_contact.profile_id IS DISTINCT FROM _profile_id
     OR v_contact.relationship_type IS DISTINCT FROM 'billing_contact'
     OR v_contact.source IS DISTINCT FROM 'billing_requisites'
     OR v_contact.is_billing_contact IS DISTINCT FROM true
     OR v_contact.source_client_legal_details_map_id IS DISTINCT FROM v_map.id THEN
    RAISE EXCEPTION 'expected billing contact mismatch' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.company_contacts WHERE company_id = _company_id AND profile_id = _profile_id) <> 1 THEN
    RAISE EXCEPTION 'profile has other company relationships; review before unlink' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.crm_company_billing_link_suppressions (
    company_id, profile_id, client_legal_details_id, map_id, contact_id, contact_snapshot, reason, created_by
  ) VALUES (_company_id, _profile_id, _client_legal_details_id, v_map.id,
            v_contact.id, to_jsonb(v_contact), btrim(_reason), v_actor) RETURNING id INTO v_id;
  DELETE FROM public.company_contacts WHERE id = _expected_contact_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN RAISE EXCEPTION 'expected exactly one unlinked contact' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type, user_id, idempotency_key, metadata)
    VALUES ('company.billing_contact_unlinked', _company_id, 'company', v_actor,
            'company.billing_contact_unlinked:' || v_id::text,
            jsonb_build_object('suppression_id', v_id, 'contact_id', _expected_contact_id,
              'execution_role', auth.role(), 'initiator_user_id', v_actor));
  RETURN jsonb_build_object('suppression_id', v_id, 'unlinked', v_count, 'already_unlinked', false);
END $$;
REVOKE ALL ON FUNCTION public.crm_company_unlink_billing_contact(uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_company_unlink_billing_contact(uuid,uuid,uuid,uuid,text,uuid) TO authenticated, service_role;

CREATE FUNCTION public.crm_company_restore_billing_contact(_suppression_id uuid, _initiator_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_service boolean := COALESCE(auth.role() = 'service_role', false);
  v_actor uuid;
  v_s public.crm_company_billing_link_suppressions%ROWTYPE;
  v_contact public.company_contacts%ROWTYPE;
  v_owner uuid;
  v_company uuid;
  v_status text;
BEGIN
  v_actor := CASE WHEN v_service THEN _initiator_user_id ELSE auth.uid() END;
  IF NOT v_service AND _initiator_user_id IS NOT NULL
     AND _initiator_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'forbidden: cannot override interactive initiator' USING ERRCODE = '42501';
  END IF;
  IF v_actor IS NULL OR NOT COALESCE(public.has_role_v2(v_actor, 'admin')
       OR public.has_role_v2(v_actor, 'super_admin'), false) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- Initial read only obtains immutable lock selectors. Re-read after locking.
  SELECT * INTO v_s FROM public.crm_company_billing_link_suppressions WHERE id = _suppression_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unlink record not found' USING ERRCODE = '22023'; END IF;
  SELECT profile_id INTO v_owner FROM public.client_legal_details WHERE id = v_s.client_legal_details_id FOR UPDATE;
  IF NOT FOUND OR v_owner IS DISTINCT FROM v_s.profile_id THEN
    RAISE EXCEPTION 'billing owner changed; review before restore' USING ERRCODE = '23514';
  END IF;
  SELECT status INTO v_status FROM public.companies WHERE id = v_s.company_id FOR UPDATE;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'company must be active' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'crm_company_link_contact:' || v_s.company_id::text || ':' || v_s.profile_id::text || ':billing_contact', 0));
  SELECT company_id INTO v_company FROM public.client_legal_details_company_map
    WHERE id = v_s.map_id AND client_legal_details_id = v_s.client_legal_details_id FOR UPDATE;
  IF NOT FOUND OR v_company IS DISTINCT FROM v_s.company_id THEN
    RAISE EXCEPTION 'map changed; review before restore' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_s FROM public.crm_company_billing_link_suppressions WHERE id = _suppression_id FOR UPDATE;
  IF v_s.revoked_at IS NOT NULL THEN
    -- Exact retries are read-only. Never clear a later suppression.
    IF NOT EXISTS (SELECT 1 FROM public.company_contacts c
                   WHERE c.id = v_s.contact_id AND to_jsonb(c) = v_s.contact_snapshot) THEN
      RAISE EXCEPTION 'restore retry conflicts with current state' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object('contact_id', v_s.contact_id, 'restored', 0, 'already_restored', true);
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_contacts WHERE company_id = v_s.company_id AND profile_id = v_s.profile_id)
     OR EXISTS (SELECT 1 FROM public.company_contacts WHERE id = v_s.contact_id) THEN
    RAISE EXCEPTION 'contact conflict; review before restore' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_contact FROM jsonb_populate_record(NULL::public.company_contacts, v_s.contact_snapshot);
  UPDATE public.crm_company_billing_link_suppressions SET revoked_at = now(), revoked_by = v_actor WHERE id = v_s.id;
  INSERT INTO public.company_contacts SELECT v_contact.*;
  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type, user_id, idempotency_key, metadata)
    VALUES ('company.billing_contact_restored', v_s.company_id, 'company', v_actor,
            'company.billing_contact_restored:' || v_s.id::text,
            jsonb_build_object('suppression_id', v_s.id, 'contact_id', v_s.contact_id,
              'execution_role', auth.role(), 'initiator_user_id', v_actor));
  RETURN jsonb_build_object('contact_id', v_s.contact_id, 'restored', 1, 'already_restored', false);
END $$;
REVOKE ALL ON FUNCTION public.crm_company_restore_billing_contact(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_company_restore_billing_contact(uuid,uuid) TO authenticated, service_role;

-- Canonical writers, with only the suppression check/result change.
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

  -- The company row lock is acquired before the existing advisory lock.
  -- Serialize with unlink/restore; never resurrect an explicitly detached source.
  IF _relationship_type = 'billing_contact' AND EXISTS (
    SELECT 1 FROM public.crm_company_billing_link_suppressions s
    WHERE s.company_id = _company_id AND s.profile_id = _profile_id
      AND s.map_id = _source_client_legal_details_map_id AND s.revoked_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

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
    'contact_created',         v_contact_id IS NOT NULL AND v_contact_pre IS NULL,
    'contact_reused',          v_contact_id IS NOT NULL AND v_contact_pre IS NOT NULL,
    'contact_suppressed',      v_contact_id IS NULL,
    'writer',                  'crm_company_backfill_billing_cld',
    'writer_version',          1
  );
END
$fn$;

COMMIT;
