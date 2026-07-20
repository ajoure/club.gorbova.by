-- Companies Phase 8C: admin entrypoint for the existing billing requisites flow.
-- The UI still writes the canonical client_legal_details record through the
-- existing form/hooks. This guarded wrapper then reuses the existing service
-- synchronizer so GRP fields, billing snapshot, company map and audit lineage
-- are populated by one path.

CREATE OR REPLACE FUNCTION public.crm_company_create_from_billing(
  _client_legal_details_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF NOT (has_role_v2(v_uid, 'super_admin')
       OR has_role_v2(v_uid, 'admin')
       OR has_role_v2(v_uid, 'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.client_legal_details cld
     WHERE cld.id = _client_legal_details_id
       AND cld.purpose = 'billing'
       AND cld.client_type IN ('legal_entity', 'entrepreneur')
  ) THEN
    RAISE EXCEPTION 'billing legal details not found' USING ERRCODE = '23503';
  END IF;

  -- Existing service-role-only function is intentionally reused here under
  -- SECURITY DEFINER; no second company synchronization implementation exists.
  v_id := public.crm_company_upsert_from_billing(_client_legal_details_id);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.crm_company_create_from_billing(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_create_from_billing(uuid)
  TO authenticated;
