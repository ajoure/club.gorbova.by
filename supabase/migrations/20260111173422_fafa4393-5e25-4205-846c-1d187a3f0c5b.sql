-- Fix FK constraint to allow profile deletion without blocking on duplicate_cases
ALTER TABLE public.duplicate_cases
DROP CONSTRAINT IF EXISTS duplicate_cases_master_profile_id_fkey;

ALTER TABLE public.duplicate_cases
ADD CONSTRAINT duplicate_cases_master_profile_id_fkey
FOREIGN KEY (master_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Also fix client_duplicates FK to CASCADE on delete
ALTER TABLE public.client_duplicates
DROP CONSTRAINT IF EXISTS client_duplicates_profile_id_fkey;

ALTER TABLE public.client_duplicates
ADD CONSTRAINT client_duplicates_profile_id_fkey
FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;