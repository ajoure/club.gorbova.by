-- Add event_type column to telegram_logs for tracking notification types
ALTER TABLE telegram_logs ADD COLUMN IF NOT EXISTS event_type TEXT;

-- Create index for efficient lookups by event_type and date
CREATE INDEX IF NOT EXISTS idx_telegram_logs_event_type ON telegram_logs(event_type) WHERE event_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_logs_created_event ON telegram_logs(created_at DESC, event_type) WHERE event_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_telegram_logs_user_event ON telegram_logs(user_id, event_type, created_at DESC) WHERE user_id IS NOT NULL AND event_type IS NOT NULL;

COMMENT ON COLUMN telegram_logs.event_type IS 'Type of notification event: subscription_reminder_7d, subscription_reminder_3d, subscription_reminder_1d, subscription_no_card_warning, renewal_success, renewal_failure, etc.';