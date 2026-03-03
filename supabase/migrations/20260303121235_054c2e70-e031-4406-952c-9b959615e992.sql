
-- PATCH 1: GC Contacts Import — profiles extensions + external_id_gc uniqueness
-- Add-only. Safe to run multiple times.

-- 1) Add new optional fields (no breaking changes)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country text NULL,
  ADD COLUMN IF NOT EXISTS city text NULL,
  ADD COLUMN IF NOT EXISTS birth_date date NULL,
  ADD COLUMN IF NOT EXISTS instagram_url text NULL,
  ADD COLUMN IF NOT EXISTS gc_registered_at date NULL;

COMMENT ON COLUMN public.profiles.country IS 'Country from external sources (e.g., GetCourse). Optional.';
COMMENT ON COLUMN public.profiles.city IS 'City from external sources (e.g., GetCourse). Optional.';
COMMENT ON COLUMN public.profiles.birth_date IS 'Birth date from external sources (e.g., GetCourse). Optional.';
COMMENT ON COLUMN public.profiles.instagram_url IS 'Instagram profile link (https://instagram.com/...). Optional.';
COMMENT ON COLUMN public.profiles.gc_registered_at IS 'Registration date in GetCourse (separate from profiles.created_at). Optional.';

-- 2) Idempotency key: external_id_gc must be unique when present
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_external_id_gc_unique
  ON public.profiles (external_id_gc)
  WHERE external_id_gc IS NOT NULL;
