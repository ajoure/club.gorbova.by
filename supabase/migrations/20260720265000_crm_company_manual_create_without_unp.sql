-- Allow the canonical requisites form to create a manual company before a UNP
-- is available. The existing billing/GRP path remains unchanged when a UNP is
-- present; this RPC only writes the canonical CRM company record.

CREATE OR REPLACE FUNCTION public.crm_company_create_manual(
  _company_kind text,
  _full_name text,
  _short_name text DEFAULT NULL,
  _legal_form text DEFAULT NULL,
  _country text DEFAULT 'BY',
  _unp text DEFAULT NULL,
  _legal_address text DEFAULT NULL,
  _director_name text DEFAULT NULL,
  _director_position text DEFAULT NULL,
  _acts_on_basis text DEFAULT NULL,
  _bank_account text DEFAULT NULL,
  _bank_name text DEFAULT NULL,
  _bank_code text DEFAULT NULL,
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_full_name text;
  v_short_name text;
  v_legal_form text;
  v_unp text;
  v_country text := upper(NULLIF(btrim(coalesce(_country, 'BY')), ''));
BEGIN
  IF NOT (
    has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin')
    OR has_role_v2(v_uid, 'menedzher')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _company_kind NOT IN ('legal_entity', 'entrepreneur') THEN
    RAISE EXCEPTION 'invalid company_kind' USING ERRCODE = '22023';
  END IF;

  v_full_name := NULLIF(btrim(regexp_replace(
    regexp_replace(btrim(coalesce(_full_name, '')), '[«»“”„‟"]', '', 'g'),
    '[[:space:]]+', ' ', 'g'
  )), '');
  v_full_name := btrim(regexp_replace(coalesce(v_full_name, ''), '^[-,;:[:space:]]+|[-,;:[:space:]]+$', '', 'g'));
  v_legal_form := NULLIF(btrim(regexp_replace(coalesce(_legal_form, ''), '[[:space:]]+', ' ', 'g')), '');

  -- Keep the CRM name free of legal-form prefixes/suffixes. The form remains
  -- in legal_form so list and profile views stay consistent with registry data.
  IF v_full_name ~* '^(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|УП|ЧУП|КУП|РУП|ТУП|ИП)([[:space:]]|$)' THEN
    IF v_legal_form IS NULL THEN
      v_legal_form := upper((regexp_match(v_full_name, '^(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|УП|ЧУП|КУП|РУП|ТУП|ИП)'))[1]);
    END IF;
    v_full_name := btrim(regexp_replace(v_full_name, '^(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|УП|ЧУП|КУП|РУП|ТУП|ИП)([[:space:]]+)', '', 'i'));
  ELSIF v_full_name ~* ',?[[:space:]]*(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|УП|ЧУП|КУП|РУП|ТУП|ИП)[[:space:]]*$' THEN
    IF v_legal_form IS NULL THEN
      v_legal_form := upper((regexp_match(v_full_name, '(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|УП|ЧУП|КУП|РУП|ТУП|ИП)[[:space:]]*$'))[1]);
    END IF;
    v_full_name := btrim(regexp_replace(v_full_name, ',?[[:space:]]*(ООО|ОДО|ЗАО|ОАО|СООО|ИООО|УП|ЧУП|КУП|РУП|ТУП|ИП)[[:space:]]*$', '', 'i'));
  END IF;
  IF v_full_name = '' THEN
    RAISE EXCEPTION 'full_name is required' USING ERRCODE = '23514';
  END IF;
  v_short_name := NULLIF(btrim(regexp_replace(
    regexp_replace(btrim(coalesce(_short_name, '')), '[«»“”„‟"]', '', 'g'),
    '[[:space:]]+', ' ', 'g'
  )), '');
  v_unp := NULLIF(regexp_replace(coalesce(_unp, ''), '[^0-9]', '', 'g'), '');
  IF v_unp IS NOT NULL AND length(v_unp) <> 9 THEN
    RAISE EXCEPTION 'invalid unp' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.companies (
    workspace_id, company_kind, country, unp_normalized, full_name,
    short_name, legal_form, legal_address, director_name, director_position,
    acts_on_basis, bank_account, bank_name, bank_code, email, phone,
    metadata, created_by, updated_by
  ) VALUES (
    '00000000-0000-0000-0000-000000000001'::uuid,
    _company_kind, coalesce(v_country, 'BY'), v_unp, v_full_name,
    v_short_name, v_legal_form, NULLIF(btrim(_legal_address), ''),
    NULLIF(btrim(_director_name), ''), NULLIF(btrim(_director_position), ''),
    NULLIF(btrim(_acts_on_basis), ''), NULLIF(btrim(_bank_account), ''),
    NULLIF(btrim(_bank_name), ''), NULLIF(btrim(_bank_code), ''),
    NULLIF(btrim(_email), ''), NULLIF(btrim(_phone), ''),
    jsonb_build_object('created_source', 'manual'), v_uid, v_uid
  ) RETURNING id INTO v_id;

  INSERT INTO public.crm_activity_log (
    activity_type, source_entity_id, source_entity_type, user_id,
    idempotency_key, metadata
  ) VALUES (
    'company.created', v_id, 'company', v_uid,
    'company.created:' || v_id::text,
    jsonb_build_object('source', 'manual', 'unp_present', v_unp IS NOT NULL)
  );
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_company_create_manual(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_create_manual(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;
