-- Add column to link trial offer to a pay_now offer for auto-charging
ALTER TABLE public.tariff_offers 
ADD COLUMN IF NOT EXISTS auto_charge_offer_id UUID REFERENCES public.tariff_offers(id) ON DELETE SET NULL;

-- Add comment
COMMENT ON COLUMN public.tariff_offers.auto_charge_offer_id IS 'Reference to pay_now offer to use for auto-charge after trial ends';