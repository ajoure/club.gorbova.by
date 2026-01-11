-- Add matched_profile_id column to payment_reconcile_queue for persistent profile links
ALTER TABLE public.payment_reconcile_queue 
ADD COLUMN IF NOT EXISTS matched_profile_id UUID REFERENCES public.profiles(id);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payment_reconcile_queue_matched_profile_id 
ON public.payment_reconcile_queue(matched_profile_id);

-- Add matched_order_id for linking to deals
ALTER TABLE public.payment_reconcile_queue 
ADD COLUMN IF NOT EXISTS matched_order_id UUID REFERENCES public.orders_v2(id);

CREATE INDEX IF NOT EXISTS idx_payment_reconcile_queue_matched_order_id 
ON public.payment_reconcile_queue(matched_order_id);