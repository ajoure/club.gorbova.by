-- Fix CHECK constraint to allow NULL values (status_override can be NULL)
-- This is needed because some records may not have an override

-- Step 1: Drop existing constraint
ALTER TABLE payment_status_overrides
DROP CONSTRAINT IF EXISTS chk_payment_status_canonical;

-- Step 2: Recreate with NULL support
ALTER TABLE payment_status_overrides
ADD CONSTRAINT chk_payment_status_canonical
CHECK (status_override IS NULL OR status_override IN ('succeeded', 'refunded', 'canceled', 'failed', 'pending'));