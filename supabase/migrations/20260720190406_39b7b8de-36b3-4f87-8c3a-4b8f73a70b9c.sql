-- =============================================================================
-- PR #53 (commit 8b419712c) — crm_normalize_company_phone Excel/Sheets '=' fix
-- File: 20260720269000_crm_company_phone_formula_prefix_fix.sql
-- Scope: strip a leading Excel/Sheets formula prefix '=' from phone strings and
-- normalize the remainder to E.164 via existing BY rules. Backfill only rows
-- whose stored value STILL carries a leading '='. Canonical +375 phones and any
-- other data are left untouched. No other columns, tables, RPCs or triggers are
-- modified. No UI, webhooks, live-events or payment code is touched.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text;
  digits text;
BEGIN
  IF _raw IS NULL THEN
    RETURN NULL;
  END IF;

  v := btrim(_raw);
  IF v = '' THEN
    RETURN NULL;
  END IF;

  -- Strip leading Excel/Sheets formula-guard '=' (may appear as '=' or '=+...').
  WHILE left(v, 1) = '=' LOOP
    v := substring(v from 2);
  END LOOP;
  v := btrim(v);
  IF v = '' THEN
    RETURN NULL;
  END IF;

  IF left(v, 1) = '+' THEN
    digits := regexp_replace(substring(v from 2), '[^0-9]', '', 'g');
    IF digits ~ '^375[0-9]{9}$' THEN
      RETURN '+' || digits;
    END IF;
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN '+' || digits;
    END IF;
    RETURN NULL;
  END IF;

  digits := regexp_replace(v, '[^0-9]', '', 'g');

  IF digits ~ '^80[0-9]{9}$' THEN
    RETURN '+375' || substring(digits from 3);
  END IF;

  IF digits ~ '^375[0-9]{9}$' THEN
    RETURN '+' || digits;
  END IF;

  IF digits ~ '^[0-9]{9}$' THEN
    RETURN '+375' || digits;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.crm_normalize_company_phone(text) IS
  'PR #53: strips leading Excel/Sheets "=" formula guard, then normalizes BY phones (80… / 375… / bare 9-digit / +375…) to E.164 +375XXXXXXXXX; returns NULL for unrecognized formats.';

-- Overload 2: jsonb array of phones -----------------------------------------
CREATE OR REPLACE FUNCTION public.crm_normalize_company_phone(_arr jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN jsonb_typeof(_arr) <> 'array' THEN NULL
    ELSE COALESCE(
      (
        SELECT jsonb_agg(
          COALESCE(public.crm_normalize_company_phone(elem #>> '{}'), elem #>> '{}')
        )
        FROM jsonb_array_elements(_arr) AS elem
      ),
      '[]'::jsonb
    )
  END;
$$;

COMMENT ON FUNCTION public.crm_normalize_company_phone(jsonb) IS
  'PR #53: element-wise normalization for phones[] arrays; unrecognized elements are preserved verbatim.';

-- Backfill (only rows that still carry a leading "=") -----------------------

UPDATE public.companies
SET phone = public.crm_normalize_company_phone(phone)
WHERE phone LIKE '=%'
  AND public.crm_normalize_company_phone(phone) IS NOT NULL
  AND public.crm_normalize_company_phone(phone) IS DISTINCT FROM phone;

WITH targets AS (
  SELECT
    c.id,
    public.crm_normalize_company_phone(c.metadata #> '{google_sheet_import,phones}') AS new_phones
  FROM public.companies c
  WHERE jsonb_typeof(c.metadata #> '{google_sheet_import,phones}') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(c.metadata #> '{google_sheet_import,phones}') AS ph(val)
      WHERE ph.val LIKE '=%'
    )
)
UPDATE public.companies c
SET metadata = jsonb_set(
  c.metadata,
  '{google_sheet_import,phones}',
  t.new_phones,
  false
)
FROM targets t
WHERE t.id = c.id
  AND t.new_phones IS NOT NULL
  AND t.new_phones IS DISTINCT FROM c.metadata #> '{google_sheet_import,phones}';
