-- Add is_primary flag to tariff_offers
ALTER TABLE public.tariff_offers 
ADD COLUMN IF NOT EXISTS is_primary boolean DEFAULT false;

-- Create a unique partial index to ensure only one primary pay_now offer per tariff
CREATE UNIQUE INDEX IF NOT EXISTS idx_tariff_offers_one_primary 
ON public.tariff_offers (tariff_id) 
WHERE is_primary = true AND offer_type = 'pay_now';

-- Set the first active pay_now offer as primary for each tariff (migration)
UPDATE public.tariff_offers o
SET is_primary = true
WHERE o.offer_type = 'pay_now' 
  AND o.is_active = true
  AND o.id = (
    SELECT id FROM public.tariff_offers 
    WHERE tariff_id = o.tariff_id 
      AND offer_type = 'pay_now' 
      AND is_active = true 
    ORDER BY sort_order ASC 
    LIMIT 1
  );