-- Sprint 3H: канон плейсхолдера роли пакета — {{ln-XXXXXX}}

CREATE OR REPLACE FUNCTION public.assign_package_role_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  next_n bigint;
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    next_n := nextval('public.document_package_role_public_id_seq');
    NEW.public_id := 'ln-' || LPAD(next_n::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.document_package_role_catalog
  DISABLE TRIGGER trg_guard_package_role_catalog_mutations;

UPDATE public.document_package_role_catalog
SET public_id = 'ln-' || SUBSTRING(public_id FROM 5)
WHERE public_id LIKE 'PKR-%';

ALTER TABLE public.document_package_role_catalog
  ENABLE TRIGGER trg_guard_package_role_catalog_mutations;

UPDATE public.document_package_token_aliases
SET archived_at = now()
WHERE archived_at IS NULL
  AND alias_token LIKE 'package.roles.%';