-- =====================================================================
-- Sprint 3F Phase 2e: hard-delete seed/system roles of «Идеология»
-- =====================================================================
-- Владелец проекта подтвердил: PKR-000001…PKR-000011 — тестовые seed-роли,
-- не используются, должны быть удалены физически. Защита триггера для
-- будущих системных ролей сохраняется.
-- =====================================================================

-- Временная SECURITY DEFINER функция: whitelist-only, удалит участников
-- и сами роли в обход triggera через DISABLE TRIGGER per-table.
-- После выполнения функция DROP — никакого permanent bypass не остаётся.
CREATE OR REPLACE FUNCTION public.cleanup_ideology_seed_roles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_deleted_assignments int := 0;
  v_deleted_roles int := 0;
  v_snapshot jsonb;
  v_whitelist text[] := ARRAY[
    'PKR-000001','PKR-000002','PKR-000003','PKR-000004','PKR-000005',
    'PKR-000006','PKR-000007','PKR-000008','PKR-000009','PKR-000010','PKR-000011'
  ];
BEGIN
  SELECT id INTO v_pkg_id FROM public.document_package_templates
   WHERE is_system = true AND code = 'ideology' LIMIT 1;

  IF v_pkg_id IS NULL THEN
    RAISE EXCEPTION 'Пакет «Идеология» не найден';
  END IF;

  -- Snapshot до удаления (для proof)
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'public_id', public_id, 'role_key', role_key, 'label', label
  ))
    INTO v_snapshot
    FROM public.document_package_role_catalog
   WHERE package_template_id = v_pkg_id
     AND is_system = true
     AND public_id = ANY(v_whitelist);

  -- 1) Удалить назначения этих ролей в анкетах
  WITH del AS (
    DELETE FROM public.document_package_session_participants p
    USING public.document_package_role_catalog r
    WHERE p.role_catalog_id = r.id
      AND r.package_template_id = v_pkg_id
      AND r.is_system = true
      AND r.public_id = ANY(v_whitelist)
    RETURNING p.id
  )
  SELECT count(*) INTO v_deleted_assignments FROM del;

  -- 2) Hard delete ролей — обходим guard-trigger строго per-table, scoped
  ALTER TABLE public.document_package_role_catalog
    DISABLE TRIGGER trg_guard_package_role_catalog_mutations;

  WITH del AS (
    DELETE FROM public.document_package_role_catalog
     WHERE package_template_id = v_pkg_id
       AND is_system = true
       AND public_id = ANY(v_whitelist)
    RETURNING id
  )
  SELECT count(*) INTO v_deleted_roles FROM del;

  ALTER TABLE public.document_package_role_catalog
    ENABLE TRIGGER trg_guard_package_role_catalog_mutations;

  -- 3) Audit (system actor)
  INSERT INTO public.audit_logs (action, actor_type, meta)
  VALUES (
    'package_role_seed_cleanup_deleted',
    'system',
    jsonb_build_object(
      'package_template_id', v_pkg_id,
      'package_name', 'Идеология',
      'deleted_public_ids', v_whitelist,
      'deleted_role_rows', v_deleted_roles,
      'deleted_assignments', v_deleted_assignments,
      'snapshot_before', v_snapshot,
      'reason', 'Owner confirmed seed/system roles are test data and must be hard-deleted',
      'sprint', '3F_Phase_2e'
    )
  );

  RETURN jsonb_build_object(
    'package_template_id', v_pkg_id,
    'deleted_roles', v_deleted_roles,
    'deleted_assignments', v_deleted_assignments
  );
END;
$$;

-- Выполнить cleanup однократно
SELECT public.cleanup_ideology_seed_roles();

-- DROP временную функцию: никаких permanent bypass-функций не оставляем
DROP FUNCTION public.cleanup_ideology_seed_roles();