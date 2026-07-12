
ALTER TABLE public.order_notification_deliveries
  DROP CONSTRAINT IF EXISTS order_notification_deliveries_channel_check;
ALTER TABLE public.order_notification_deliveries
  ADD CONSTRAINT order_notification_deliveries_channel_check
  CHECK (channel = ANY (ARRAY['telegram'::text, 'email'::text, 'telegram_admin'::text]));

ALTER TABLE public.order_notification_deliveries
  DROP CONSTRAINT IF EXISTS order_notification_deliveries_unique;

CREATE UNIQUE INDEX IF NOT EXISTS order_notification_deliveries_unique_v2
  ON public.order_notification_deliveries
  (order_id, channel, notification_type, COALESCE(recipient, ''));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_tg_msg_admin_purchase_dm
  ON public.telegram_messages ((meta->>'source_order_id'), (meta->>'admin_telegram_user_id'))
  WHERE (meta->>'source') = 'notify-order-purchased'
    AND (meta->>'event') = 'product_purchased_admin_dm'
    AND (meta->>'source_order_id') IS NOT NULL
    AND (meta->>'admin_telegram_user_id') IS NOT NULL;
