-- =============================================================
-- Per-document field values for document_package_session_field_values
-- + cross-tenant guards + extended RPC + new resolver-feeding column
-- =============================================================

-- 1) Колонка per-item override (NULL = session-level / общий уровень)
ALTER TABLE public.document_package_session_field_values
  ADD COLUMN IF NOT EXISTS package_template_item_id uuid NULL
    REFERENCES public.document_package_template_items(id) ON DELETE RESTRICT;

-- 2) Снять старый UNIQUE по (session_id, field_catalog_id) — теперь partial
ALTER TABLE public.document_package_session_field_values
  DROP CONSTRAINT IF EXISTS uq_dpsfv;

-- 3) Два partial unique индекса
CREATE UNIQUE INDEX IF NOT EXISTS uq_dpsfv_session_field_session_level
  ON public.document_package_session_field_values(session_id, field_catalog_id)
  WHERE package_template_item_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dpsfv_session_field_item_level
  ON public.document_package_session_field_values(session_id, field_catalog_id, package_template_item_id)
  WHERE package_template_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dpsfv_item
  ON public.document_package_session_field_values(package_template_item_id);

-- 4) Trigger-guard: item.package_template_id == session.package_template_id == field.package_template_id
CREATE OR REPLACE FUNCTION public.dpsfv_assert_package_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session_pkg uuid;
  v_field_pkg uuid;
  v_item_pkg uuid;
BEGIN
  SELECT package_template_id INTO v_session_pkg
    FROM public.document_package_sessions WHERE id = NEW.session_id;
  IF v_session_pkg IS NULL THEN
    RAISE EXCEPTION 'pkg_field_value_session_not_found' USING ERRCODE = '23514';
  END IF;

  SELECT package_template_id INTO v_field_pkg
    FROM public.document_package_field_catalog WHERE id = NEW.field_catalog_id;
  IF v_field_pkg IS NULL THEN
    RAISE EXCEPTION 'pkg_field_value_field_not_found' USING ERRCODE = '23514';
  END IF;

  IF v_session_pkg <> v_field_pkg THEN
    RAISE EXCEPTION 'pkg_field_value_field_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW.package_template_item_id IS NOT NULL THEN
    SELECT package_template_id INTO v_item_pkg
      FROM public.document_package_template_items WHERE id = NEW.package_template_item_id;
    IF v_item_pkg IS NULL THEN
      RAISE EXCEPTION 'pkg_field_value_item_not_found' USING ERRCODE = '23514';
    END IF;
    IF v_item_pkg <> v_session_pkg THEN
      RAISE EXCEPTION 'pkg_field_value_item_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dpsfv_assert_package_match ON public.document_package_session_field_values;
CREATE TRIGGER trg_dpsfv_assert_package_match
  BEFORE INSERT OR UPDATE OF session_id, field_catalog_id, package_template_item_id
  ON public.document_package_session_field_values
  FOR EACH ROW EXECUTE FUNCTION public.dpsfv_assert_package_match();

