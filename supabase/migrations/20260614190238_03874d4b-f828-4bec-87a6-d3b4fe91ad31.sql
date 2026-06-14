-- PATCH-PACKAGE-CUSTOM-FIELDS-V1 Step 0: tighten pf-XXXXXX contract
-- 1) Tighten CHECK on document_package_field_catalog.public_id from {6,} to exactly {6}.
-- 2) Guard assign_package_field_public_id against sequence exhaustion (>999999).
-- No data changes — confirmed zero violators.

ALTER TABLE public.document_package_field_catalog
  DROP CONSTRAINT IF EXISTS dpfc_public_id_format_chk;

ALTER TABLE public.document_package_field_catalog
  ADD CONSTRAINT dpfc_public_id_format_chk
  CHECK (public_id ~ '^pf-[0-9]{6}$');

CREATE OR REPLACE FUNCTION public.assign_package_field_public_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  next_n bigint;
BEGIN
  IF NEW.public_id IS NULL OR NEW.public_id = '' THEN
    next_n := nextval('public.document_package_field_public_id_seq');
    IF next_n > 999999 THEN
      RAISE EXCEPTION 'pf_sequence_exhausted: document_package_field_public_id_seq reached % (max 999999)', next_n
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.public_id := 'pf-' || LPAD(next_n::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;