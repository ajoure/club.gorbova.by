-- Add JSONB columns for multiple contacts
-- Structure: [{"value": "email@example.com", "is_primary": true, "label": "личный"}]

ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS emails jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS phones jsonb DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.emails IS 'Array of email addresses with is_primary flag';
COMMENT ON COLUMN public.profiles.phones IS 'Array of phone numbers with is_primary flag';