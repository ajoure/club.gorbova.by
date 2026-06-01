
-- Sprint 3S v2 closure: mandatory audit via CRUD RPCs + extended safe-delete dependency discovery.

-- 1) CREATE global package (admin-only, audit-enforced)
CREATE OR REPLACE FUNCTION public.create_global_document_package(
  _name text,
  _description text DEFAULT NULL,
  _is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _id uuid;
  _clean_name text := btrim(coalesce(_name, ''));
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'create_global_document_package: not authenticated';
  END IF;
  IF NOT (public.has_role_v2(_actor, 'admin') OR public.has_role_v2(_actor, 'super_admin')) THEN
    RAISE EXCEPTION 'create_global_document_package: admin role required';
  END IF;
  IF _clean_name = '' THEN
    RAISE EXCEPTION 'create_global_document_package: name is required';
  END IF;

  INSERT INTO public.document_package_templates (name, description, is_active, profile_id, created_by)
  VALUES (_clean_name, NULLIF(btrim(coalesce(_description, '')), ''), coalesce(_is_active, true), NULL, _actor)
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
  VALUES (_actor, 'user', 'document_package.created',
    jsonb_build_object('package_id', _id, 'name', _clean_name, 'is_active', coalesce(_is_active, true)));

  RETURN jsonb_build_object('status','created','package_id', _id);
END;
$$;

-- 2) UPDATE global package (name/description/is_active); audit rename / activation / generic update
CREATE OR REPLACE FUNCTION public.update_global_document_package(
  _package_id uuid,
  _name text,
  _description text DEFAULT NULL,
  _is_active boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _old record;
  _clean_name text := btrim(coalesce(_name, ''));
  _new_desc text := NULLIF(btrim(coalesce(_description, '')), '');
  _new_active boolean;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'update_global_document_package: not authenticated';
  END IF;
  IF NOT (public.has_role_v2(_actor, 'admin') OR public.has_role_v2(_actor, 'super_admin')) THEN
    RAISE EXCEPTION 'update_global_document_package: admin role required';
  END IF;
  IF _clean_name = '' THEN
    RAISE EXCEPTION 'update_global_document_package: name is required';
  END IF;

  SELECT id, name, description, is_active, profile_id INTO _old
  FROM public.document_package_templates WHERE id = _package_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found','package_id', _package_id);
  END IF;
  IF _old.profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'update_global_document_package: not a global package';
  END IF;

  _new_active := COALESCE(_is_active, _old.is_active);

  UPDATE public.document_package_templates
     SET name = _clean_name,
         description = _new_desc,
         is_active = _new_active,
         updated_at = now()
   WHERE id = _package_id;

  IF _clean_name <> _old.name THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (_actor, 'user', 'document_package.renamed',
      jsonb_build_object('package_id', _package_id, 'old_name', _old.name, 'new_name', _clean_name));
  END IF;

  IF _new_active IS DISTINCT FROM _old.is_active THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (_actor, 'user',
      CASE WHEN _new_active THEN 'document_package.activated' ELSE 'document_package.deactivated' END,
      jsonb_build_object('package_id', _package_id, 'name', _clean_name));
  END IF;

  IF _clean_name = _old.name AND _new_active IS NOT DISTINCT FROM _old.is_active
     AND _new_desc IS DISTINCT FROM _old.description THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (_actor, 'user', 'document_package.updated',
      jsonb_build_object('package_id', _package_id, 'name', _clean_name, 'description_changed', true));
  END IF;

  RETURN jsonb_build_object('status','updated','package_id', _package_id);
END;
$$;

-- 3) DEACTIVATE convenience RPC
CREATE OR REPLACE FUNCTION public.deactivate_global_document_package(_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _actor uuid := auth.uid(); _pkg record;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'deactivate_global_document_package: not authenticated'; END IF;
  IF NOT (public.has_role_v2(_actor, 'admin') OR public.has_role_v2(_actor, 'super_admin')) THEN
    RAISE EXCEPTION 'deactivate_global_document_package: admin role required';
  END IF;
  SELECT id, name, is_active, profile_id INTO _pkg FROM public.document_package_templates WHERE id = _package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF _pkg.profile_id IS NOT NULL THEN RAISE EXCEPTION 'deactivate_global_document_package: not a global package'; END IF;

  IF _pkg.is_active THEN
    UPDATE public.document_package_templates SET is_active = false, updated_at = now() WHERE id = _package_id;
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (_actor, 'user', 'document_package.deactivated', jsonb_build_object('package_id', _package_id, 'name', _pkg.name));
  END IF;
  RETURN jsonb_build_object('status','deactivated','package_id', _package_id);
END;
$$;

-- 4) Extend safe_delete_document_package with full dependency discovery
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
  _participants_count int := 0;
  _role_catalog_count int := 0;
  _item_role_assignments_count int := 0;
  _rules_count int := 0;
  _batches_count int := 0;
  _generated_docs_count int := 0;
  _deps jsonb;
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
    RETURN jsonb_build_object('status','not_found','package_id', _package_id);
  END IF;

  SELECT count(*) INTO _items_count
  FROM public.document_package_template_items WHERE package_template_id = _package_id;

  SELECT count(*) INTO _sessions_count
  FROM public.document_package_sessions WHERE package_template_id = _package_id;

  SELECT count(*) INTO _participants_count
  FROM public.document_package_session_participants p
  JOIN public.document_package_sessions s ON s.id = p.package_session_id
  WHERE s.package_template_id = _package_id;

  SELECT count(*) INTO _role_catalog_count
  FROM public.document_package_role_catalog WHERE package_template_id = _package_id;

  SELECT count(*) INTO _item_role_assignments_count
  FROM public.document_package_item_role_assignments a
  WHERE a.package_template_item_id IN (
    SELECT id FROM public.document_package_template_items WHERE package_template_id = _package_id
  )
  OR a.package_session_id IN (
    SELECT id FROM public.document_package_sessions WHERE package_template_id = _package_id
  );

  SELECT count(*) INTO _batches_count
  FROM public.ai_document_generation_batches WHERE package_template_id = _package_id;

  SELECT count(*) INTO _generated_docs_count
  FROM public.ai_generated_documents WHERE package_template_id = _package_id;

  SELECT count(*) INTO _rules_count
  FROM public.access_rules
  WHERE grant_target_type = 'document_generation'
    AND conditions ? 'allowed_package_ids'
    AND (conditions->'allowed_package_ids') @> to_jsonb(_package_id::text);

  _deps := jsonb_build_object(
    'items', _items_count,
    'sessions', _sessions_count,
    'session_participants', _participants_count,
    'role_catalog', _role_catalog_count,
    'item_role_assignments', _item_role_assignments_count,
    'generation_batches', _batches_count,
    'generated_documents', _generated_docs_count,
    'access_rules', _rules_count
  );

  IF (_items_count + _sessions_count + _participants_count + _role_catalog_count
      + _item_role_assignments_count + _batches_count + _generated_docs_count + _rules_count) > 0 THEN
    INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
    VALUES (_actor, 'user', 'document_package.delete_blocked',
      jsonb_build_object('package_id', _package_id, 'package_name', _pkg.name, 'dependencies', _deps));

    RETURN jsonb_build_object(
      'status','blocked',
      'reason','has_dependencies',
      'dependencies', _deps,
      'suggestion','deactivate'
    );
  END IF;

  DELETE FROM public.document_package_templates WHERE id = _package_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
  VALUES (_actor, 'user', 'document_package.deleted',
    jsonb_build_object('package_id', _package_id, 'package_name', _pkg.name, 'was_active', _pkg.is_active));

  RETURN jsonb_build_object('status','deleted','package_id', _package_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_global_document_package(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_global_document_package(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_global_document_package(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.safe_delete_document_package(uuid) TO authenticated;
