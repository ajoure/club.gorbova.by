-- Add is_container flag to training_modules
-- Container modules hold standalone lessons that display as individual cards

ALTER TABLE public.training_modules 
ADD COLUMN IF NOT EXISTS is_container BOOLEAN DEFAULT false;

-- Add index for efficient container queries
CREATE INDEX IF NOT EXISTS idx_training_modules_is_container 
ON public.training_modules (menu_section_key, is_container) 
WHERE is_container = true;

-- Comment for documentation
COMMENT ON COLUMN public.training_modules.is_container IS 'When true, lessons in this module display as standalone cards instead of as part of a module';