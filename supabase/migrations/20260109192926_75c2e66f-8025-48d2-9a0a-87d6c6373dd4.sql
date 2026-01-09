-- Add bepaid_subscription_id to orders_v2 if not exists
ALTER TABLE public.orders_v2 ADD COLUMN IF NOT EXISTS bepaid_subscription_id TEXT;

-- Create index for quick lookup
CREATE INDEX IF NOT EXISTS idx_orders_v2_bepaid_subscription_id ON public.orders_v2(bepaid_subscription_id) WHERE bepaid_subscription_id IS NOT NULL;

-- Add column to track reconciliation source
ALTER TABLE public.orders_v2 ADD COLUMN IF NOT EXISTS reconcile_source TEXT;

-- Comment for clarity
COMMENT ON COLUMN public.orders_v2.bepaid_subscription_id IS 'bePaid subscription ID for recurring payments (sbs_*)';
COMMENT ON COLUMN public.orders_v2.reconcile_source IS 'How this order was reconciled: webhook, api_fetch, manual';