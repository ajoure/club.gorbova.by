-- RBAC v3: align the role editor, access resolver and data RLS.
--
-- Production symptom reproduced under a manager account:
--   * the forms-hub menu item was visible;
--   * the same account received zero rows from every forms-hub source;
--   * an administrator received the historical rows.
--
-- Root causes:
--   1. the UI supports none/view/edit/manage, while the database constraints
--      and get_admin_access() only supported none/view/manage;
--   2. has_admin_section_access() still used the legacy user_roles/app_role
--      helper for administrator bypass;
--   3. forms-hub source tables only recognized hard-coded admin roles (or
--      unrelated legacy contact permissions), not the forms-hub grant.

-- ---------------------------------------------------------------------
-- 1. Persist all four access levels exposed by RoleAccessEditor.
-- ---------------------------------------------------------------------
ALTER TABLE public.role_admin_section_access
  DROP CONSTRAINT IF EXISTS role_admin_section_access_access_level_check;

ALTER TABLE public.role_admin_section_access
  ADD CONSTRAINT role_admin_section_access_access_level_check
  CHECK (access_level IN ('none', 'view', 'edit', 'manage'));

ALTER TABLE public.role_admin_resource_access
  DROP CONSTRAINT IF EXISTS role_admin_resource_access_access_level_check;

ALTER TABLE public.role_admin_resource_access
  ADD CONSTRAINT role_admin_resource_access_access_level_check
  CHECK (access_level IN ('none', 'view', 'edit', 'manage'));

-- ---------------------------------------------------------------------
-- 2. Resolve section/resource access without dropping edit or explicit
--    resource-level none overrides. Highest role grant wins.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_admin_access(_user_id uuid)
RETURNS TABLE (
  section_code text,
  resource_code text,
  access_level text,
  source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;

  v_is_admin :=
    public.has_role_v2(_user_id, 'super_admin')
    OR public.has_role_v2(_user_id, 'admin');

  IF v_is_admin THEN
    RETURN QUERY
      SELECT s.code, NULL::text, 'manage'::text, 'admin_full'::text
      FROM public.admin_section s
      WHERE s.is_active
      UNION ALL
      SELECT s.code, r.code, 'manage'::text, 'admin_full'::text
      FROM public.admin_resource r
      JOIN public.admin_section s ON s.id = r.section_id
      WHERE s.is_active AND r.is_active;
    RETURN;
  END IF;

  RETURN QUERY
  WITH user_role_ids AS (
    SELECT ur.role_id
    FROM public.user_roles_v2 ur
    WHERE ur.user_id = _user_id
  ),
  section_grants AS (
    SELECT
      s.id AS section_id,
      s.code AS section_code,
      max(CASE rsa.access_level
        WHEN 'manage' THEN 3
        WHEN 'edit' THEN 2
        WHEN 'view' THEN 1
        ELSE 0
      END) AS level_rank
    FROM public.admin_section s
    JOIN public.role_admin_section_access rsa ON rsa.section_id = s.id
    JOIN user_role_ids ur ON ur.role_id = rsa.role_id
    WHERE s.is_active
    GROUP BY s.id, s.code
  ),
  resource_grants AS (
    SELECT
      r.id AS resource_id,
      r.section_id,
      r.code AS resource_code,
      s.code AS section_code,
      max(CASE rra.access_level
        WHEN 'manage' THEN 3
        WHEN 'edit' THEN 2
        WHEN 'view' THEN 1
        ELSE 0
      END) AS level_rank
    FROM public.admin_resource r
    JOIN public.admin_section s ON s.id = r.section_id
    JOIN public.role_admin_resource_access rra ON rra.resource_id = r.id
    JOIN user_role_ids ur ON ur.role_id = rra.role_id
    WHERE r.is_active AND s.is_active
    GROUP BY r.id, r.section_id, r.code, s.code
  )
  -- Section rows include explicit none; absence and none are equivalent for
  -- section gating, while retaining the row makes diagnostics factual.
  SELECT
    sg.section_code,
    NULL::text,
    CASE sg.level_rank
      WHEN 3 THEN 'manage'
      WHEN 2 THEN 'edit'
      WHEN 1 THEN 'view'
      ELSE 'none'
    END,
    'section'::text
  FROM section_grants sg

  UNION ALL

  -- Explicit resource overrides must include none. Omitting a none row makes
  -- the frontend fall back to the section grant and accidentally allows it.
  SELECT
    rg.section_code,
    rg.resource_code,
    CASE rg.level_rank
      WHEN 3 THEN 'manage'
      WHEN 2 THEN 'edit'
      WHEN 1 THEN 'view'
      ELSE 'none'
    END,
    'resource_override'::text
  FROM resource_grants rg

  UNION ALL

  -- Resources without an explicit override inherit their section level.
  SELECT
    s.code,
    r.code,
    CASE sg.level_rank
      WHEN 3 THEN 'manage'
      WHEN 2 THEN 'edit'
      WHEN 1 THEN 'view'
      ELSE 'none'
    END,
    'section'::text
  FROM public.admin_resource r
  JOIN public.admin_section s ON s.id = r.section_id
  JOIN section_grants sg ON sg.section_id = s.id
  WHERE r.is_active
    AND s.is_active
    AND NOT EXISTS (
      SELECT 1
      FROM resource_grants rg
      WHERE rg.resource_id = r.id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_access(uuid) TO authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.has_admin_section_access(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_admin_section_access(uuid, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Canonical contacts/deals: every viewer sees all historical rows.
--    Existing ownership policies remain intact for ordinary users.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "RBAC v3: view profiles by contacts section" ON public.profiles;
CREATE POLICY "RBAC v3: view profiles by contacts section"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'contacts', 'view'));

DROP POLICY IF EXISTS "RBAC v3: view orders by deals section" ON public.orders_v2;
CREATE POLICY "RBAC v3: view orders by deals section"
  ON public.orders_v2
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view'));

DROP POLICY IF EXISTS "RBAC v3: edit orders by deals section" ON public.orders_v2;
CREATE POLICY "RBAC v3: edit orders by deals section"
  ON public.orders_v2
  FOR UPDATE
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'deals', 'edit'))
  WITH CHECK (public.has_admin_section_access((SELECT auth.uid()), 'deals', 'edit'));

