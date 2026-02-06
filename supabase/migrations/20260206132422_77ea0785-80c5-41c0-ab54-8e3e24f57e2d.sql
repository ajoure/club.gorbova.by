-- Trigger function to sync product_club_mappings when products_v2.telegram_club_id changes
CREATE OR REPLACE FUNCTION public.sync_product_club_mapping()
RETURNS TRIGGER AS $$
DECLARE
  default_duration INTEGER := 30; -- Default duration in days
BEGIN
  -- If telegram_club_id is being set or changed
  IF NEW.telegram_club_id IS NOT NULL THEN
    -- Upsert the mapping
    INSERT INTO public.product_club_mappings (product_id, club_id, duration_days, is_active)
    VALUES (NEW.id, NEW.telegram_club_id, default_duration, NEW.is_active)
    ON CONFLICT (product_id, club_id) 
    DO UPDATE SET 
      is_active = NEW.is_active,
      updated_at = NOW();
    
    -- Deactivate any old mappings for this product with different clubs
    UPDATE public.product_club_mappings 
    SET is_active = FALSE, updated_at = NOW()
    WHERE product_id = NEW.id 
      AND club_id != NEW.telegram_club_id
      AND is_active = TRUE;
  ELSE
    -- If telegram_club_id is being set to NULL, deactivate all mappings for this product
    IF OLD.telegram_club_id IS NOT NULL THEN
      UPDATE public.product_club_mappings 
      SET is_active = FALSE, updated_at = NOW()
      WHERE product_id = NEW.id 
        AND is_active = TRUE;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_sync_product_club_mapping ON public.products_v2;

-- Create trigger
CREATE TRIGGER trg_sync_product_club_mapping
AFTER INSERT OR UPDATE OF telegram_club_id, is_active ON public.products_v2
FOR EACH ROW
EXECUTE FUNCTION public.sync_product_club_mapping();

-- Add updated_at column to product_club_mappings if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'product_club_mappings' 
    AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.product_club_mappings 
    ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- Now sync existing products that have telegram_club_id but no mapping
INSERT INTO public.product_club_mappings (product_id, club_id, duration_days, is_active)
SELECT 
  p.id,
  p.telegram_club_id,
  30,
  p.is_active
FROM public.products_v2 p
WHERE p.telegram_club_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.product_club_mappings m 
    WHERE m.product_id = p.id AND m.club_id = p.telegram_club_id
  )
ON CONFLICT (product_id, club_id) DO NOTHING;