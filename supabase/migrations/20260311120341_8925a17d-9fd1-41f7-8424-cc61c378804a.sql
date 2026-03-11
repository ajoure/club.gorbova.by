
-- PATCH 1 FIX: Remove dangerous default '' and fix trigger to catch both NULL and ''

-- 1. Drop the dangerous default
ALTER TABLE tariffs ALTER COLUMN public_id DROP DEFAULT;

-- 2. Update trigger to catch both NULL and empty string
CREATE OR REPLACE FUNCTION public.set_tariff_public_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('tariff');
  END IF;
  RETURN NEW;
END;
$$;
