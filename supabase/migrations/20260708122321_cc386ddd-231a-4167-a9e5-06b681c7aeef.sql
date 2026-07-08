CREATE UNIQUE INDEX IF NOT EXISTS uniq_tg_msg_purchase_dm_order
ON public.telegram_messages ((meta->>'source_order_id'))
WHERE meta->>'source' = 'notify-order-purchased'
  AND meta->>'event' = 'product_purchased_dm'
  AND meta->>'source_order_id' IS NOT NULL;