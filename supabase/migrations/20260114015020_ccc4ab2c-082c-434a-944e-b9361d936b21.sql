-- Index for GC sync status filtering (fast lookup for unsynced orders)
CREATE INDEX IF NOT EXISTS idx_orders_v2_gc_sync_status 
ON orders_v2 ((meta->>'gc_sync_status'))
WHERE status = 'paid';