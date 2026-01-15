-- Add reference_transaction_uid column to payment_reconcile_queue for linking refunds to original payments
ALTER TABLE public.payment_reconcile_queue 
ADD COLUMN IF NOT EXISTS reference_transaction_uid TEXT;

-- Add index for faster lookups by reference_transaction_uid
CREATE INDEX IF NOT EXISTS idx_queue_reference_uid ON public.payment_reconcile_queue(reference_transaction_uid) WHERE reference_transaction_uid IS NOT NULL;

-- Add reference_payment_id column to link refunds to original payments in payments_v2
ALTER TABLE public.payments_v2 
ADD COLUMN IF NOT EXISTS reference_payment_id UUID REFERENCES public.payments_v2(id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_v2_reference ON public.payments_v2(reference_payment_id) WHERE reference_payment_id IS NOT NULL;

-- Comment explaining the columns
COMMENT ON COLUMN public.payment_reconcile_queue.reference_transaction_uid IS 'bePaid UID of the parent transaction (for refunds, this is the original payment UID)';
COMMENT ON COLUMN public.payments_v2.reference_payment_id IS 'ID of the original payment record (for refunds linked to payments)';