-- Partial index for bepaid_uid idempotency in orders_v2
-- Speeds up the idempotency check: .contains('meta', { bepaid_uid: ... })
CREATE INDEX IF NOT EXISTS idx_orders_v2_bepaid_uid_meta 
ON public.orders_v2 ((meta->>'bepaid_uid')) 
WHERE meta->>'bepaid_uid' IS NOT NULL;

COMMENT ON INDEX idx_orders_v2_bepaid_uid_meta IS 
'Supports idempotency check in subscription-charge and backfill for renewal order creation by bepaid_uid';

-- Partial index for finding orphan payments quickly
CREATE INDEX IF NOT EXISTS idx_payments_v2_orphan 
ON public.payments_v2 (status, order_id) 
WHERE status = 'succeeded' AND order_id IS NULL;

COMMENT ON INDEX idx_payments_v2_orphan IS 
'Supports finding orphan succeeded payments without order_id for backfill operations';