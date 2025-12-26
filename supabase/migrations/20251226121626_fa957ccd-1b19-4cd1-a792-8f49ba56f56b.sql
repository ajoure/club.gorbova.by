-- Add phone column to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

-- Update handle_new_user trigger to handle phone
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _user_role_id uuid;
BEGIN
  -- Create profile with phone
  INSERT INTO public.profiles (user_id, email, full_name, phone)
  VALUES (
    NEW.id, 
    NEW.email, 
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'phone'
  );
  
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
$function$;