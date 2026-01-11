-- Add is_fee flag to distinguish acquiring commissions from real payments
ALTER TABLE payment_reconcile_queue
ADD COLUMN IF NOT EXISTS is_fee BOOLEAN DEFAULT FALSE;

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_prq_is_fee ON payment_reconcile_queue(is_fee);

-- Mark existing small amounts without tracking_id as fees
UPDATE payment_reconcile_queue
SET is_fee = TRUE
WHERE (amount < 0.10 AND tracking_id IS NULL AND (description IS NULL OR description = ''))
   OR (transaction_type IS NOT NULL AND transaction_type NOT IN ('Платеж', 'Payment', ''));