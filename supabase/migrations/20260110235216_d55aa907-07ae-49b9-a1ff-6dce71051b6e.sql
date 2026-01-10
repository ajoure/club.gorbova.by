-- Add position field to profiles for job titles from amoCRM
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS position text;

-- Add comment
COMMENT ON COLUMN profiles.position IS 'Job title/position from amoCRM or other sources';