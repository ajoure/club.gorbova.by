-- Add missing permission for Telegram analytics access
INSERT INTO public.permissions (code, name, category)
VALUES ('telegram.manage', 'Управление Telegram', 'telegram')
ON CONFLICT (code) DO NOTHING;

-- Grant permission to admin roles
WITH perm AS (
  SELECT id AS permission_id FROM public.permissions WHERE code = 'telegram.manage'
), target_roles AS (
  SELECT id AS role_id FROM public.roles WHERE code IN ('admin', 'super_admin')
)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT tr.role_id, p.permission_id
FROM target_roles tr
CROSS JOIN perm p
ON CONFLICT (role_id, permission_id) DO NOTHING;