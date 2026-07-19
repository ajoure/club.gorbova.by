-- CRM Companies UI: register the protected admin section.
-- No company data is created or backfilled by this migration.
INSERT INTO public.admin_section (
  code, label, route_prefix, icon, sort_order, group_code, is_active
) VALUES (
  'companies', 'Компании', '/admin/companies', 'Building2', 4, 'crm', true
)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    route_prefix = EXCLUDED.route_prefix,
    icon = EXCLUDED.icon,
    sort_order = EXCLUDED.sort_order,
    group_code = EXCLUDED.group_code,
    is_active = true,
    updated_at = now();
