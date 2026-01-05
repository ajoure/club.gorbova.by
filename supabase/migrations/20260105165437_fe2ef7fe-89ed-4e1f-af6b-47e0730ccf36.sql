-- 1. Add getcourse_offer_id to tariffs for GetCourse integration
ALTER TABLE public.tariffs 
ADD COLUMN IF NOT EXISTS getcourse_offer_id integer;

-- Add comment explaining the field
COMMENT ON COLUMN public.tariffs.getcourse_offer_id IS 'GetCourse offer ID for order syncing';

-- 2. Update existing tariffs with prices and GetCourse IDs
-- CHAT tariff: 100 BYN, GC ID 6744625
UPDATE public.tariffs 
SET 
  original_price = 100,
  trial_enabled = true,
  trial_days = 5,
  trial_price = 1,
  trial_auto_charge = true,
  getcourse_offer_id = 6744625
WHERE code = 'chat' AND product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616';

-- FULL tariff: 150 BYN, GC ID 6744626
UPDATE public.tariffs 
SET 
  original_price = 150,
  trial_enabled = true,
  trial_days = 5,
  trial_price = 1,
  trial_auto_charge = true,
  getcourse_offer_id = 6744626
WHERE code = 'full' AND product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616';

-- BUSINESS tariff: 250 BYN, GC ID 6744628
UPDATE public.tariffs 
SET 
  original_price = 250,
  trial_enabled = true,
  trial_days = 5,
  trial_price = 1,
  trial_auto_charge = true,
  getcourse_offer_id = 6744628
WHERE code = 'business' AND product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616';