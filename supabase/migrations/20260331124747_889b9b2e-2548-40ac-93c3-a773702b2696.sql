-- PATCH A1: Add public_id to training_modules with TRN-XXXXXX format

-- 1. Register entity type in public_id_sequences
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('training_module', 'TRN', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- 2. Add public_id column
ALTER TABLE public.training_modules
ADD COLUMN IF NOT EXISTS public_id TEXT;

-- 3. Backfill existing modules (80 rows) with sequential TRN-000001..TRN-000080
DO $$
DECLARE
  r RECORD;
  v_counter INT := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.training_modules
    WHERE public_id IS NULL
    ORDER BY sort_order, created_at
  LOOP
    v_counter := v_counter + 1;
    UPDATE public.training_modules
    SET public_id = 'TRN-' || lpad(v_counter::text, 6, '0')
    WHERE id = r.id;
  END LOOP;

  -- Update the sequence counter to match
  UPDATE public.public_id_sequences
  SET last_value = v_counter
  WHERE entity_type = 'training_module';
END $$;

-- 4. Add unique constraint after backfill
ALTER TABLE public.training_modules
ADD CONSTRAINT training_modules_public_id_unique UNIQUE (public_id);

-- 5. Create trigger for auto-generation on INSERT
CREATE OR REPLACE FUNCTION public.set_training_module_public_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    NEW.public_id := public.next_public_id('training_module');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_training_module_public_id
BEFORE INSERT ON public.training_modules
FOR EACH ROW
EXECUTE FUNCTION public.set_training_module_public_id();