-- Keep the company edit flow aligned with the requisites form: the displayed
-- name and the organizational/legal form are stored as separate fields.

CREATE OR REPLACE FUNCTION public.crm_company_update(
  _id uuid,
  _full_name text,
  _short_name text,
  _email text,
  _phone text,
  _legal_form text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row public.companies%ROWTYPE;
  v_form text := NULLIF(btrim(_legal_form), '');
  v_changed jsonb;
BEGIN
  IF NOT (has_role_v2(v_actor,'admin') OR has_role_v2(v_actor,'super_admin') OR has_role_v2(v_actor,'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_row FROM public.companies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_row.status = 'merged' THEN RAISE EXCEPTION 'merged company cannot be edited' USING ERRCODE='22023'; END IF;

  -- Reuse the already guarded/audited five-field edit path for the canonical
  -- mutable fields; this overload only adds the separate legal-form field.
  PERFORM public.crm_company_update(_id, _full_name, _short_name, _email, _phone);

  IF v_row.legal_form IS NOT DISTINCT FROM v_form THEN
    RETURN _id;
  END IF;

  v_changed := jsonb_build_object(
    'legal_form', jsonb_build_object('from', v_row.legal_form, 'to', v_form)
  );

  UPDATE public.companies
     SET legal_form = v_form,
         updated_at = now(),
         updated_by = v_actor
   WHERE id = _id;

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, entity_id, meta)
  VALUES (v_actor, 'company.update', 'user', 'company', _id::text,
          jsonb_build_object('changed_fields', v_changed));

  INSERT INTO public.crm_activity_log(
    activity_type, source_entity_id, source_entity_type, user_id,
    idempotency_key, metadata
  ) VALUES (
    'company.updated', _id, 'company', v_actor,
    'company.updated:' || _id::text || ':' || md5(v_changed::text),
    jsonb_build_object('changed_fields', v_changed)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_update(uuid,text,text,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_update(uuid,text,text,text,text,text)
  TO authenticated;
