INSERT INTO public.admin_section (code, label, route_prefix, icon, sort_order, group_code, is_active)
VALUES ('calls', 'Звонки и SMS', '/admin/calls', 'Phone', 1, 'crm', true)
ON CONFLICT (code) DO UPDATE
   SET label = EXCLUDED.label,
       route_prefix = EXCLUDED.route_prefix,
       group_code = EXCLUDED.group_code,
       is_active = true;