-- Add gc_next_retry_at column to orders_v2 for indexing (can't index JSON expressions)
ALTER TABLE orders_v2
ADD COLUMN IF NOT EXISTS gc_next_retry_at timestamptz;

-- Index for GC sync status filtering
CREATE INDEX IF NOT EXISTS idx_orders_v2_gc_sync_status 
ON orders_v2 ((meta->>'gc_sync_status'))
WHERE status = 'paid';

-- Index for rate limit retry scheduling (using the real column, not JSON)
CREATE INDEX IF NOT EXISTS idx_orders_v2_gc_next_retry_at
ON orders_v2 (gc_next_retry_at)
WHERE status = 'paid' AND gc_next_retry_at IS NOT NULL;

-- Backfill existing data from meta
UPDATE orders_v2
SET gc_next_retry_at = NULLIF(meta->>'gc_next_retry_at','')::timestamptz
WHERE gc_next_retry_at IS NULL
  AND (meta->>'gc_next_retry_at') IS NOT NULL;