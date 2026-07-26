-- Keep every imported company phone in the same callable format as the
-- primary companies.phone field. The first phone is the canonical field;
-- additional numbers remain in the import metadata for lineage/export.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_company_phone_normalize_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_phones jsonb;
BEGIN
  NEW.phone := public.crm_normalize_company_phone(NEW.phone, NEW.country);

  IF jsonb_typeof(NEW.metadata #> '{google_sheet_import,phones}') = 'array' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(phone_norm) ORDER BY ordinal), '[]'::jsonb)
      INTO v_phones
      FROM (
        SELECT ordinal,
               public.crm_normalize_company_phone(value #>> '{}', NEW.country) AS phone_norm
          FROM jsonb_array_elements(NEW.metadata #> '{google_sheet_import,phones}') WITH ORDINALITY AS phones(value, ordinal)
      ) normalized
     WHERE phone_norm IS NOT NULL;
    NEW.metadata := jsonb_set(NEW.metadata, '{google_sheet_import,phones}', v_phones, true);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_company_phone_normalize_trigger() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS crm_company_phone_normalize_trg ON public.companies;
CREATE TRIGGER crm_company_phone_normalize_trg
  BEFORE INSERT OR UPDATE OF phone, country, metadata ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_company_phone_normalize_trigger();

UPDATE public.companies AS c
SET metadata = jsonb_set(
      c.metadata,
      '{google_sheet_import,phones}',
      normalized.phones,
      true
    ),
    updated_at = now()
FROM (
  SELECT c2.id,
         coalesce(jsonb_agg(to_jsonb(phone_norm) ORDER BY ordinal), '[]'::jsonb) AS phones
    FROM public.companies c2
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(c2.metadata #> '{google_sheet_import,phones}') = 'array'
        THEN c2.metadata #> '{google_sheet_import,phones}'
        ELSE '[]'::jsonb
      END
    ) WITH ORDINALITY AS phones(value, ordinal)
    CROSS JOIN LATERAL (VALUES (public.crm_normalize_company_phone(phones.value #>> '{}', c2.country))) normalized_phone(phone_norm)
   WHERE jsonb_typeof(c2.metadata #> '{google_sheet_import,phones}') = 'array'
     AND normalized_phone.phone_norm IS NOT NULL
   GROUP BY c2.id
) normalized
WHERE c.id = normalized.id
  AND c.metadata #> '{google_sheet_import,phones}' IS DISTINCT FROM normalized.phones;

COMMIT;
