CREATE OR REPLACE FUNCTION public.profile_can_use_document_package(p_profile_id uuid, p_package_template_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_is_active boolean;
  v_available_to_all boolean;
  v_full boolean := false;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT user_id INTO v_user_id FROM public.profiles WHERE id = p_profile_id;
  SELECT is_active, coalesce(is_available_to_all, false)
    INTO v_is_active, v_available_to_all
    FROM public.document_package_templates WHERE id = p_package_template_id;
  IF v_user_id IS NULL OR coalesce(v_is_active, false) = false THEN RETURN false; END IF;

  -- Global package: если пакет активен и помечен доступным всем — доступ есть у любого зарегистрированного пользователя.
  -- Согласовано с public.get_user_document_package_ids.
  IF v_available_to_all = true THEN RETURN true; END IF;

  IF public.has_role_v2(v_user_id, 'admin') OR public.has_role_v2(v_user_id, 'super_admin') THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.access_rules ar
    WHERE ar.is_active = true
      AND ((ar.grant_target_type = 'section_access' AND ar.target_ref = 'document_generation')
        OR (ar.grant_target_type = 'document_generation' AND coalesce(ar.conditions->>'access_mode', 'full') = 'full'))
      AND public.user_has_access_to_rule(v_user_id, ar.id)
  ) INTO v_full;
  IF v_full THEN RETURN true; END IF;

  SELECT coalesce(array_agg(DISTINCT pid::uuid), ARRAY[]::uuid[]) INTO v_ids
  FROM public.access_rules ar
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(ar.conditions->'allowed_package_ids','[]'::jsonb)) AS pid
  WHERE ar.is_active = true
    AND ar.grant_target_type = 'document_generation'
    AND coalesce(ar.conditions->>'access_mode', 'full') = 'partial'
    AND public.user_has_access_to_rule(v_user_id, ar.id);
  RETURN p_package_template_id = ANY(v_ids);
END;
$function$;