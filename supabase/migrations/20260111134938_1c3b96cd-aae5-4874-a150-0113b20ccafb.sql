-- Add import_batch_id column to profiles for rollback capability
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS import_batch_id UUID;

-- Create index for efficient rollback queries
CREATE INDEX IF NOT EXISTS idx_profiles_import_batch_id ON profiles(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN profiles.import_batch_id IS 'Links profile to the import job that created/updated it. Used for rollback capability.';