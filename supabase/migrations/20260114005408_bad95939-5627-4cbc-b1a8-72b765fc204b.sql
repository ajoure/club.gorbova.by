-- STEP 1: Create UNIQUE index on entitlements.order_id for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_entitlements_unique_order_id
ON entitlements(order_id)
WHERE order_id IS NOT NULL