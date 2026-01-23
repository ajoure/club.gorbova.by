-- Add diagnostic columns to payment_reconcile_queue for geo/IP and error analysis
-- Add-only migration: safe to run multiple times

ALTER TABLE payment_reconcile_queue
ADD COLUMN IF NOT EXISTS client_geo_country TEXT,
ADD COLUMN IF NOT EXISTS client_user_agent TEXT,
ADD COLUMN IF NOT EXISTS client_accept_language TEXT,
ADD COLUMN IF NOT EXISTS ip_hash TEXT,
ADD COLUMN IF NOT EXISTS error_category TEXT;

-- Indices for fast aggregation queries
CREATE INDEX IF NOT EXISTS idx_prq_card_bank ON payment_reconcile_queue(card_bank) WHERE card_bank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prq_card_bank_country ON payment_reconcile_queue(card_bank_country) WHERE card_bank_country IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prq_error_category ON payment_reconcile_queue(error_category) WHERE error_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prq_three_d_secure ON payment_reconcile_queue(three_d_secure);
CREATE INDEX IF NOT EXISTS idx_prq_customer_country ON payment_reconcile_queue(customer_country) WHERE customer_country IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN payment_reconcile_queue.client_geo_country IS 'GeoIP страна клиента (BY, RU, UA, etc)';
COMMENT ON COLUMN payment_reconcile_queue.ip_hash IS 'SHA256 hash IP адреса (GDPR compliance)';
COMMENT ON COLUMN payment_reconcile_queue.error_category IS 'Нормализованная категория ошибки: needs_3ds, do_not_honor, insufficient_funds, issuer_block, timeout, unknown';