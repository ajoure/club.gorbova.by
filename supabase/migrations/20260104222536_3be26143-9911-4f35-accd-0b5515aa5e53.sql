-- Create telegram_access_audit table for comprehensive access history
CREATE TABLE IF NOT EXISTS public.telegram_access_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES public.telegram_clubs(id) ON DELETE CASCADE,
  user_id UUID,
  telegram_user_id BIGINT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id UUID,
  reason TEXT,
  telegram_chat_result JSONB,
  telegram_channel_result JSONB,
  meta JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for efficient querying
CREATE INDEX idx_telegram_access_audit_user ON public.telegram_access_audit(user_id);
CREATE INDEX idx_telegram_access_audit_club ON public.telegram_access_audit(club_id);
CREATE INDEX idx_telegram_access_audit_telegram_user ON public.telegram_access_audit(telegram_user_id);
CREATE INDEX idx_telegram_access_audit_created ON public.telegram_access_audit(created_at DESC);

-- Enable RLS
ALTER TABLE public.telegram_access_audit ENABLE ROW LEVEL SECURITY;

-- Allow admins to read all audit records
CREATE POLICY "Admins can read all audit records"
ON public.telegram_access_audit
FOR SELECT
USING (
  public.has_permission(auth.uid(), 'telegram.clubs.manage') OR
  public.is_super_admin(auth.uid())
);

-- System can insert audit records (via service role)
CREATE POLICY "Service role can insert audit records"
ON public.telegram_access_audit
FOR INSERT
WITH CHECK (true);

-- Add join_request_mode to telegram_clubs
ALTER TABLE public.telegram_clubs 
ADD COLUMN IF NOT EXISTS join_request_mode BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_status_check_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS auto_resync_enabled BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS auto_resync_interval_minutes INTEGER DEFAULT 60;

-- Add telegram status check fields to telegram_club_members
ALTER TABLE public.telegram_club_members
ADD COLUMN IF NOT EXISTS last_telegram_check_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_telegram_check_result JSONB,
ADD COLUMN IF NOT EXISTS can_dm BOOLEAN DEFAULT true;

-- Add comment for documentation
COMMENT ON TABLE public.telegram_access_audit IS 'Comprehensive audit log for all Telegram access events including grants, revokes, kicks, DMs, and join request handling';

COMMENT ON COLUMN public.telegram_access_audit.event_type IS 'GRANT, REVOKE, RESYNC, JOIN_APPROVED, JOIN_DECLINED, KICK_CHAT, KICK_CHANNEL, DM_SENT, DM_FAILED, STATUS_CHECK';
COMMENT ON COLUMN public.telegram_access_audit.actor_type IS 'system, admin, cron';
COMMENT ON COLUMN public.telegram_clubs.join_request_mode IS 'When enabled, invite links require approval via chat_join_request';