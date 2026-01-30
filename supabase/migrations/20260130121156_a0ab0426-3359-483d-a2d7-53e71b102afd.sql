-- 1. RLS для чтения module_access (все авторизованные)
CREATE POLICY "Authenticated users can read module_access"
ON public.module_access
FOR SELECT
TO authenticated
USING (true);

-- 2. Добавить permission content.manage
INSERT INTO public.permissions (code, name, category)
VALUES ('content.manage', 'Управление контентом', 'content')
ON CONFLICT (code) DO NOTHING;

-- 3. Привязать content.manage к ролям admin и super_admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('admin', 'super_admin')
  AND p.code = 'content.manage'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );