-- ============================================================
-- FIX: create_global_document_package must set is_system=true
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_global_document_package(
  _name text, _description text DEFAULT NULL, _is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _actor uuid := auth.uid();
  _id uuid;
  _clean_name text := btrim(coalesce(_name, ''));
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'create_global_document_package: not authenticated';
  END IF;
  IF NOT (public.has_role_v2(_actor,'admin') OR public.has_role_v2(_actor,'super_admin')) THEN
    RAISE EXCEPTION 'create_global_document_package: admin role required';
  END IF;
  IF _clean_name = '' THEN
    RAISE EXCEPTION 'create_global_document_package: name is required';
  END IF;

  INSERT INTO public.document_package_templates
    (name, description, is_active, profile_id, created_by, is_system)
  VALUES
    (_clean_name, NULLIF(btrim(coalesce(_description,'')),''),
     coalesce(_is_active,true), NULL, _actor, true)
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (actor_user_id, actor_type, action, meta)
  VALUES (_actor, 'user', 'document_package.created',
    jsonb_build_object('package_id', _id, 'name', _clean_name,
                       'is_active', coalesce(_is_active,true)));

  RETURN jsonb_build_object('status','created','package_id', _id);
END
$fn$;

-- ============================================================
-- RUNTIME PROOF: admin happy-path + non-admin negative checks
-- ============================================================
DO $proof$
DECLARE
  v_admin     uuid := '05cd3754-d589-4d90-97d1-89ba2bee610b';
  v_non_admin uuid;
  v_pkg_id    uuid;
  v_ideology  uuid := '06068dcf-6943-425c-aa6b-8bfaa550cfd2';
  v_res       jsonb;
BEGIN
  SELECT p.user_id INTO v_non_admin
  FROM profiles p
  WHERE p.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM user_roles_v2 ur JOIN roles r ON r.id=ur.role_id
      WHERE ur.user_id=p.user_id AND r.code IN ('admin','super_admin'))
  LIMIT 1;

  -- (A) ADMIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text,'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_res := public.create_global_document_package(
    '__sprint3s_audit_proof__', 'temp proof', true);
  v_pkg_id := (v_res->>'package_id')::uuid;
  RAISE NOTICE 'A.1 created: %', v_res;

  v_res := public.update_global_document_package(
    v_pkg_id, '__sprint3s_audit_proof_renamed__', 'updated desc', true);
  RAISE NOTICE 'A.2 renamed/updated: %', v_res;

  v_res := public.deactivate_global_document_package(v_pkg_id);
  RAISE NOTICE 'A.3 deactivated: %', v_res;

  v_res := public.safe_delete_document_package(v_ideology);
  RAISE NOTICE 'A.4 delete_blocked on Идеология: %', v_res;

  v_res := public.safe_delete_document_package(v_pkg_id);
  RAISE NOTICE 'A.5 deleted empty test pkg: %', v_res;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- (B) NON-ADMIN
  IF v_non_admin IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_non_admin::text,'role','authenticated')::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      PERFORM public.create_global_document_package('__nope__', NULL, true);
      RAISE NOTICE 'B.1 NEGATIVE FAIL: create succeeded';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B.1 non-admin create blocked: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.update_global_document_package(v_ideology,'hack',NULL,true);
      RAISE NOTICE 'B.2 NEGATIVE FAIL: update succeeded';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B.2 non-admin update blocked: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.deactivate_global_document_package(v_ideology);
      RAISE NOTICE 'B.3 NEGATIVE FAIL: deactivate succeeded';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B.3 non-admin deactivate blocked: %', SQLERRM;
    END;

    BEGIN
      PERFORM public.safe_delete_document_package(v_ideology);
      RAISE NOTICE 'B.4 NEGATIVE FAIL: safe_delete succeeded';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B.4 non-admin safe_delete blocked: %', SQLERRM;
    END;

    BEGIN
      INSERT INTO public.document_package_templates(name, profile_id, created_by, is_active, is_system)
      VALUES ('__direct_insert_hack__', NULL, v_non_admin, true, true);
      RAISE NOTICE 'B.5 NEGATIVE FAIL: direct INSERT succeeded';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B.5 non-admin direct INSERT blocked: %', SQLERRM;
    END;

    BEGIN
      UPDATE public.document_package_templates SET name='hack' WHERE id=v_ideology;
      RAISE NOTICE 'B.6 NEGATIVE FAIL: direct UPDATE succeeded';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'B.6 non-admin direct UPDATE blocked: %', SQLERRM;
    END;

    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);
  END IF;
END
$proof$;