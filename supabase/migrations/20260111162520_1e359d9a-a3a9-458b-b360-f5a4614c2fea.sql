-- Drop unique index on email to allow duplicates
DROP INDEX IF EXISTS profiles_email_unique_idx;

-- Add duplicate_type column to duplicate_cases table
ALTER TABLE public.duplicate_cases 
ADD COLUMN IF NOT EXISTS duplicate_type text DEFAULT 'phone' 
CHECK (duplicate_type IN ('phone', 'email', 'manual'));

-- Add comment
COMMENT ON COLUMN public.duplicate_cases.duplicate_type IS 'Type of duplicate: phone, email, or manual';