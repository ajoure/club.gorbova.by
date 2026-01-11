-- Add card data columns to profiles for payment matching
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS card_masks jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS card_holder_names jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.profiles.card_masks IS 'Masked card numbers for payment matching (e.g., 49169896xxxx9310)';
COMMENT ON COLUMN public.profiles.card_holder_names IS 'Card holder names in Latin (as received from payment system)';