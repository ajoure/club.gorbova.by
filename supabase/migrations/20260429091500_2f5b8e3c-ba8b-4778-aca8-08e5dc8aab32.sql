-- PATCH-2026-04-29: per-subscription idempotency for daily reminder events.
-- Previous unique index (user_id, event_type, event_day) suppressed reminders
-- when a single user had several subscriptions in the same day.
-- We now include subscription_id (from meta) to make the lock per-subscription.

DROP INDEX IF EXISTS public.idx_telegram_logs_reminder_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_logs_reminder_unique
ON public.telegram_logs (
  user_id,
  event_type,
  event_day,
  ((meta->>'subscription_id'))
)
WHERE event_type LIKE 'subscription_reminder_%'
   OR event_type = 'subscription_no_card_warning';

COMMENT ON INDEX public.idx_telegram_logs_reminder_unique
IS 'Per-(user, event_type, day, subscription_id) idempotency lock for daily renewal reminders. PATCH-2026-04-29.';