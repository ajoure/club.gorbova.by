
-- 1. CREATE TABLE
CREATE TABLE public.document_package_item_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_session_id uuid NOT NULL
    REFERENCES public.document_package_sessions(id) ON DELETE CASCADE,
  package_template_item_id uuid NOT NULL
    REFERENCES public.document_package_template_items(id) ON DELETE CASCADE,
  role_catalog_id uuid NOT NULL
    REFERENCES public.document_package_role_catalog(id) ON DELETE RESTRICT,
  person_id uuid NULL
    REFERENCES public.legal_details_persons(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL
);

CREATE INDEX idx_dpira_session_item
  ON public.document_package_item_role_assignments (package_session_id, package_template_item_id);
CREATE INDEX idx_dpira_role
  ON public.document_package_item_role_assignments (role_catalog_id);
CREATE INDEX idx_dpira_person
  ON public.document_package_item_role_assignments (person_id) WHERE person_id IS NOT NULL;

-- Partial unique guard: нельзя назначить одного и того же person на одну и ту же
-- роль в одном и том же документе пакета дважды (только активные).
CREATE UNIQUE INDEX ux_dpira_active_person
  ON public.document_package_item_role_assignments
  (package_session_id, package_template_item_id, role_catalog_id, person_id)
  WHERE is_active = true AND person_id IS NOT NULL;

-- 2. GRANT
GRANT SELECT, INSERT, UPDATE ON public.document_package_item_role_assignments TO authenticated;
GRANT ALL ON public.document_package_item_role_assignments TO service_role;

-- 3. ENABLE RLS
ALTER TABLE public.document_package_item_role_assignments ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES
-- Admin all
CREATE POLICY dpira_admin_all
  ON public.document_package_item_role_assignments
  TO authenticated
  USING (has_role_v2(auth.uid(), 'super_admin') OR has_role_v2(auth.uid(), 'admin'))
  WITH CHECK (has_role_v2(auth.uid(), 'super_admin') OR has_role_v2(auth.uid(), 'admin'));

-- Owner SELECT
CREATE POLICY dpira_select_own
  ON public.document_package_item_role_assignments
  FOR SELECT
  TO authenticated
  USING (
    package_session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Owner INSERT
CREATE POLICY dpira_insert_own
  ON public.document_package_item_role_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    package_session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Owner UPDATE (для архивации/смены person)
CREATE POLICY dpira_update_own
  ON public.document_package_item_role_assignments
  FOR UPDATE
  TO authenticated
  USING (
    package_session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    package_session_id IN (
      SELECT s.id FROM public.document_package_sessions s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.user_id = auth.uid()
    )
  );

-- Hard DELETE запрещён всем кроме service_role: политики DELETE нет → пользователь
-- не сможет удалить. Архивация = UPDATE is_active=false.

-- 5. TRIGGER: роль должна принадлежать тому же пакету, что и template_item.
CREATE OR REPLACE FUNCTION public.dpira_assert_package_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role_pkg uuid;
  v_item_pkg uuid;
  v_session_pkg uuid;
BEGIN
  SELECT package_template_id INTO v_role_pkg
    FROM public.document_package_role_catalog WHERE id = NEW.role_catalog_id;
  SELECT package_template_id INTO v_item_pkg
    FROM public.document_package_template_items WHERE id = NEW.package_template_item_id;
  SELECT package_template_id INTO v_session_pkg
    FROM public.document_package_sessions WHERE id = NEW.package_session_id;
  IF v_role_pkg IS NULL OR v_item_pkg IS NULL OR v_session_pkg IS NULL THEN
    RAISE EXCEPTION 'dpira_invalid_references';
  END IF;
  IF v_role_pkg <> v_item_pkg THEN
    RAISE EXCEPTION 'pkr_outside_bound_package: role.package=% item.package=%',
      v_role_pkg, v_item_pkg;
  END IF;
  IF v_session_pkg <> v_item_pkg THEN
    RAISE EXCEPTION 'session_outside_bound_package: session.package=% item.package=%',
      v_session_pkg, v_item_pkg;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dpira_assert_package_match
  BEFORE INSERT OR UPDATE OF role_catalog_id, package_template_item_id, package_session_id
  ON public.document_package_item_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.dpira_assert_package_match();

-- updated_at trigger (используем существующий шаблон)
CREATE TRIGGER trg_dpira_updated_at
  BEFORE UPDATE ON public.document_package_item_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
