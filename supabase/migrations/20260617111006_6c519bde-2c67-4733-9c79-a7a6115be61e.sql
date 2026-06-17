CREATE OR REPLACE FUNCTION public.save_session_document_atomic(
  _session_id uuid,
  _package_template_item_id uuid,
  _field_values jsonb,
  _role_assignments jsonb,
  _expected_template_version_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := has_role_v2(v_uid,'admin') OR has_role_v2(v_uid,'super_admin');
  v_session_owner_uid uuid;
  v_session_pkg uuid;
  v_item_pkg uuid;
  v_template_id uuid;
  v_current_version_id uuid;
  v_detected_tokens jsonb;
  v_legacy_tokens jsonb;
  v_detected text[];
  v_item jsonb;
  v_field_id uuid;
  v_value text;
  v_data_type text;
  v_field_pkg uuid;
  v_field_active boolean;
  v_field_public_id text;
  v_role_id uuid;
  v_person_id uuid;
  v_pos text;
  v_role_pkg uuid;
  v_role_active boolean;
  v_num numeric;
  v_date date;
  v_datetime timestamptz;
  v_time time;
  v_bool boolean;
  v_json jsonb;
  v_written_fields int := 0;
  v_written_roles int := 0;
  v_deleted_roles int := 0;
  v_kept_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
  v_audit_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _session_id IS NULL OR _package_template_item_id IS NULL THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  SELECT s.package_template_id, p.user_id
    INTO v_session_pkg, v_session_owner_uid
    FROM public.document_package_sessions s
    JOIN public.profiles p ON p.id = s.profile_id
   WHERE s.id = _session_id;
  IF v_session_pkg IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '42704';
  END IF;
  IF NOT (v_session_owner_uid = v_uid OR v_is_admin) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT i.package_template_id, i.template_id, t.current_version_id
    INTO v_item_pkg, v_template_id, v_current_version_id
    FROM public.document_package_template_items i
    JOIN public.document_templates t ON t.id = i.template_id
   WHERE i.id = _package_template_item_id;
  IF v_item_pkg IS NULL THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = '42704';
  END IF;
  IF v_item_pkg <> v_session_pkg THEN
    RAISE EXCEPTION 'item_outside_session_package' USING ERRCODE = '42501';
  END IF;
  IF v_current_version_id IS NULL THEN
    SELECT v.id INTO v_current_version_id
      FROM public.document_template_versions v
     WHERE v.template_id = v_template_id AND v.is_current = true
     ORDER BY v.created_at DESC LIMIT 1;
  END IF;

  IF _expected_template_version_id IS NOT NULL
     AND v_current_version_id IS DISTINCT FROM _expected_template_version_id THEN
    -- HARDENED: ERRCODE 22023 (invalid_argument) instead of 40001 (serialization_failure).
    -- 40001 was triggering PostgREST retry loops in edge runtime; the condition is a
    -- precondition violation, not a serialization retry.
    RAISE EXCEPTION 'stale_template_version' USING
      ERRCODE = '22023',
      DETAIL = jsonb_build_object('expected', _expected_template_version_id, 'current', v_current_version_id)::text;
  END IF;

  v_detected := ARRAY[]::text[];
  IF v_current_version_id IS NOT NULL THEN
    SELECT v.detected_tokens, v.tokens
      INTO v_detected_tokens, v_legacy_tokens
      FROM public.document_template_versions v
     WHERE v.id = v_current_version_id;
    IF v_detected_tokens IS NOT NULL AND jsonb_typeof(v_detected_tokens) = 'array' THEN
      SELECT array_agg(x) INTO v_detected FROM jsonb_array_elements_text(v_detected_tokens) AS x;
    ELSIF v_legacy_tokens IS NOT NULL AND jsonb_typeof(v_legacy_tokens) = 'array' THEN
      SELECT array_agg(x) INTO v_detected FROM jsonb_array_elements_text(v_legacy_tokens) AS x;
    END IF;
    v_detected := COALESCE(v_detected, ARRAY[]::text[]);
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(_field_values, '[]'::jsonb)) LOOP
    v_field_id := NULLIF(v_item->>'field_catalog_id','')::uuid;
    v_value    := v_item->>'value';
    IF v_field_id IS NULL THEN
      RAISE EXCEPTION 'missing_field_catalog_id' USING ERRCODE = '22023';
    END IF;

    SELECT c.package_template_id, c.data_type, c.is_active, c.public_id
      INTO v_field_pkg, v_data_type, v_field_active, v_field_public_id
      FROM public.document_package_field_catalog c WHERE c.id = v_field_id;
    IF v_field_pkg IS NULL THEN
      RAISE EXCEPTION 'field_not_found' USING ERRCODE = '42704', DETAIL = v_field_id::text;
    END IF;
    IF v_field_pkg <> v_session_pkg THEN
      RAISE EXCEPTION 'field_outside_session_package' USING ERRCODE = '42501', DETAIL = v_field_id::text;
    END IF;
    IF v_field_active IS NOT TRUE THEN
      RAISE EXCEPTION 'field_archived' USING ERRCODE = '42501', DETAIL = v_field_id::text;
    END IF;

    IF v_field_public_id IS NOT NULL AND NOT (v_field_public_id = ANY(v_detected)) THEN
      RAISE EXCEPTION 'orphan_field_not_writable_per_item' USING
        ERRCODE = '42501',
        DETAIL = jsonb_build_object('field_catalog_id', v_field_id, 'public_id', v_field_public_id, 'item_id', _package_template_item_id)::text;
    END IF;

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
        RAISE EXCEPTION 'value_type_mismatch' USING
          ERRCODE = '22023',
          DETAIL = jsonb_build_object('field_catalog_id', v_field_id, 'data_type', v_data_type)::text;
      END;
    END IF;

    -- HARDENED: ON CONFLICT inference against partial unique index
    -- uq_dpsfv_session_field_item_level WHERE package_template_item_id IS NOT NULL.
    -- Replaces UPDATE-then-INSERT pattern that raced under 5×parallel.
    INSERT INTO public.document_package_session_field_values(
      session_id, field_catalog_id, package_template_item_id,
      value_text, value_number, value_date, value_datetime, value_time, value_boolean, value_json,
      created_by, updated_by
    ) VALUES (
      _session_id, v_field_id, _package_template_item_id,
      CASE WHEN v_data_type IN ('text','select') THEN v_value ELSE NULL END,
      v_num, v_date, v_datetime, v_time, v_bool, v_json,
      v_uid, v_uid
    )
    ON CONFLICT (session_id, field_catalog_id, package_template_item_id)
      WHERE package_template_item_id IS NOT NULL
    DO UPDATE SET
      value_text     = EXCLUDED.value_text,
      value_number   = EXCLUDED.value_number,
      value_date     = EXCLUDED.value_date,
      value_datetime = EXCLUDED.value_datetime,
      value_time     = EXCLUDED.value_time,
      value_boolean  = EXCLUDED.value_boolean,
      value_json     = EXCLUDED.value_json,
      updated_by     = EXCLUDED.updated_by;
    v_written_fields := v_written_fields + 1;
  END LOOP;

  IF _role_assignments IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(_role_assignments) LOOP
      v_role_id   := NULLIF(v_item->>'role_catalog_id','')::uuid;
      v_person_id := NULLIF(v_item->>'person_id','')::uuid;
      v_pos       := NULLIF(v_item->>'position','');

      IF v_role_id IS NULL OR v_person_id IS NULL THEN
        RAISE EXCEPTION 'role_or_person_missing' USING ERRCODE = '22023';
      END IF;

      SELECT r.package_template_id, r.is_active
        INTO v_role_pkg, v_role_active
        FROM public.document_package_role_catalog r WHERE r.id = v_role_id;
      IF v_role_pkg IS NULL THEN
        RAISE EXCEPTION 'role_not_found' USING ERRCODE = '42704', DETAIL = v_role_id::text;
      END IF;
      IF v_role_pkg <> v_session_pkg THEN
        RAISE EXCEPTION 'role_outside_session_package' USING ERRCODE = '42501', DETAIL = v_role_id::text;
      END IF;
      IF v_role_active IS NOT TRUE THEN
        RAISE EXCEPTION 'role_archived' USING ERRCODE = '42501', DETAIL = v_role_id::text;
      END IF;

      IF NOT EXISTS (SELECT 1 FROM public.legal_details_persons p WHERE p.id = v_person_id) THEN
        RAISE EXCEPTION 'person_not_accessible' USING ERRCODE = '42501', DETAIL = v_person_id::text;
      END IF;

      -- HARDENED #1: UPDATE limited to existing ACTIVE row only. Without is_active=true
      -- the previous version flipped historical inactive duplicates to true and exploded
      -- the partial unique index ux_dpira_active_person.
      v_new_id := NULL;
      UPDATE public.document_package_item_role_assignments
         SET metadata   = CASE WHEN v_pos IS NOT NULL THEN jsonb_build_object('position', v_pos) ELSE '{}'::jsonb END,
             sort_order = COALESCE((v_item->>'sort_order')::int, sort_order),
             updated_by = v_uid
       WHERE package_session_id = _session_id
         AND package_template_item_id = _package_template_item_id
         AND role_catalog_id = v_role_id
         AND person_id = v_person_id
         AND is_active = true
       RETURNING id INTO v_new_id;
      IF v_new_id IS NULL THEN
        -- HARDENED #2: ON CONFLICT against ux_dpira_active_person partial index
        -- (WHERE is_active = true AND person_id IS NOT NULL).
        INSERT INTO public.document_package_item_role_assignments(
          package_session_id, package_template_item_id, role_catalog_id, person_id,
          metadata, sort_order, is_active, created_by, updated_by
        ) VALUES (
          _session_id, _package_template_item_id, v_role_id, v_person_id,
          CASE WHEN v_pos IS NOT NULL THEN jsonb_build_object('position', v_pos) ELSE '{}'::jsonb END,
          COALESCE((v_item->>'sort_order')::int, 100),
          true, v_uid, v_uid
        )
        ON CONFLICT (package_session_id, package_template_item_id, role_catalog_id, person_id)
          WHERE is_active = true AND person_id IS NOT NULL
        DO UPDATE SET
          metadata   = EXCLUDED.metadata,
          sort_order = EXCLUDED.sort_order,
          updated_by = EXCLUDED.updated_by
        RETURNING id INTO v_new_id;
      END IF;
      v_kept_ids := v_kept_ids || v_new_id;
      v_written_roles := v_written_roles + 1;
    END LOOP;
  END IF;

  UPDATE public.document_package_item_role_assignments
     SET is_active = false, updated_by = v_uid
   WHERE package_session_id = _session_id
     AND package_template_item_id = _package_template_item_id
     AND is_active = true
     AND NOT (id = ANY(v_kept_ids));
  GET DIAGNOSTICS v_deleted_roles = ROW_COUNT;

  INSERT INTO public.audit_logs(actor_id, action, resource_type, resource_id, payload)
  VALUES (
    v_uid,
    'package_document_atomic_save',
    'document_package_session',
    _session_id,
    jsonb_build_object(
      'package_template_item_id', _package_template_item_id,
      'template_version_id', v_current_version_id,
      'written_fields', v_written_fields,
      'written_roles', v_written_roles,
      'deleted_roles', v_deleted_roles
    )
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'ok', true,
    'written_fields', v_written_fields,
    'written_roles', v_written_roles,
    'deleted_roles', v_deleted_roles,
    'template_version_id', v_current_version_id,
    'audit_id', v_audit_id
  );
END;
$$;

COMMENT ON FUNCTION public.save_session_document_atomic(uuid, uuid, jsonb, jsonb, uuid) IS
'Stage 2+3 PATCH-PACKAGE-CROSS-PARITY-V1: atomic per-item save fields+roles. Hardened by Stage 3 runtime proof: (1) role UPDATE limited to is_active=true row to avoid resurrecting historical inactive duplicates; (2) field INSERT and role INSERT use ON CONFLICT inference against partial unique indexes for 5x parallel safety; (3) stale_template_version uses ERRCODE 22023 (precondition) not 40001 (serialization).';