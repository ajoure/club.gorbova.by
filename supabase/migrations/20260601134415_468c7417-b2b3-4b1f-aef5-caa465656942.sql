
-- Sprint 3S v2: audit logging + safe-delete RPCs for global document packages

CREATE OR REPLACE FUNCTION public.log_document_package_event(
  _action text,
  _package_id uuid,
  _meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id uuid;
  _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'log_document_package_event: not authenticated';
  END IF;

  IF NOT (public.has_role_v2(_actor, 'admin') OR public.has_role_v2(_actor, 'super_admin')) THEN
    RAISE EXCEPTION 'log_document_package_event: admin role required';
  END IF;

  IF _action IS NULL OR _action NOT LIKE 'document_package.%' THEN
    RAISE EXCEPTION 'log_document_package_event: action must start with document_package.';
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, target_user_id, meta)
  VALUES (
    _actor, 'user', _action, NULL,
    COALESCE(_meta, '{}'::jsonb) || jsonb_build_object('package_id', _package_id)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_document_package_event(text, uuid, jsonb) TO authenticated;

-- Safe delete: returns jsonb with status + reason; deletes only if no dependencies.
CREATE OR REPLACE FUNCTION public.safe_delete_document_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _pkg record;
  _items_count int := 0;
  _sessions_count int := 0;
  _rules_count int := 0;
  _deps jsonb;
  _result jsonb;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'safe_delete_document_package: not authenticated';
  END IF;

  IF NOT (public.has_role_v2(_actor, 'admin') OR public.has_role_v2(_actor, 'super_admin')) THEN
    RAISE EXCEPTION 'safe_delete_document_package: admin role required';
  END IF;

  SELECT id, name, is_active, profile_id INTO _pkg
  FROM public.document_package_templates WHERE id = _package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','package_id',_package_id);
  END IF;

  -- Dependency checks
  SELECT count(*) INTO _items_count
  FROM public.document_package_template_items WHERE package_template_id = _package_id;

  SELECT count(*) INTO _sessions_count
  FROM public.document_package_sessions WHERE package_template_id = _package_id;

  SELECT count(*) INTO _rules_count
  FROM public.access_rules
  WHERE grant_target_type = 'document_generation'
    AND conditions ? 'allowed_package_ids'
    AND (conditions->'allowed_package_ids') @> to_jsonb(_package_id::text);

  _deps := jsonb_build_object(
    'items', _items_count,
    'sessions', _sessions_count,
    'access_rules', _rules_count
  );

  IF _items_count > 0 OR _sessions_count > 0 OR _rules_count > 0 THEN
    -- Blocked
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (_actor, 'user', 'document_package.delete_blocked',
      jsonb_build_object(
        'package_id', _package_id,
        'package_name', _pkg.name,
        'dependencies', _deps
      ));

    RETURN jsonb_build_object(
      'status','blocked',
      'reason','has_dependencies',
      'dependencies', _deps,
      'suggestion','deactivate'
    );
  END IF;

  -- Safe to hard delete
  DELETE FROM public.document_package_templates WHERE id = _package_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
  VALUES (_actor, 'user', 'document_package.deleted',
    jsonb_build_object(
      'package_id', _package_id,
      'package_name', _pkg.name,
      'was_active', _pkg.is_active
    ));

  RETURN jsonb_build_object('status','deleted','package_id',_package_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.safe_delete_document_package(uuid) TO authenticated;
