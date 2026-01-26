-- Add card_holder column to payments_v2
ALTER TABLE public.payments_v2 
ADD COLUMN IF NOT EXISTS card_holder text;

COMMENT ON COLUMN public.payments_v2.card_holder IS 'Card holder name from bePaid statement';