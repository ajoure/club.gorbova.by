-- Least-privilege access for the manual-payment workflow.
-- Support and managers may register a payment confirmed outside acquiring,
-- without receiving edit rights for the whole Payments section.

WITH payments_section AS (
  SELECT id
  FROM public.admin_section
  WHERE code = 'payments'
)
INSERT INTO public.admin_resource (
  section_id,
  code,
  label,
  route,
  sort_order,
  is_active
)
SELECT
  payments_section.id,
  'manual-payment',
  'Ручной платёж',
  '/admin/payments?action=manual-payment',
  90,
  true
FROM payments_section
ON CONFLICT (section_id, code) DO UPDATE SET
  label = EXCLUDED.label,
  route = EXCLUDED.route,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

WITH manual_payment_resource AS (
  SELECT resource.id
  FROM public.admin_resource resource
  JOIN public.admin_section section_row ON section_row.id = resource.section_id
  WHERE section_row.code = 'payments'
    AND resource.code = 'manual-payment'
), allowed_roles AS (
  SELECT id
  FROM public.roles
  WHERE code IN ('support', 'menedzher')
)
INSERT INTO public.role_admin_resource_access (
  role_id,
  resource_id,
  access_level,
  metadata
)
SELECT
  allowed_roles.id,
  manual_payment_resource.id,
  'edit',
  jsonb_build_object('source', 'manual_payment_resource_access')
FROM allowed_roles
CROSS JOIN manual_payment_resource
ON CONFLICT (role_id, resource_id) DO UPDATE SET
  access_level = CASE
    WHEN public.role_admin_resource_access.access_level = 'manage' THEN 'manage'
    ELSE 'edit'
  END,
  metadata = public.role_admin_resource_access.metadata
    || jsonb_build_object('source', 'manual_payment_resource_access'),
  updated_at = now();

INSERT INTO public.audit_logs (
  action,
  actor_user_id,
  actor_type,
  entity_type,
  meta
)
VALUES (
  'rbac_v3.manual_payment_resource_access',
  NULL,
  'system',
  'admin_resource',
  jsonb_build_object(
    'section', 'payments',
    'resource', 'manual-payment',
    'roles', ARRAY['support', 'menedzher'],
    'level', 'edit'
  )
);