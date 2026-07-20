-- Guarded registry refresh for a canonical company card.
-- Only registry fields and the registry-provided identity/address are changed.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_company_registry_refresh(
  _id uuid,
  _full_name text DEFAULT NULL,
  _short_name text DEFAULT NULL,
  _legal_form text DEFAULT NULL,
  _legal_address text DEFAULT NULL,
  _grp_status_code text DEFAULT NULL,
  _grp_status_name text DEFAULT NULL,
  _grp_registration_date date DEFAULT NULL,
  _grp_tax_office_code text DEFAULT NULL,
  _grp_tax_office_name text DEFAULT NULL,
  _grp_liquidation_date date DEFAULT NULL,
  _grp_liquidation_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_company public.companies%ROWTYPE;
BEGIN
  IF NOT (has_role_v2(v_actor,'super_admin') OR has_role_v2(v_actor,'admin') OR has_role_v2(v_actor,'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_company FROM public.companies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company_not_found' USING ERRCODE='23503'; END IF;
  IF v_company.status = 'merged' THEN RAISE EXCEPTION 'merged_company_cannot_refresh' USING ERRCODE='22023'; END IF;

  UPDATE public.companies
     SET full_name = COALESCE(NULLIF(btrim(_full_name), ''), full_name),
         short_name = COALESCE(NULLIF(btrim(_short_name), ''), short_name),
         legal_form = COALESCE(NULLIF(btrim(_legal_form), ''), legal_form),
         legal_address = COALESCE(NULLIF(btrim(_legal_address), ''), legal_address),
         grp_status_code = _grp_status_code,
         grp_status_name = _grp_status_name,
         grp_registration_date = _grp_registration_date,
         grp_tax_office_code = _grp_tax_office_code,
         grp_tax_office_name = _grp_tax_office_name,
         grp_liquidation_date = _grp_liquidation_date,
         grp_liquidation_reason = _grp_liquidation_reason,
         grp_last_fetched_at = now(),
         updated_at = now(),
         updated_by = v_actor
   WHERE id = _id;

  INSERT INTO public.crm_activity_log(
    activity_type, source_entity_id, source_entity_type, user_id,
    idempotency_key, metadata
  ) VALUES (
    'company.registry_refreshed', _id, 'company', v_actor,
    'company.registry_refreshed:' || _id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISSMS'),
    jsonb_build_object('source', 'grp-lookup', 'unp', v_company.unp_normalized)
  );
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_registry_refresh(uuid,text,text,text,text,text,text,date,text,text,date,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_registry_refresh(uuid,text,text,text,text,text,text,date,text,text,date,text)
  TO authenticated;

COMMIT;
