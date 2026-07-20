-- Companies Phase 7C: explicit restore for archived companies.
-- Merged sources remain permanently non-restorable through this RPC.

CREATE OR REPLACE FUNCTION public.crm_company_restore(_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.companies%ROWTYPE;
BEGIN
  IF NOT (has_role_v2(auth.uid(),'admin') OR has_role_v2(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_row FROM public.companies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_row.status = 'merged' THEN
    RAISE EXCEPTION 'merged company cannot be restored' USING ERRCODE='22023';
  END IF;
  IF v_row.status = 'active' THEN RETURN _id; END IF;

  UPDATE public.companies
     SET status = 'active', archived_at = NULL,
         updated_at = now(), updated_by = auth.uid()
   WHERE id = _id;

  PERFORM public._crm_company_emit_domain_event(
    'company.restored.v1', _id,
    'company.restored:' || _id::text,
    jsonb_build_object('version', 1, 'company_id', _id, 'occurred_at', now(), 'actor_user_id', auth.uid())
  );
  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, entity_id, meta)
  VALUES (auth.uid(), 'company.restore', 'user', 'company', _id::text, '{}'::jsonb);
  INSERT INTO public.crm_activity_log(activity_type, source_entity_id, source_entity_type,
                                      user_id, idempotency_key, metadata)
  VALUES ('company.restored', _id, 'company', auth.uid(), 'company.restored:' || _id::text, '{}'::jsonb)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_restore(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_restore(uuid) TO authenticated;
