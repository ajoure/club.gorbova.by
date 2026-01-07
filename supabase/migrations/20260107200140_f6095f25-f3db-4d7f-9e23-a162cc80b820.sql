-- Allow NULL user_id for ghost profiles (imported contacts without real auth users)
ALTER TABLE public.profiles 
  DROP CONSTRAINT profiles_user_id_fkey;

ALTER TABLE public.profiles 
  ALTER COLUMN user_id DROP NOT NULL;

-- Re-add FK but only validate for non-null values
ALTER TABLE public.profiles 
  ADD CONSTRAINT profiles_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;