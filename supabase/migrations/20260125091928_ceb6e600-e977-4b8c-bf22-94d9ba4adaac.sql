-- PATCH 3: Add event_day column for idempotency + partial unique index
-- Using trigger approach since GENERATED column with date cast is not immutable

-- 1. Add regular date column
ALTER TABLE telegram_logs 
ADD COLUMN IF NOT EXISTS event_day date;

-- 2. Create trigger function to auto-populate event_day
CREATE OR REPLACE FUNCTION set_telegram_log_event_day()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  -- Use date in UTC for consistency
  NEW.event_day := (NEW.created_at AT TIME ZONE 'UTC')::date;
  RETURN NEW;
END;
$$;

-- 3. Create trigger
DROP TRIGGER IF EXISTS trg_telegram_logs_event_day ON telegram_logs;
CREATE TRIGGER trg_telegram_logs_event_day
BEFORE INSERT ON telegram_logs
FOR EACH ROW
EXECUTE FUNCTION set_telegram_log_event_day();

-- 4. Backfill existing rows
UPDATE telegram_logs 
SET event_day = (created_at AT TIME ZONE 'UTC')::date
WHERE event_day IS NULL;

-- 5. Create partial unique index for reminder idempotency
-- Prevents duplicate reminders for same user, event_type, day
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_logs_reminder_unique
ON telegram_logs (user_id, event_type, event_day)
WHERE event_type LIKE 'subscription_reminder_%' 
   OR event_type = 'subscription_no_card_warning';

-- 6. Add comment for documentation
COMMENT ON COLUMN telegram_logs.event_day IS 'Date (UTC) of log entry for idempotency constraint on daily reminders';