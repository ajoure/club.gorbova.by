
-- Fix Issue 2: Add search_path to function without it
CREATE OR REPLACE FUNCTION public.update_edge_functions_registry_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
