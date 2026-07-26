-- Store company phones in one callable format. This removes spreadsheet
-- formula prefixes (for example =+375...), accepts common Belarusian local
-- forms, and keeps non-Belarusian E.164 values unchanged.

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
    IF v_digits ~ '^8[0-9]{9}$' THEN RETURN '+375' || substr(v_digits, 2); END IF;
    IF v_digits ~ '^[0-9]{9}$' THEN RETURN '+375' || v_digits; END IF;
  END IF;
  RETURN v_compact;
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_company_phone_normalize_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.phone := public.crm_normalize_company_phone(NEW.phone, NEW.country);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_normalize_company_phone(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_company_phone_normalize_trigger() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS crm_company_phone_normalize_trg ON public.companies;
CREATE TRIGGER crm_company_phone_normalize_trg
  BEFORE INSERT OR UPDATE OF phone, country ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_company_phone_normalize_trigger();

UPDATE public.companies AS c
SET phone = public.crm_normalize_company_phone(c.phone, c.country),
    updated_at = now()
WHERE c.phone IS NOT NULL
  AND c.phone IS DISTINCT FROM public.crm_normalize_company_phone(c.phone, c.country);

COMMIT;
