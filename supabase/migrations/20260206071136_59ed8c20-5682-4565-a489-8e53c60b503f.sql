-- Таблица для игнорируемых проверок здоровья системы
CREATE TABLE public.system_health_ignored_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_key TEXT NOT NULL,
  ignored_by UUID REFERENCES auth.users(id),
  reason TEXT NOT NULL,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'auto', 'migration')),
  ignored_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, -- NULL = permanent
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Обычный индекс на check_key (partial index с now() невозможен)
CREATE INDEX idx_ignored_checks_key ON system_health_ignored_checks (check_key);
CREATE INDEX idx_ignored_checks_expires ON system_health_ignored_checks (expires_at) WHERE expires_at IS NOT NULL;

-- RLS: только super_admin может читать/писать
ALTER TABLE system_health_ignored_checks ENABLE ROW LEVEL SECURITY;

-- Функция проверки super_admin через user_roles_v2
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM user_roles_v2 ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = _user_id
    AND r.code = 'super_admin'
  )
$$;

-- Политика: только super_admin может всё
CREATE POLICY "Super admins can manage ignored checks"
  ON system_health_ignored_checks
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));