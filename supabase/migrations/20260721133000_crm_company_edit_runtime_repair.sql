-- Runtime repair for the Companies edit path.
--
-- The UI calls the six-argument overload (including legal_form), while an
-- older managed database may still expose only the five-argument overload.
-- Re-declare both signatures, keep the audit/domain-event contract intact,
-- and explicitly reload PostgREST's schema cache after the migration.

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
  v_actor uuid := auth.uid();
  v_row public.companies%ROWTYPE;
  v_full_name text := NULLIF(btrim(_full_name), '');
  v_short_name text := NULLIF(btrim(_short_name), '');
  v_email text := NULLIF(btrim(_email), '');
  v_phone text := NULLIF(btrim(_phone), '');
  v_changed jsonb;
  v_idempotency_key text;
BEGIN
  IF NOT (has_role_v2(v_actor,'admin')
       OR has_role_v2(v_actor,'super_admin')
       OR has_role_v2(v_actor,'menedzher')) THEN
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

  v_idempotency_key := 'company.updated:' || _id::text || ':' || md5(v_changed::text);

  UPDATE public.companies
     SET full_name = v_full_name,
         short_name = v_short_name,
         email = v_email,
         phone = v_phone,
         updated_at = now(),
         updated_by = v_actor
   WHERE id = _id;

  PERFORM public._crm_company_emit_domain_event(
    'company.updated.v1', _id, v_idempotency_key,
    jsonb_build_object(
      'version', 1,
      'company_id', _id,
      'changed_fields', v_changed,
      'occurred_at', now(),
      'actor_user_id', v_actor,
      'idempotency_key', v_idempotency_key
    )
  );

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, entity_id, meta)
  VALUES (v_actor, 'company.update', 'user', 'company', _id::text,
          jsonb_build_object('changed_fields', v_changed));

  INSERT INTO public.crm_activity_log(
    activity_type, source_entity_id, source_entity_type, user_id,
    idempotency_key, metadata
  ) VALUES (
    'company.updated', _id, 'company', v_actor, v_idempotency_key,
    jsonb_build_object('changed_fields', v_changed)
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN _id;
END;
$$;

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
  v_full_name text;
  v_short_name text;
  v_form text := NULLIF(btrim(_legal_form), '');
  v_changed jsonb;
BEGIN
  IF NOT (has_role_v2(v_actor,'admin')
       OR has_role_v2(v_actor,'super_admin')
       OR has_role_v2(v_actor,'menedzher')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_row FROM public.companies WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'company not found' USING ERRCODE='23503'; END IF;
  IF v_row.status = 'merged' THEN
    RAISE EXCEPTION 'merged company cannot be edited' USING ERRCODE='22023';
  END IF;

  v_full_name := NULLIF(btrim(regexp_replace(
    regexp_replace(btrim(coalesce(_full_name, '')), '[«»“”„‟"]', '', 'g'),
    '\s+', ' ', 'g'
  )), '');
  v_full_name := btrim(regexp_replace(v_full_name, '^[,;:\-\s]+|[,;:\-\s]+$', '', 'g'));
  IF v_form IS NULL AND v_full_name ~* '^(общество[[:space:]]+с[[:space:]]+ограниченной[[:space:]]+ответственностью|закрытое[[:space:]]+акционерное[[:space:]]+общество|открытое[[:space:]]+акционерное[[:space:]]+общество|публичное[[:space:]]+акционерное[[:space:]]+общество|акционерное[[:space:]]+общество|частное[[:space:]]+унитарное[[:space:]]+предприятие)([[:space:]]|$)' THEN
    v_form := CASE
      WHEN v_full_name ~* '^общество[[:space:]]+с[[:space:]]+ограниченной' THEN 'ООО'
      WHEN v_full_name ~* '^закрытое[[:space:]]+акционерное' THEN 'ЗАО'
      WHEN v_full_name ~* '^открытое[[:space:]]+акционерное' THEN 'ОАО'
      WHEN v_full_name ~* '^публичное[[:space:]]+акционерное' THEN 'ПАО'
      WHEN v_full_name ~* '^частное[[:space:]]+унитарное' THEN 'ЧУП'
      ELSE 'АО'
    END;
  END IF;
  v_full_name := btrim(regexp_replace(v_full_name,
    '^(общество[[:space:]]+с[[:space:]]+ограниченной[[:space:]]+ответственностью|закрытое[[:space:]]+акционерное[[:space:]]+общество|открытое[[:space:]]+акционерное[[:space:]]+общество|публичное[[:space:]]+акционерное[[:space:]]+общество|акционерное[[:space:]]+общество|частное[[:space:]]+унитарное[[:space:]]+предприятие)[[:space:]]*[,;:\-]?[[:space:]]*', '', 'i'));
  IF v_full_name ~* '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)([[:space:]]|$)' THEN
    IF v_form IS NULL THEN v_form := upper((regexp_match(v_full_name, '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)([[:space:]]|$)', 'i'))[1]); END IF;
    v_full_name := btrim(regexp_replace(v_full_name, '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*[,;:\-]?\s*', '', 'i'));
  ELSIF v_full_name ~* ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$' THEN
    IF v_form IS NULL THEN v_form := upper((regexp_match(v_full_name, ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$', 'i'))[1]); END IF;
    v_full_name := btrim(regexp_replace(v_full_name, ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$', '', 'i'));
  END IF;
  v_short_name := NULLIF(btrim(regexp_replace(
    regexp_replace(btrim(coalesce(_short_name, '')), '[«»“”„‟"]', '', 'g'),
    '\s+', ' ', 'g'
  )), '');
  IF v_short_name IS NOT NULL THEN
    v_short_name := btrim(regexp_replace(v_short_name,
      ',?[[:space:]]*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)[[:space:]]*$', '', 'i'));
  END IF;
  IF v_full_name IS NULL THEN RAISE EXCEPTION 'full_name required' USING ERRCODE='22023'; END IF;

  PERFORM public.crm_company_update(_id, v_full_name, v_short_name, _email, _phone);

  IF v_row.legal_form IS NOT DISTINCT FROM v_form THEN RETURN _id; END IF;

  v_changed := jsonb_build_object(
    'legal_form', jsonb_build_object('from', v_row.legal_form, 'to', v_form)
  );
  UPDATE public.companies
     SET legal_form = v_form, updated_at = now(), updated_by = v_actor
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

REVOKE ALL ON FUNCTION public.crm_company_update(uuid,text,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_update(uuid,text,text,text,text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.crm_company_update(uuid,text,text,text,text,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.crm_company_update(uuid,text,text,text,text,text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
