-- Existing canonical helper body; unchanged, used only in synthetic tests.
CREATE OR REPLACE FUNCTION public.has_admin_section_access(
  _user_id uuid,
  _section_code text,
  _min_level text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_min_rank integer;
  v_actual_rank integer;
BEGIN
  IF _user_id IS NULL OR NULLIF(btrim(_section_code), '') IS NULL THEN
    RETURN false;
  END IF;

  -- Canonical RBAC v2 roles, not legacy public.user_roles/app_role.
  IF public.has_role_v2(_user_id, 'super_admin')
     OR public.has_role_v2(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  v_min_rank := CASE lower(coalesce(_min_level, 'view'))
    WHEN 'manage' THEN 3
    WHEN 'edit' THEN 2
    WHEN 'view' THEN 1
    WHEN 'none' THEN 0
    ELSE NULL
  END;

  IF v_min_rank IS NULL THEN
    RETURN false;
  END IF;

  SELECT max(CASE a.access_level
    WHEN 'manage' THEN 3
    WHEN 'edit' THEN 2
    WHEN 'view' THEN 1
    ELSE 0
  END)
  INTO v_actual_rank
  FROM public.get_admin_access(_user_id) a
  WHERE a.section_code = _section_code
    AND a.resource_code IS NULL;

  RETURN coalesce(v_actual_rank, 0) >= v_min_rank;
END;
$$;
