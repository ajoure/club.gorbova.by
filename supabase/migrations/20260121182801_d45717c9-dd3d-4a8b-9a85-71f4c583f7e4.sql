-- PATCH 1: Fix existing non-canonical statuses in payment_status_overrides
-- PATCH 2: Add CHECK constraint to prevent future garbage

-- Fix: 'refund' → 'refunded' (expected: 92 rows)
UPDATE payment_status_overrides
SET status_override = 'refunded',
    updated_at = now()
WHERE status_override = 'refund';

-- Fix: 'successful' → 'succeeded' (expected: 39 rows)
UPDATE payment_status_overrides
SET status_override = 'succeeded',
    updated_at = now()
WHERE status_override = 'successful';

-- Fix: 'cancel'/'cancelled'/'void' → 'canceled' (expected: 0 rows, already canonical)
UPDATE payment_status_overrides
SET status_override = 'canceled',
    updated_at = now()
WHERE status_override IN ('cancel', 'cancelled', 'void');

-- DB Guard: Add CHECK constraint to enforce canonical statuses forever
ALTER TABLE payment_status_overrides
ADD CONSTRAINT chk_payment_status_canonical
CHECK (status_override IN ('succeeded', 'refunded', 'canceled', 'failed', 'pending'));