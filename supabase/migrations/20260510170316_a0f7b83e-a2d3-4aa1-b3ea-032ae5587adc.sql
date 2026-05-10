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

  v_is_admin := public.has_role_v2(v_uid, 'admin')
             OR public.has_role_v2(v_uid, 'super_admin');

  v_authorised := v_is_admin
    OR v_row.tenant_id IN (SELECT public.user_tenant_ids(v_uid));

  IF NOT v_authorised THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

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

  INSERT INTO public.audit_logs (
    actor_user_id, actor_type, actor_label, action, meta
  ) VALUES (
    v_uid,
    'user',
    CASE WHEN v_is_admin THEN 'admin_set_default' ELSE 'owner_set_default' END,
    'requisites.set_default',
    jsonb_build_object(
      'entity_type',  'legal_entities_requisites',
      'entity_id',    v_row.id,
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
    actor_user_id, actor_type, actor_label, action, meta
  ) VALUES (
    v_uid,
    'user',
    CASE WHEN v_is_admin THEN 'admin_set_default' ELSE 'owner_set_default' END,
    'requisites.set_default',
    jsonb_build_object(
      'entity_type', 'individual_requisites',
      'entity_id',   v_row.id,
      'tenant_id',   v_row.tenant_id,
      'scope',       v_row.scope,
      'via_admin',   v_is_admin
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'scope', v_row.scope
  );
END;
$$;