-- PATCH 1: public_id for tariffs
-- Step 1: Register sequence
INSERT INTO public_id_sequences (entity_type, prefix, last_value) 
VALUES ('tariff', 'T', 0) ON CONFLICT (entity_type) DO NOTHING;

-- Step 2: Add column (nullable first for backfill)
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS public_id text;

-- Step 3: Trigger function (analogous to set_product_public_id)
CREATE OR REPLACE FUNCTION public.set_tariff_public_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    NEW.public_id := public.next_public_id('tariff');
  END IF;
  RETURN NEW;
END;
$$;

-- Step 4: Create trigger (drop if exists for idempotency)
DROP TRIGGER IF EXISTS trg_set_tariff_public_id ON public.tariffs;
CREATE TRIGGER trg_set_tariff_public_id
  BEFORE INSERT ON public.tariffs
  FOR EACH ROW EXECUTE FUNCTION public.set_tariff_public_id();

-- Step 5: Backfill existing 11 tariffs in deterministic order
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM tariffs WHERE public_id IS NULL ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE tariffs SET public_id = public.next_public_id('tariff') WHERE id = r.id;
  END LOOP;
END; $$;

-- Step 6: NOT NULL constraint + unique index
ALTER TABLE tariffs ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tariffs_public_id_key ON tariffs(public_id);