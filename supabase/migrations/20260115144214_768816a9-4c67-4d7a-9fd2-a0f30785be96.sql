-- Add offer_id column to orders_v2 table
ALTER TABLE public.orders_v2 
ADD COLUMN offer_id UUID REFERENCES public.tariff_offers(id);

-- Create index for better query performance
CREATE INDEX idx_orders_v2_offer_id ON public.orders_v2(offer_id);