-- Normalize spreadsheet formula prefixes without touching unrelated company data.
-- Excel/Google Sheets exports may persist a phone as `=+375...`; the leading
-- equals sign is not part of the number and prevents tel/Call/SMS actions.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_phone text, _country text DEFAULT 'BY')
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_compact text := NULLIF(
    regexp_replace(
      regexp_replace(btrim(coalesce(_phone, '')), '^=+', '', 'g'),
      '[^0-9+]', '', 'g'
    ),
    ''
  );
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

-- The Lovable-managed migration also exposed a one-argument overload. Keep
-- its behavior aligned so direct SQL callers cannot preserve the `=` prefix.
CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
BEGIN
  RETURN public.crm_normalize_company_phone(_phone, 'BY');
END;
$$;

-- Backfill only formula-prefixed phone values in the canonical field and
-- imported phone array. Existing canonical values and unrelated metadata stay
-- unchanged; the update is idempotent.
UPDATE public.companies AS c
SET phone = public.crm_normalize_company_phone(c.phone, c.country),
    metadata = CASE
      WHEN jsonb_typeof(c.metadata #> '{google_sheet_import,phones}') = 'array' THEN
        jsonb_set(
          c.metadata,
          '{google_sheet_import,phones}',
          (
            SELECT jsonb_agg(
              to_jsonb(public.crm_normalize_company_phone(ph.value #>> '{}', c.country))
              ORDER BY ph.ordinality
            )
            FROM jsonb_array_elements(c.metadata #> '{google_sheet_import,phones}')
              WITH ORDINALITY AS ph(value, ordinality)
          ),
          true
        )
      ELSE c.metadata
    END,
    updated_at = now()
WHERE (c.phone IS NOT NULL AND c.phone ~ '^=+')
   OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(c.metadata #> '{google_sheet_import,phones}') AS ph(value)
      WHERE ph.value ~ '^=+'
   );

COMMIT;
