-- Create archive table for payment_reconcile_queue cleanup
CREATE TABLE IF NOT EXISTS payment_reconcile_queue_archive (
  LIKE payment_reconcile_queue INCLUDING ALL
);

-- Add comment for documentation
COMMENT ON TABLE payment_reconcile_queue_archive IS 'Archive of completed payment reconcile queue items older than 7 days';