
-- Sprint 3S v2: UUID-only гранулярный доступ к глобальным пакетам документов
-- 1) Расширяем CHECK grant_target_type
ALTER TABLE public.access_rules DROP CONSTRAINT IF EXISTS access_rules_grant_target_type_check;
ALTER TABLE public.access_rules ADD CONSTRAINT access_rules_grant_target_type_check
  CHECK (grant_target_type = ANY (ARRAY[
    'entitlement','club','email','product_access','training_content','section_access','document_generation'
  ]));

-- 2) Триггер: только админ может INSERT/UPDATE глобальный пакет (profile_id IS NULL)
CREATE OR REPLACE FUNCTION public.assert_global_package_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.profile_id IS NULL)
     OR (TG_OP = 'UPDATE' AND (NEW.profile_id IS NULL OR OLD.profile_id IS NULL)) THEN
    IF NOT (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')) THEN
      RAISE EXCEPTION 'Only admin/super_admin can modify global document packages';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_global_package_admin_only ON public.document_package_templates;
CREATE TRIGGER trg_global_package_admin_only
  BEFORE INSERT OR UPDATE ON public.document_package_templates
  FOR EACH ROW EXECUTE FUNCTION public.assert_global_package_admin_only();

-- 3) Резолвер видимости пакетов для текущего пользователя (auth.uid())
CREATE OR REPLACE FUNCTION public.get_user_document_package_ids()
RETURNS TABLE(full_access boolean, package_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_full boolean := false;
  v_ids  uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, ARRAY[]::uuid[]; RETURN;
  END IF;

  IF public.has_role_v2(v_user,'admin') OR public.has_role_v2(v_user,'super_admin') THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[]; RETURN;
  END IF;

  -- Полный доступ: legacy section_access -> document_generation, либо новое document_generation/full
  SELECT EXISTS (
    SELECT 1
    FROM public.access_rules ar
    WHERE ar.is_active = true
      AND (
        (ar.grant_target_type='section_access' AND ar.target_ref='document_generation')
        OR (ar.grant_target_type='document_generation'
            AND COALESCE(ar.conditions->>'access_mode','full') = 'full')
      )
      AND public.user_has_access_to_rule(v_user, ar.id)
  ) INTO v_full;

  IF v_full THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[]; RETURN;
  END IF;

  -- Partial: собрать UUID из conditions.allowed_package_ids
  SELECT COALESCE(array_agg(DISTINCT pid::uuid), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.access_rules ar
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ar.conditions->'allowed_package_ids','[]'::jsonb)) AS pid
  WHERE ar.is_active = true
    AND ar.grant_target_type = 'document_generation'
    AND COALESCE(ar.conditions->>'access_mode','full') = 'partial'
    AND public.user_has_access_to_rule(v_user, ar.id);

  RETURN QUERY SELECT false, v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_document_package_ids() TO authenticated;

-- 4) Helper: видит ли текущий пользователь конкретный template
CREATE OR REPLACE FUNCTION public.user_can_see_document_package(p_template_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_profile_id uuid;
  v_is_active boolean;
  v_full boolean;
  v_ids uuid[];
BEGIN
  IF v_user IS NULL THEN RETURN false; END IF;

  SELECT profile_id, is_active INTO v_profile_id, v_is_active
  FROM public.document_package_templates WHERE id = p_template_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF public.has_role_v2(v_user,'admin') OR public.has_role_v2(v_user,'super_admin') THEN
    RETURN true;
  END IF;

  -- Owner (private packages)
  IF v_profile_id IS NOT NULL AND EXISTS(
       SELECT 1 FROM public.profiles p WHERE p.id = v_profile_id AND p.user_id = v_user
     ) THEN
    RETURN true;
  END IF;

  -- Global packages
  IF v_profile_id IS NULL THEN
    IF NOT v_is_active THEN RETURN false; END IF;
    SELECT r.full_access, r.package_ids INTO v_full, v_ids
    FROM public.get_user_document_package_ids() r;
    RETURN COALESCE(v_full,false) OR (p_template_id = ANY(COALESCE(v_ids,ARRAY[]::uuid[])));
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.user_can_see_document_package(uuid) TO authenticated;

-- 5) Permissive SELECT-политики поверх существующих owner/admin
DROP POLICY IF EXISTS "User can view accessible packages" ON public.document_package_templates;
CREATE POLICY "User can view accessible packages"
  ON public.document_package_templates
  FOR SELECT
  TO authenticated
  USING (public.user_can_see_document_package(id));

DROP POLICY IF EXISTS "User can view accessible package items" ON public.document_package_template_items;
CREATE POLICY "User can view accessible package items"
  ON public.document_package_template_items
  FOR SELECT
  TO authenticated
  USING (public.user_can_see_document_package(package_template_id));
