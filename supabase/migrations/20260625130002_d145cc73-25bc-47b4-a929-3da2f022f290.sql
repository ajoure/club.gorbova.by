INSERT INTO public.user_roles_v2 (user_id, role_id)
SELECT '913bc4cf-c68c-4a1b-a98d-adf778ef02d1', r.id
FROM public.roles r WHERE r.code='support'
ON CONFLICT (user_id, role_id) DO NOTHING;