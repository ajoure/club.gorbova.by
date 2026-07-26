-- Companies Phase 7: route manual edits through a guarded, auditable RPC.
-- The UI must not update canonical company rows directly: merge/archive have
-- dedicated invariants and this function keeps ordinary edits equally safe.

CREATE OR REPLACE FUNCTION public.crm_company_update(
  _id uuid,
  _full_name text,
  _short_name text DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.companies%ROWTYPE;
  v_full_name text := NULLIF(btrim(_full_name), '');
  v_short_name text := NULLIF(btrim(_short_name), '');
  v_email text := NULLIF(btrim(_email), '');
  v_phone text := NULLIF(btrim(_phone), '');
  v_changed jsonb;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin')
       OR has_role_v2(auth.uid(),'super_admin')
       OR has_role_v2(auth.uid(),'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'full_name required' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_row FROM public.companies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_row.status = 'merged' THEN
    RAISE EXCEPTION 'merged company cannot be edited' USING ERRCODE='22023';
  END IF;

  v_changed := jsonb_strip_nulls(jsonb_build_object(
    'full_name', CASE WHEN v_row.full_name IS DISTINCT FROM v_full_name THEN jsonb_build_object('from', v_row.full_name, 'to', v_full_name) END,
    'short_name', CASE WHEN v_row.short_name IS DISTINCT FROM v_short_name THEN jsonb_build_object('from', v_row.short_name, 'to', v_short_name) END,
    'email', CASE WHEN v_row.email IS DISTINCT FROM v_email THEN jsonb_build_object('from', v_row.email, 'to', v_email) END,
    'phone', CASE WHEN v_row.phone IS DISTINCT FROM v_phone THEN jsonb_build_object('from', v_row.phone, 'to', v_phone) END
  ));

  IF v_changed = '{}'::jsonb THEN RETURN _id; END IF;

  UPDATE public.companies
     SET full_name = v_full_name,
         short_name = v_short_name,
         email = v_email,
         phone = v_phone,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE id = _id;

  PERFORM public._crm_company_emit_domain_event(
    'company.updated.v1',
    _id,
    'company.updated:' || _id::text || ':' || md5(v_changed::text),
    jsonb_build_object(
      'version', 1,
      'company_id', _id,
      'changed_fields', v_changed,
      'occurred_at', now(),
      'actor_user_id', auth.uid()
    )
  );

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, entity_id, meta)
  VALUES (
    auth.uid(), 'company.update', 'user', 'company', _id::text,
    jsonb_build_object('changed_fields', v_changed)
  );

  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type,
                                      user_id, idempotency_key, metadata)
  VALUES (
    'company.updated', _id, 'company', auth.uid(),
    'company.updated:' || _id::text || ':' || md5(v_changed::text),
    jsonb_build_object('changed_fields', v_changed)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_update(uuid,text,text,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_update(uuid,text,text,text,text) TO authenticated;
