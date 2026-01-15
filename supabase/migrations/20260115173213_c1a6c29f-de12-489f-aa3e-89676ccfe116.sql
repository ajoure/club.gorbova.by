-- Add linked_at column to payment_reconcile_queue for tracking manual links
ALTER TABLE payment_reconcile_queue 
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;