
-- =====================================================================
-- PATCH D.1 — atomic default-setter RPCs for v2 requisites tables.
--
-- These RPCs replace client-side "unset others, then set target" two-step
-- write sequences with a single transactional operation.
--
-- Security:
--  * SECURITY DEFINER + EXECUTE granted only to authenticated.
--  * Caller is verified through public.user_tenant_ids(auth.uid()).
--  * Admins/super_admins are also allowed via has_role_v2.
--  * Audit entry is written without secret/PII payload — only id, scope,
--    subject_type and tenant_id.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_default_legal_entity_requisites(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_row          public.legal_entities_requisites%ROWTYPE;
  v_is_admin     boolean := false;
  v_authorised   boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.legal_entities_requisites
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'requisites_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Permission: owner via tenant_membership OR admin/super_admin.
  v_is_admin := public.has_role_v2(v_uid, 'admin')
             OR public.has_role_v2(v_uid, 'super_admin');

  v_authorised := v_is_admin
    OR v_row.tenant_id IN (SELECT public.user_tenant_ids(v_uid));

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Atomic: clear previous default in same (tenant, scope, subject_type),
  -- then set the target row as default.
  UPDATE public.legal_entities_requisites
     SET is_default = false,
         updated_by = v_uid
   WHERE tenant_id   = v_row.tenant_id
     AND scope       = v_row.scope
     AND subject_type = v_row.subject_type
     AND is_default  = true
     AND id <> v_row.id;

  UPDATE public.legal_entities_requisites
     SET is_default = true,
         updated_by = v_uid
   WHERE id = v_row.id;

  -- Audit (no secrets / no `data` payload).
  INSERT INTO public.audit_logs (
    user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_uid,
    'requisites.set_default',
    'legal_entities_requisites',
    v_row.id,
    jsonb_build_object(
      'tenant_id',    v_row.tenant_id,
      'scope',        v_row.scope,
      'subject_type', v_row.subject_type,
      'via_admin',    v_is_admin
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'scope', v_row.scope,
    'subject_type', v_row.subject_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_legal_entity_requisites(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_legal_entity_requisites(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.set_default_individual_requisites(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_row          public.individual_requisites%ROWTYPE;
  v_is_admin     boolean := false;
  v_authorised   boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.individual_requisites
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'requisites_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := public.has_role_v2(v_uid, 'admin')
             OR public.has_role_v2(v_uid, 'super_admin');

  v_authorised := v_is_admin
    OR v_row.tenant_id IN (SELECT public.user_tenant_ids(v_uid));

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.individual_requisites
     SET is_default = false,
         updated_by = v_uid
   WHERE tenant_id  = v_row.tenant_id
     AND scope      = v_row.scope
     AND is_default = true
     AND id <> v_row.id;

  UPDATE public.individual_requisites
     SET is_default = true,
         updated_by = v_uid
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs (
    user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_uid,
    'requisites.set_default',
    'individual_requisites',
    v_row.id,
    jsonb_build_object(
      'tenant_id', v_row.tenant_id,
      'scope',     v_row.scope,
      'via_admin', v_is_admin
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'scope', v_row.scope
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_individual_requisites(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_individual_requisites(uuid) TO authenticated;
