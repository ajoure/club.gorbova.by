-- Add autokick setting to telegram_clubs
ALTER TABLE public.telegram_clubs 
ADD COLUMN IF NOT EXISTS autokick_no_access BOOLEAN DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.telegram_clubs.autokick_no_access IS 'Auto kick users without access during sync/cron';
COMMENT ON COLUMN public.telegram_clubs.join_request_mode IS 'Enable join request mode for chat/channel access control';