-- Correct Belarusian trunk-phone normalization for imported company numbers.
-- `80XXXXXXXXX` contains the `80` trunk prefix plus nine subscriber digits;
-- dropping only the first digit leaves an invalid value and breaks call/SMS.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_phone text, _country text DEFAULT 'BY')
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_compact text := NULLIF(regexp_replace(regexp_replace(btrim(coalesce(_phone, '')), '^=+', '', 'g'), '[^0-9+]', '', 'g'), '');
  v_digits text;
BEGIN
  IF v_compact IS NULL THEN RETURN NULL; END IF;
  IF v_compact ~ '^\+375[0-9]{9}$' THEN RETURN v_compact; END IF;
  IF v_compact ~ '^375[0-9]{9}$' THEN RETURN '+' || v_compact; END IF;
  v_digits := regexp_replace(v_compact, '[^0-9]', '', 'g');
  IF upper(coalesce(_country, 'BY')) = 'BY' THEN
    IF v_digits ~ '^80[0-9]{9}$' THEN RETURN '+375' || substr(v_digits, 3); END IF;
    IF v_digits ~ '^[0-9]{9}$' THEN RETURN '+375' || v_digits; END IF;
  END IF;
  RETURN v_compact;
END;
$$;

-- Re-run the trigger for canonical and imported metadata values already stored.
UPDATE public.companies AS c
SET phone = public.crm_normalize_company_phone(c.phone, c.country),
    metadata = CASE
      WHEN jsonb_typeof(c.metadata #> '{google_sheet_import,phones}') = 'array' THEN
        jsonb_set(
          c.metadata,
          '{google_sheet_import,phones}',
          COALESCE((
            SELECT jsonb_agg(to_jsonb(normalized.phone) ORDER BY normalized.ordinal)
            FROM (
              SELECT phones.ordinal,
                     public.crm_normalize_company_phone(phones.value #>> '{}', c.country) AS phone
              FROM jsonb_array_elements(c.metadata #> '{google_sheet_import,phones}') WITH ORDINALITY AS phones(value, ordinal)
            ) normalized
            WHERE normalized.phone IS NOT NULL
          ), '[]'::jsonb),
          true
        )
      ELSE c.metadata
    END,
    updated_at = now()
WHERE c.phone IS NOT NULL
   OR jsonb_typeof(c.metadata #> '{google_sheet_import,phones}') = 'array';

COMMIT;
