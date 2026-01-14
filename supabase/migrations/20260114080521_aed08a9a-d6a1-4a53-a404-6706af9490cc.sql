-- Add receipt and refund columns to payments_v2
ALTER TABLE payments_v2 
ADD COLUMN IF NOT EXISTS receipt_url text;

ALTER TABLE payments_v2 
ADD COLUMN IF NOT EXISTS refunds jsonb DEFAULT '[]'::jsonb;

ALTER TABLE payments_v2 
ADD COLUMN IF NOT EXISTS refunded_amount numeric DEFAULT 0;

ALTER TABLE payments_v2 
ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

-- Index for finding bePaid payments without receipt
CREATE INDEX IF NOT EXISTS idx_payments_v2_bepaid_no_receipt 
ON payments_v2 (order_id)
WHERE provider = 'bepaid' 
  AND provider_payment_id IS NOT NULL
  AND receipt_url IS NULL;

-- Index for recent paid orders (useful for backfill)
CREATE INDEX IF NOT EXISTS idx_orders_v2_paid_recent
ON orders_v2 (created_at)
WHERE status = 'paid';

-- Comment for documentation
COMMENT ON COLUMN payments_v2.receipt_url IS 'URL to payment receipt from bePaid';
COMMENT ON COLUMN payments_v2.refunds IS 'Array of refund objects: [{refund_id, amount, currency, status, created_at, receipt_url, reason}]';
COMMENT ON COLUMN payments_v2.refunded_amount IS 'Total refunded amount (sum of succeeded refunds)';
COMMENT ON COLUMN payments_v2.refunded_at IS 'Timestamp of last successful refund';