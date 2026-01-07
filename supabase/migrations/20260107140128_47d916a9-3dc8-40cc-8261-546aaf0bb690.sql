-- Add changes field to privacy_policy_versions for version comparison
ALTER TABLE public.privacy_policy_versions 
ADD COLUMN IF NOT EXISTS changes jsonb DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN public.privacy_policy_versions.changes IS 'Array of changes from previous version: [{type: "added"|"changed"|"removed", text: string}]';

-- Update trigger for updated_at if not exists
CREATE OR REPLACE FUNCTION public.update_privacy_policy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.created_at = COALESCE(NEW.created_at, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;