
-- =============================================================================
-- PR #53 (commit 19b0632a6) — crm_normalize_company_phone BY trunk fix
-- File: 20260720268000_crm_company_phone_trunk_fix.sql
-- Scope: normalize BY "80XXXXXXXXX" -> "+375XXXXXXXXX"; backfill companies.phone
-- and metadata.google_sheet_import.phones[]. No other columns/tables touched.
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

  -- Keep only digits and a possible leading '+'
  IF left(v, 1) = '+' THEN
    digits := regexp_replace(substring(v from 2), '[^0-9]', '', 'g');
    -- Already canonical E.164 BY?
    IF digits ~ '^375[0-9]{9}$' THEN
      RETURN '+' || digits;
    END IF;
    -- Other international with '+': return normalized as '+<digits>' when plausible
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN '+' || digits;
    END IF;
    RETURN NULL;
  END IF;

  digits := regexp_replace(v, '[^0-9]', '', 'g');

  -- Belarus trunk-prefixed local format: 80 + 9 digits = 11 digits, first two '80'
  IF digits ~ '^80[0-9]{9}$' THEN
    RETURN '+375' || substring(digits from 3);
  END IF;

  -- Already in 375XXXXXXXXX form without '+'
  IF digits ~ '^375[0-9]{9}$' THEN
    RETURN '+' || digits;
  END IF;

  -- Bare 9-digit BY subscriber (operator+number) — assume BY
  IF digits ~ '^[0-9]{9}$' THEN
    RETURN '+375' || digits;
  END IF;

  -- Other lengths: return NULL (не гадаем)
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.crm_normalize_company_phone(text) IS
  'PR #53: приводит белорусский trunk-формат 80XXXXXXXXX к +375XXXXXXXXX; сохраняет уже канонические +375, возвращает NULL при неопознанном формате.';

-- Trigger: normalize companies.phone on write --------------------------------

CREATE OR REPLACE FUNCTION public.crm_companies_normalize_phone_tg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normalized text;
BEGIN
  IF NEW.phone IS NOT NULL AND btrim(NEW.phone) <> '' THEN
    normalized := public.crm_normalize_company_phone(NEW.phone);
    IF normalized IS NOT NULL THEN
      NEW.phone := normalized;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_normalize_phone ON public.companies;
CREATE TRIGGER trg_companies_normalize_phone
BEFORE INSERT OR UPDATE OF phone ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.crm_companies_normalize_phone_tg();

-- One-shot backfill ---------------------------------------------------------

-- 1) companies.phone
UPDATE public.companies
SET phone = public.crm_normalize_company_phone(phone)
WHERE phone IS NOT NULL
  AND regexp_replace(phone, '[^0-9]', '', 'g') ~ '^80[0-9]{9}$'
  AND public.crm_normalize_company_phone(phone) IS DISTINCT FROM phone;

-- 2) metadata.google_sheet_import.phones[]
WITH targets AS (
  SELECT
    c.id,
    (
      SELECT jsonb_agg(
        COALESCE(public.crm_normalize_company_phone(ph #>> '{}'), ph #>> '{}')
      )
      FROM jsonb_array_elements(c.metadata #> '{google_sheet_import,phones}') AS ph
    ) AS new_phones
  FROM public.companies c
  WHERE jsonb_typeof(c.metadata #> '{google_sheet_import,phones}') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(c.metadata #> '{google_sheet_import,phones}') AS ph(val)
      WHERE regexp_replace(ph.val, '[^0-9]', '', 'g') ~ '^80[0-9]{9}$'
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
  AND t.new_phones IS NOT NULL;
