-- Add reentry_amount column to tariff_offers
-- This stores the price for users who were previously club members
ALTER TABLE public.tariff_offers
ADD COLUMN IF NOT EXISTS reentry_amount NUMERIC;

-- Add comment explaining the field
COMMENT ON COLUMN public.tariff_offers.reentry_amount IS 'Price for re-entry (for users who were previously club members and left)';

-- Drop the separate table since we're storing reentry prices directly in offers
DROP TABLE IF EXISTS public.reentry_price_multipliers;