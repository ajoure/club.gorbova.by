
-- Fix search_path for batch trigger function
CREATE OR REPLACE FUNCTION public.update_ai_batches_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
