CREATE OR REPLACE FUNCTION public.generate_admin_catalog_public_id(_prefix text)
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public, extensions
AS $$
  SELECT _prefix || '_' || encode(extensions.gen_random_bytes(6), 'hex')
$$;