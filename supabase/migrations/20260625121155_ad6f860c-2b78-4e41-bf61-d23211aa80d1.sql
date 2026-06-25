-- ============================================================
-- RBAC v3 — Migration B: таблицы прав ролей
-- ============================================================

-- ------------------------------------------------------------
-- role_admin_section_access
-- ------------------------------------------------------------
CREATE TABLE public.role_admin_section_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id    text UNIQUE NOT NULL DEFAULT public.generate_admin_catalog_public_id('rsa'),
  role_id      uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  section_id   uuid NOT NULL REFERENCES public.admin_section(id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('none','view','manage')),
  workspace_id uuid,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (role_id, section_id)
);

CREATE INDEX idx_rasa_role     ON public.role_admin_section_access (role_id);
CREATE INDEX idx_rasa_section  ON public.role_admin_section_access (section_id);

CREATE TRIGGER trg_rasa_updated_at
  BEFORE UPDATE ON public.role_admin_section_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- GRANTs: чтение через RPC (security definer), прямой SELECT для отладки разрешён
-- админам; запись закрыта вообще для authenticated (только service_role через edge).
GRANT SELECT ON public.role_admin_section_access TO authenticated;
GRANT ALL    ON public.role_admin_section_access TO service_role;

ALTER TABLE public.role_admin_section_access ENABLE ROW LEVEL SECURITY;

-- читать может только admin/super_admin (для прямой отладки в админке)
CREATE POLICY "rasa read for admins"
  ON public.role_admin_section_access
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- запись через client запрещена полностью; идёт только через service_role в edge
-- (специально НЕ создаём INSERT/UPDATE/DELETE policy для authenticated).

-- ------------------------------------------------------------
-- role_admin_resource_access
-- ------------------------------------------------------------
CREATE TABLE public.role_admin_resource_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id    text UNIQUE NOT NULL DEFAULT public.generate_admin_catalog_public_id('rra'),
  role_id      uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  resource_id  uuid NOT NULL REFERENCES public.admin_resource(id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('none','view','manage')),
  workspace_id uuid,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (role_id, resource_id)
);

CREATE INDEX idx_rara_role     ON public.role_admin_resource_access (role_id);
CREATE INDEX idx_rara_resource ON public.role_admin_resource_access (resource_id);

CREATE TRIGGER trg_rara_updated_at
  BEFORE UPDATE ON public.role_admin_resource_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.role_admin_resource_access TO authenticated;
GRANT ALL    ON public.role_admin_resource_access TO service_role;

ALTER TABLE public.role_admin_resource_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rara read for admins"
  ON public.role_admin_resource_access
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
  );

-- ============================================================
COMMENT ON TABLE public.role_admin_section_access IS
  'RBAC v3: уровень доступа роли к секции левого меню. Запись только через edge roles-admin.';
COMMENT ON TABLE public.role_admin_resource_access IS
  'RBAC v3: точечное переопределение уровня доступа роли к ресурсу (тaбу/подстранице) внутри секции.';