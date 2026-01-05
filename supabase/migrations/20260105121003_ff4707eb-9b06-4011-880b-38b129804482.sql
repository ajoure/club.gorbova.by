-- Add status tracking to profiles for telegram link
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS telegram_link_status text DEFAULT 'not_linked',
ADD COLUMN IF NOT EXISTS telegram_link_bot_id uuid REFERENCES public.telegram_bots(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS telegram_last_check_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS telegram_last_error text;

-- Add is_primary flag to telegram_bots to mark the main bot for user linking
ALTER TABLE public.telegram_bots
ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT false;

-- Extend telegram_link_tokens for better session tracking
ALTER TABLE public.telegram_link_tokens
ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS bot_id uuid REFERENCES public.telegram_bots(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS action_type text DEFAULT 'link'; -- link, relink

-- Add comment for valid statuses
COMMENT ON COLUMN public.profiles.telegram_link_status IS 'Status: not_linked, pending, active, inactive';
COMMENT ON COLUMN public.telegram_link_tokens.status IS 'Status: pending, confirmed, expired, cancelled';
COMMENT ON COLUMN public.telegram_link_tokens.action_type IS 'Type: link, relink';

-- Update existing linked profiles to have active status
UPDATE public.profiles 
SET telegram_link_status = 'active' 
WHERE telegram_user_id IS NOT NULL AND telegram_link_status = 'not_linked';

-- Create function to automatically set status on link/unlink
CREATE OR REPLACE FUNCTION public.update_telegram_link_status()
RETURNS trigger AS $$
BEGIN
  IF NEW.telegram_user_id IS NOT NULL AND (OLD.telegram_user_id IS NULL OR OLD.telegram_user_id != NEW.telegram_user_id) THEN
    NEW.telegram_link_status := 'active';
    NEW.telegram_linked_at := COALESCE(NEW.telegram_linked_at, now());
  ELSIF NEW.telegram_user_id IS NULL AND OLD.telegram_user_id IS NOT NULL THEN
    NEW.telegram_link_status := 'not_linked';
    NEW.telegram_linked_at := NULL;
    NEW.telegram_link_bot_id := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_telegram_link_status ON public.profiles;
CREATE TRIGGER trigger_update_telegram_link_status
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_telegram_link_status();

-- Add audit event types for telegram linking
-- (telegram_access_audit already exists, we'll use it with new event types)