DROP POLICY IF EXISTS "RBAC v3: create orders by deals section" ON public.orders_v2;
CREATE POLICY "RBAC v3: create orders by deals section"
  ON public.orders_v2
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_admin_section_access((SELECT auth.uid()), 'deals', 'edit'));

-- ---------------------------------------------------------------------
-- 4. Forms hub: section grant controls every source used by
--    useFormsHubData, including historical/inactive metadata joins.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "RBAC v3: view site form submissions by forms hub" ON public.site_form_submissions;
CREATE POLICY "RBAC v3: view site form submissions by forms hub"
  ON public.site_form_submissions
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));

DROP POLICY IF EXISTS "RBAC v3: edit site form submissions by forms hub" ON public.site_form_submissions;
CREATE POLICY "RBAC v3: edit site form submissions by forms hub"
  ON public.site_form_submissions
  FOR UPDATE
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'edit'))
  WITH CHECK (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'edit'));

DROP POLICY IF EXISTS "RBAC v3: delete site form submissions by forms hub" ON public.site_form_submissions;
CREATE POLICY "RBAC v3: delete site form submissions by forms hub"
  ON public.site_form_submissions
  FOR DELETE
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view preregistrations by forms hub" ON public.course_preregistrations;
-- Remove the legacy cross-section staff grants. Ordinary user ownership
-- policies are not touched; staff access is now governed only by forms-hub.
DROP POLICY IF EXISTS "Admins can view all preregistrations" ON public.course_preregistrations;
DROP POLICY IF EXISTS "Admins can manage preregistrations" ON public.course_preregistrations;
CREATE POLICY "RBAC v3: view preregistrations by forms hub"
  ON public.course_preregistrations
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));

DROP POLICY IF EXISTS "RBAC v3: edit preregistrations by forms hub" ON public.course_preregistrations;
CREATE POLICY "RBAC v3: edit preregistrations by forms hub"
  ON public.course_preregistrations
  FOR UPDATE
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'edit'))
  WITH CHECK (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'edit'));

DROP POLICY IF EXISTS "RBAC v3: delete preregistrations by forms hub" ON public.course_preregistrations;
CREATE POLICY "RBAC v3: delete preregistrations by forms hub"
  ON public.course_preregistrations
  FOR DELETE
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'manage'));

DROP POLICY IF EXISTS "RBAC v3: view lesson progress by forms hub" ON public.lesson_progress_state;
CREATE POLICY "RBAC v3: view lesson progress by forms hub"
  ON public.lesson_progress_state
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));

DROP POLICY IF EXISTS "RBAC v3: view training modules by forms hub" ON public.training_modules;
CREATE POLICY "RBAC v3: view training modules by forms hub"
  ON public.training_modules
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));

DROP POLICY IF EXISTS "RBAC v3: view training lessons by forms hub" ON public.training_lessons;
CREATE POLICY "RBAC v3: view training lessons by forms hub"
  ON public.training_lessons
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));

DROP POLICY IF EXISTS "RBAC v3: view products by forms hub" ON public.products_v2;
CREATE POLICY "RBAC v3: view products by forms hub"
  ON public.products_v2
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));

DROP POLICY IF EXISTS "RBAC v3: view site pages by forms hub" ON public.site_pages;
CREATE POLICY "RBAC v3: view site pages by forms hub"
  ON public.site_pages
  FOR SELECT
  TO authenticated
  USING (public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view'));
