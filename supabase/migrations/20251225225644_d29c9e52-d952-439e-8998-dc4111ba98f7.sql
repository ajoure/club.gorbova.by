-- Drop existing app_role enum usage and recreate system

-- 1. Create roles table
CREATE TABLE IF NOT EXISTS public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Create permissions table
CREATE TABLE IF NOT EXISTS public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Create role_permissions junction table
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id, permission_id)
);

-- 4. Add columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- 5. Create new user_roles_v2 table with FK to roles
CREATE TABLE IF NOT EXISTS public.user_roles_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role_id)
);

-- 6. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  target_user_id uuid,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. Create entitlements table
CREATE TABLE IF NOT EXISTS public.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Create impersonation_sessions table
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz
);

-- Enable RLS on all new tables
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- Create has_permission function
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id
      AND p.code = _permission_code
  )
$$;

-- Create function to get user permissions
CREATE OR REPLACE FUNCTION public.get_user_permissions(_user_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT p.code), ARRAY[]::text[])
  FROM public.user_roles_v2 ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE ur.user_id = _user_id
$$;

-- Create function to check if user is super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.code = 'super_admin'
  )
$$;

-- RLS Policies for roles (read-only for all authenticated, manage for roles.manage permission)
CREATE POLICY "Authenticated can view roles" ON public.roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Roles manage permission required" ON public.roles
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'roles.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'roles.manage'));

-- RLS Policies for permissions
CREATE POLICY "Authenticated can view permissions" ON public.permissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Permissions manage required" ON public.permissions
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'roles.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'roles.manage'));

-- RLS Policies for role_permissions
CREATE POLICY "Authenticated can view role_permissions" ON public.role_permissions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Role permissions manage required" ON public.role_permissions
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'roles.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'roles.manage'));

-- RLS Policies for user_roles_v2
CREATE POLICY "Users can view own roles" ON public.user_roles_v2
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(), 'users.view'));

CREATE POLICY "Admins manage required for user roles" ON public.user_roles_v2
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'admins.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'admins.manage'));

-- RLS Policies for audit_logs
CREATE POLICY "Audit view permission required" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'audit.view'));

CREATE POLICY "Insert audit logs" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- RLS Policies for entitlements
CREATE POLICY "Users view own entitlements" ON public.entitlements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(), 'entitlements.view'));

CREATE POLICY "Entitlements manage required" ON public.entitlements
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'entitlements.manage'))
  WITH CHECK (public.has_permission(auth.uid(), 'entitlements.manage'));

-- RLS Policies for impersonation_sessions
CREATE POLICY "Impersonate permission required" ON public.impersonation_sessions
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'users.impersonate'))
  WITH CHECK (public.has_permission(auth.uid(), 'users.impersonate'));

-- Update profiles RLS to allow admin access
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(), 'users.view'));

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_permission(auth.uid(), 'users.update'));

-- Seed roles
INSERT INTO public.roles (code, name, description) VALUES
  ('super_admin', 'Супер-администратор', 'Полный доступ ко всем функциям'),
  ('admin', 'Администратор', 'Управление пользователями и контентом'),
  ('support', 'Поддержка', 'Помощь пользователям'),
  ('editor', 'Редактор', 'Управление контентом'),
  ('user', 'Пользователь', 'Базовый доступ')
ON CONFLICT (code) DO NOTHING;

-- Seed permissions
INSERT INTO public.permissions (code, name, category) VALUES
  -- Users
  ('users.view', 'Просмотр пользователей', 'users'),
  ('users.update', 'Редактирование пользователей', 'users'),
  ('users.block', 'Блокировка пользователей', 'users'),
  ('users.delete', 'Удаление пользователей', 'users'),
  ('users.reset_password', 'Сброс пароля', 'users'),
  ('users.impersonate', 'Вход от имени пользователя', 'users'),
  -- Roles/Admin
  ('roles.view', 'Просмотр ролей', 'roles'),
  ('roles.manage', 'Управление ролями', 'roles'),
  ('admins.manage', 'Управление администраторами', 'admins'),
  -- Content
  ('content.view', 'Просмотр контента', 'content'),
  ('content.edit', 'Редактирование контента', 'content'),
  ('content.publish', 'Публикация контента', 'content'),
  -- Entitlements
  ('entitlements.view', 'Просмотр доступов', 'entitlements'),
  ('entitlements.manage', 'Управление доступами', 'entitlements'),
  -- Audit/Security
  ('audit.view', 'Просмотр аудит-лога', 'audit'),
  ('security.manage', 'Управление безопасностью', 'security')
ON CONFLICT (code) DO NOTHING;

-- Seed role_permissions: super_admin gets all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'super_admin'
ON CONFLICT DO NOTHING;

-- admin gets all except security.manage and operations on super_admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'admin' AND p.code NOT IN ('security.manage')
ON CONFLICT DO NOTHING;

-- support permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'support' AND p.code IN (
  'users.view', 'users.update', 'users.block', 'users.reset_password',
  'entitlements.view', 'entitlements.manage', 'audit.view'
)
ON CONFLICT DO NOTHING;

-- editor permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.code = 'editor' AND p.code IN (
  'content.view', 'content.edit', 'content.publish'
)
ON CONFLICT DO NOTHING;

-- Migrate existing user_roles data to user_roles_v2
INSERT INTO public.user_roles_v2 (user_id, role_id)
SELECT ur.user_id, r.id
FROM public.user_roles ur
JOIN public.roles r ON r.code = ur.role::text
ON CONFLICT DO NOTHING;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_v2_user_id ON public.user_roles_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON public.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_entitlements_user_id ON public.entitlements(user_id);