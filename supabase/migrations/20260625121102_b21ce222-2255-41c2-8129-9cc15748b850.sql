-- ============================================================
-- RBAC v3 — Migration A: каталог админ-секций и ресурсов
-- ============================================================

-- helper: генератор public_id (если ещё нет)
CREATE OR REPLACE FUNCTION public.generate_admin_catalog_public_id(_prefix text)
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT _prefix || '_' || encode(gen_random_bytes(6), 'hex')
$$;

-- ============================================================
-- admin_section
-- ============================================================
CREATE TABLE public.admin_section (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id    text UNIQUE NOT NULL DEFAULT public.generate_admin_catalog_public_id('asec'),
  code         text UNIQUE NOT NULL,
  label        text NOT NULL,
  route_prefix text NOT NULL,
  icon         text,
  sort_order   integer NOT NULL DEFAULT 0,
  group_code   text,                              -- "crm" | "service" — для группировки в редакторе
  workspace_id uuid,                              -- задел под мультитенант
  is_active    boolean NOT NULL DEFAULT true,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_admin_section_active_sort
  ON public.admin_section (is_active, sort_order);

CREATE TRIGGER trg_admin_section_updated_at
  BEFORE UPDATE ON public.admin_section
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT          ON public.admin_section TO authenticated;
GRANT INSERT, UPDATE  ON public.admin_section TO authenticated;
GRANT ALL             ON public.admin_section TO service_role;

ALTER TABLE public.admin_section ENABLE ROW LEVEL SECURITY;

-- любой авторизованный читает (каталог нечувствителен)
CREATE POLICY "admin_section read for authenticated"
  ON public.admin_section
  FOR SELECT
  TO authenticated
  USING (true);

-- запись — только super_admin
CREATE POLICY "admin_section write only super_admin"
  ON public.admin_section
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "admin_section update only super_admin"
  ON public.admin_section
  FOR UPDATE
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

-- ============================================================
-- admin_resource
-- ============================================================
CREATE TABLE public.admin_resource (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id    text UNIQUE NOT NULL DEFAULT public.generate_admin_catalog_public_id('ares'),
  section_id   uuid NOT NULL REFERENCES public.admin_section(id) ON DELETE RESTRICT,
  code         text NOT NULL,
  label        text NOT NULL,
  route        text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  workspace_id uuid,
  is_active    boolean NOT NULL DEFAULT true,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (section_id, code)
);

CREATE INDEX idx_admin_resource_section_sort
  ON public.admin_resource (section_id, is_active, sort_order);

CREATE TRIGGER trg_admin_resource_updated_at
  BEFORE UPDATE ON public.admin_resource
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT          ON public.admin_resource TO authenticated;
GRANT INSERT, UPDATE  ON public.admin_resource TO authenticated;
GRANT ALL             ON public.admin_resource TO service_role;

ALTER TABLE public.admin_resource ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_resource read for authenticated"
  ON public.admin_resource
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_resource write only super_admin"
  ON public.admin_resource
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

CREATE POLICY "admin_resource update only super_admin"
  ON public.admin_resource
  FOR UPDATE
  TO authenticated
  USING (public.has_role_v2(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role_v2(auth.uid(), 'super_admin'));

-- ============================================================
-- Sanity: фиксируем комментарии для будущих ревьюеров
-- ============================================================
COMMENT ON TABLE public.admin_section IS
  'RBAC v3 каталог админ-секций (левое меню). SOT, синхронизируется из DEFAULT_MENU через sync_admin_menu_registry().';
COMMENT ON TABLE public.admin_resource IS
  'RBAC v3 каталог админ-ресурсов (подразделы/табы внутри секций). Связь с секцией через section_id.';
COMMENT ON COLUMN public.admin_section.workspace_id IS
  'Задел под мультитенант. Сейчас всегда NULL (глобальный каталог). Не менять без отдельной миграции.';