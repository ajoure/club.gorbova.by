-- Remove duplicate trigger that conflicts with handle_new_user
-- The handle_new_user trigger already handles profile creation and linking

DROP TRIGGER IF EXISTS on_auth_user_created_link_profile ON auth.users;
DROP FUNCTION IF EXISTS public.link_profile_on_user_create();