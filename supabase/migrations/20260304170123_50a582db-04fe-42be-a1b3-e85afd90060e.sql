
-- Fix function search_path
CREATE OR REPLACE FUNCTION public.prevent_self_product_relation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parent_product_id = NEW.child_product_id THEN
    RAISE EXCEPTION 'A product cannot be linked to itself';
  END IF;
  RETURN NEW;
END;
$$;
