CREATE OR REPLACE FUNCTION public.delete_session_field_value(
  _session_id uuid,
  _field_catalog_id uuid,
  _package_template_item_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session document_package_sessions%ROWTYPE;
  v_is_admin boolean := false;
  v_owner boolean := false;
  v_field_pkg uuid;
  v_item_pkg uuid;
  v_deleted int := 0;
  v_prev jsonb;
BEGIN
  IF _session_id IS NULL OR _field_catalog_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF _package_template_item_id IS NULL THEN
    RAISE EXCEPTION 'cannot_delete_session_level_via_reset' USING ERRCODE = '22023';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  v_is_admin := has_role_v2(v_uid, 'super_admin') OR has_role_v2(v_uid, 'admin');

  SELECT * INTO v_session FROM document_package_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = '02000';
  END IF;

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = v_session.profile_id AND p.user_id = v_uid
    ) INTO v_owner;
    IF NOT v_owner THEN
      RAISE EXCEPTION 'forbidden_session_owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT package_template_id INTO v_field_pkg
  FROM document_package_field_catalog WHERE id = _field_catalog_id;
  IF v_field_pkg IS NULL OR v_field_pkg <> v_session.package_template_id THEN
    RAISE EXCEPTION 'pkg_field_template_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT package_template_id INTO v_item_pkg
  FROM document_package_template_items WHERE id = _package_template_item_id;
  IF v_item_pkg IS NULL OR v_item_pkg <> v_session.package_template_id THEN
    RAISE EXCEPTION 'pkg_field_value_item_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(v) - 'created_at' - 'updated_at' INTO v_prev
  FROM document_package_session_field_values v
  WHERE v.session_id = _session_id
    AND v.field_catalog_id = _field_catalog_id
    AND v.package_template_item_id = _package_template_item_id;

  DELETE FROM document_package_session_field_values
  WHERE session_id = _session_id
    AND field_catalog_id = _field_catalog_id
    AND package_template_item_id = _package_template_item_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    INSERT INTO audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (
      v_uid,
      'user',
      'package_session_field_value.reset_override',
      jsonb_build_object(
        'is_admin', v_is_admin,
        'session_id', _session_id,
        'field_catalog_id', _field_catalog_id,
        'package_template_item_id', _package_template_item_id,
        'package_template_id', v_session.package_template_id,
        'profile_id', v_session.profile_id,
        'previous_value', COALESCE(v_prev, 'null'::jsonb)
      )
    );
  END IF;

  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;