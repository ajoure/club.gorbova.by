-- Update handle_new_user to also assign user role in user_roles_v2
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_role_id uuid;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  
  -- Assign default user role (legacy table)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Get the user role ID from roles table
  SELECT id INTO _user_role_id FROM public.roles WHERE code = 'user';
  
  -- Assign user role in user_roles_v2 if the role exists
  IF _user_role_id IS NOT NULL THEN
    INSERT INTO public.user_roles_v2 (user_id, role_id)
    VALUES (NEW.id, _user_role_id)
    ON CONFLICT DO NOTHING;
  END IF;
  
  -- Create free subscription
  INSERT INTO public.subscriptions (user_id, tier)
  VALUES (NEW.id, 'free');
  
  RETURN NEW;
END;
$$;

-- Assign user role to existing users without any role in user_roles_v2
INSERT INTO public.user_roles_v2 (user_id, role_id)
SELECT p.user_id, r.id
FROM public.profiles p
CROSS JOIN public.roles r
LEFT JOIN public.user_roles_v2 urv ON p.user_id = urv.user_id
WHERE urv.id IS NULL AND r.code = 'user'
ON CONFLICT DO NOTHING;