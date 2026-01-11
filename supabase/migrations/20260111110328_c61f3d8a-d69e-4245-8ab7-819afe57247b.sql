-- Delete duplicate bepaid_uid entries, keeping only the most recent
DELETE FROM payment_reconcile_queue a
USING payment_reconcile_queue b
WHERE a.bepaid_uid = b.bepaid_uid 
  AND a.bepaid_uid IS NOT NULL
  AND a.created_at < b.created_at;

-- Now create unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_bepaid_uid_unique 
  ON payment_reconcile_queue(bepaid_uid) WHERE bepaid_uid IS NOT NULL;