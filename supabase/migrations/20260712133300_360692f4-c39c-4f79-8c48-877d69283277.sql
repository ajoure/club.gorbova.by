-- Restore split idempotency semantics for order_notification_deliveries:
-- buyer channels (email/telegram) unique per (order_id, channel, notification_type)
-- admin channel (telegram_admin) unique per (order_id, channel, notification_type, recipient)

DROP INDEX IF EXISTS public.order_notification_deliveries_unique_v2;

CREATE UNIQUE INDEX IF NOT EXISTS order_notification_deliveries_unique_buyer
  ON public.order_notification_deliveries (order_id, channel, notification_type)
  WHERE channel IN ('email', 'telegram');

CREATE UNIQUE INDEX IF NOT EXISTS order_notification_deliveries_unique_admin
  ON public.order_notification_deliveries (order_id, channel, notification_type, recipient)
  WHERE channel = 'telegram_admin';