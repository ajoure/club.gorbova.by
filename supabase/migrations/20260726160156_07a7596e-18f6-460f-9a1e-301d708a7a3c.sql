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
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT false, ARRAY[]::uuid[];
    RETURN;
  END IF;

  IF public.has_role_v2(v_user, 'admin') OR public.has_role_v2(v_user, 'super_admin') THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[];
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.app_sections s
    WHERE s.code = 'document_generation'
      AND s.is_active = true
      AND s.is_public = true
  ) THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[];
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.access_rules ar
    WHERE ar.is_active = true
      AND (
        (ar.grant_target_type = 'section_access' AND ar.target_ref = 'document_generation')
        OR (
          ar.grant_target_type = 'document_generation'
          AND COALESCE(ar.conditions->>'access_mode', 'full') = 'full'
        )
      )
      AND public.user_has_access_to_rule(v_user, ar.id)
  ) INTO v_full;

  IF v_full THEN
    RETURN QUERY SELECT true, ARRAY[]::uuid[];
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT pid::uuid), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.access_rules ar
  CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(ar.conditions->'allowed_package_ids', '[]'::jsonb)) AS pid
  WHERE ar.is_active = true
    AND ar.grant_target_type = 'document_generation'
    AND COALESCE(ar.conditions->>'access_mode', 'full') = 'partial'
    AND public.user_has_access_to_rule(v_user, ar.id);

  RETURN QUERY SELECT false, v_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_document_package_ids() TO authenticated;