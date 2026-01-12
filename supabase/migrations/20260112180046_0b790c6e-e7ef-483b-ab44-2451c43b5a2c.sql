-- Добавить CRM-права
INSERT INTO public.permissions (code, name, category) VALUES
  ('contacts.view', 'Просмотр контактов', 'contacts'),
  ('contacts.edit', 'Редактирование контактов', 'contacts'),
  ('deals.view', 'Просмотр сделок', 'deals'),
  ('deals.edit', 'Редактирование сделок', 'deals'),
  ('orders.view', 'Просмотр заказов', 'orders'),
  ('orders.edit', 'Редактирование заказов', 'orders')
ON CONFLICT (code) DO NOTHING;

-- Назначить CRM-права super_admin и admin
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('super_admin', 'admin')
  AND p.code IN ('contacts.view', 'contacts.edit', 'deals.view', 'deals.edit', 'orders.view', 'orders.edit')
ON CONFLICT DO NOTHING;

-- Назначить view-права support
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'support'
  AND p.code IN ('contacts.view', 'orders.view')
ON CONFLICT DO NOTHING;