-- 5) Расширяем RPC upsert_session_field_values: optional per-item override
--    Payload элемента теперь поддерживает поле `package_template_item_id` (uuid|null).
--    NULL/отсутствует → session-level upsert (как раньше).
--    Не-NULL → per-item upsert с guard'ами.
CREATE OR REPLACE FUNCTION public.upsert_session_field_values(
  _session_id uuid,
  _values jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_profile_id uuid;
  v_session_owner_uid uuid;
  v_session_pkg uuid;
  v_item jsonb;
  v_field_id uuid;
  v_item_id uuid;
  v_value text;
  v_data_type text;
  v_field_pkg uuid;
  v_item_pkg uuid;
  v_field_active boolean;
  v_ok int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_num numeric;
  v_date date;
  v_datetime timestamptz;
  v_time time;
  v_bool boolean;
  v_json jsonb;
BEGIN
  -- session ownership / admin guard
  SELECT s.package_template_id, p.user_id
    INTO v_session_pkg, v_session_owner_uid
    FROM public.document_package_sessions s
    JOIN public.profiles p ON p.id = s.profile_id
   WHERE s.id = _session_id;

  IF v_session_pkg IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '42704';
  END IF;

  IF NOT (
    v_session_owner_uid = auth.uid()
    OR has_role_v2(auth.uid(),'super_admin')
    OR has_role_v2(auth.uid(),'admin')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_values, '[]'::jsonb)) LOOP
    v_field_id := NULLIF(v_item->>'field_catalog_id','')::uuid;
    v_item_id := NULLIF(v_item->>'package_template_item_id','')::uuid;
    v_value := v_item->>'value';

    IF v_field_id IS NULL THEN
      v_errors := v_errors || jsonb_build_object('code','missing_field_catalog_id','payload',v_item);
      CONTINUE;
    END IF;

    -- field belongs to session package + active
    SELECT package_template_id, data_type, is_active
      INTO v_field_pkg, v_data_type, v_field_active
      FROM public.document_package_field_catalog WHERE id = v_field_id;

    IF v_field_pkg IS NULL THEN
      v_errors := v_errors || jsonb_build_object('code','field_not_found','field_catalog_id',v_field_id);
      CONTINUE;
    END IF;
    IF v_field_pkg <> v_session_pkg THEN
      v_errors := v_errors || jsonb_build_object('code','field_outside_session_package','field_catalog_id',v_field_id);
      CONTINUE;
    END IF;
    IF v_field_active IS NOT TRUE THEN
      v_errors := v_errors || jsonb_build_object('code','field_archived','field_catalog_id',v_field_id);
      CONTINUE;
    END IF;

    -- item belongs to session package (if provided)
    IF v_item_id IS NOT NULL THEN
      SELECT package_template_id INTO v_item_pkg
        FROM public.document_package_template_items WHERE id = v_item_id;
      IF v_item_pkg IS NULL THEN
        v_errors := v_errors || jsonb_build_object('code','item_not_found','package_template_item_id',v_item_id);
        CONTINUE;
      END IF;
      IF v_item_pkg <> v_session_pkg THEN
        v_errors := v_errors || jsonb_build_object('code','item_outside_session_package','package_template_item_id',v_item_id);
        CONTINUE;
      END IF;
    END IF;

    -- type-cast value (text in → typed column)
    v_num := NULL; v_date := NULL; v_datetime := NULL; v_time := NULL; v_bool := NULL; v_json := NULL;
    IF v_value IS NOT NULL AND v_value <> '' THEN
      BEGIN
        CASE v_data_type
          WHEN 'number','year' THEN v_num := v_value::numeric;
          WHEN 'date' THEN v_date := v_value::date;
          WHEN 'datetime' THEN v_datetime := v_value::timestamptz;
          WHEN 'time' THEN v_time := v_value::time;
          WHEN 'checkbox' THEN v_bool := v_value::boolean;
          WHEN 'multiselect' THEN v_json := v_value::jsonb;
          ELSE NULL;
        END CASE;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_object('code','value_type_mismatch','field_catalog_id',v_field_id,'data_type',v_data_type);
        CONTINUE;
      END;
    END IF;

    -- upsert (manual UPDATE→INSERT, partial unique → no clean ON CONFLICT)
    IF v_item_id IS NULL THEN
      UPDATE public.document_package_session_field_values
         SET value_text     = CASE WHEN v_data_type IN ('text','select') THEN v_value ELSE NULL END,
             value_number   = v_num,
             value_date     = v_date,
             value_datetime = v_datetime,
             value_time     = v_time,
             value_boolean  = v_bool,
             value_json     = v_json,
             updated_by     = auth.uid()
       WHERE session_id = _session_id
         AND field_catalog_id = v_field_id
         AND package_template_item_id IS NULL;
      IF NOT FOUND THEN
        INSERT INTO public.document_package_session_field_values(
          session_id, field_catalog_id, package_template_item_id,
          value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json,
          created_by, updated_by
        ) VALUES (
          _session_id, v_field_id, NULL,
          CASE WHEN v_data_type IN ('text','select') THEN v_value ELSE NULL END,
          v_num, v_date, v_datetime, v_time, v_bool, v_json,
          auth.uid(), auth.uid()
        );
      END IF;
    ELSE
      UPDATE public.document_package_session_field_values
         SET value_text     = CASE WHEN v_data_type IN ('text','select') THEN v_value ELSE NULL END,
             value_number   = v_num,
             value_date     = v_date,
             value_datetime = v_datetime,
             value_time     = v_time,
             value_boolean  = v_bool,
             value_json     = v_json,
             updated_by     = auth.uid()
       WHERE session_id = _session_id
         AND field_catalog_id = v_field_id
         AND package_template_item_id = v_item_id;
      IF NOT FOUND THEN
        INSERT INTO public.document_package_session_field_values(
          session_id, field_catalog_id, package_template_item_id,
          value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json,
          created_by, updated_by
        ) VALUES (
          _session_id, v_field_id, v_item_id,
          CASE WHEN v_data_type IN ('text','select') THEN v_value ELSE NULL END,
          v_num, v_date, v_datetime, v_time, v_bool, v_json,
          auth.uid(), auth.uid()
        );
      END IF;
    END IF;

    v_ok := v_ok + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', v_ok, 'errors', v_errors);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_session_field_values(uuid, jsonb) TO authenticated, service_role;