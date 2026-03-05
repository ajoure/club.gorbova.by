
-- Add columns to fields_registry
ALTER TABLE public.fields_registry
  ADD COLUMN IF NOT EXISTS public_id text,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text;

-- Seed public_id_sequences for field
INSERT INTO public.public_id_sequences (entity_type, prefix, last_value)
VALUES ('field', 'FLD', 0)
ON CONFLICT (entity_type) DO NOTHING;

-- Trigger function
CREATE OR REPLACE FUNCTION public.set_field_registry_public_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.public_id IS NULL THEN
    NEW.public_id := next_public_id('field');
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger
DROP TRIGGER IF EXISTS trg_fields_registry_public_id ON public.fields_registry;
CREATE TRIGGER trg_fields_registry_public_id
  BEFORE INSERT ON public.fields_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.set_field_registry_public_id();

-- Backfill existing rows
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.fields_registry
    WHERE public_id IS NULL
    ORDER BY created_at, id
  LOOP
    UPDATE public.fields_registry
    SET public_id = next_public_id('field')
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Unique index on public_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_fields_registry_public_id
  ON public.fields_registry (public_id)
  WHERE public_id IS NOT NULL;
