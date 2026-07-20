-- Companies import cleanup: keep the legal form in legal_form and the
-- displayed company name free of spreadsheet quoting noise.

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_company_normalize_import_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_clean text;
  v_form text;
BEGIN
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'google_sheet_import') THEN
    RETURN NEW;
  END IF;

  v_clean := regexp_replace(
    regexp_replace(btrim(coalesce(NEW.full_name, '')), '[«»“”„‟"]', '', 'g'),
    '\s+', ' ', 'g'
  );
  v_clean := btrim(regexp_replace(v_clean, '^[,;:\-\s]+|[,;:\-\s]+$', '', 'g'));

  IF v_clean ~* '^(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\b' THEN
    v_form := upper((regexp_match(v_clean, '^(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\b', 'i'))[1]);
    v_clean := btrim(regexp_replace(v_clean, '^(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*[,;:\-]?\s*', '', 'i'));
  ELSIF v_clean ~* ',\s*(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*$' THEN
    v_form := upper((regexp_match(v_clean, ',\s*(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*$', 'i'))[1]);
    v_clean := btrim(regexp_replace(v_clean, ',\s*(ООО|ОДО|ЗАО|ОАО|СООО|УП|ЧУП|КУП|ТУП|ИП)\s*$', '', 'i'));
  END IF;

  IF v_clean <> '' THEN NEW.full_name := v_clean; END IF;
  IF nullif(btrim(coalesce(NEW.legal_form, '')), '') IS NULL AND v_form IS NOT NULL THEN
    NEW.legal_form := v_form;
  END IF;
  IF nullif(btrim(coalesce(NEW.short_name, '')), '') IS NOT NULL THEN
    NEW.short_name := btrim(regexp_replace(regexp_replace(NEW.short_name, '[«»“”„‟"]', '', 'g'), '\s+', ' ', 'g'));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_company_import_name_normalization_trg ON public.companies;
CREATE TRIGGER crm_company_import_name_normalization_trg
  BEFORE INSERT OR UPDATE OF full_name, short_name, legal_form, metadata
  ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_company_normalize_import_row();

-- One-time cleanup of the already applied Google Sheet batch. The trigger above
-- keeps retries and future imports on the same canonical format.
UPDATE public.companies AS c
SET full_name = btrim(regexp_replace(regexp_replace(c.full_name, '[«»“”„‟"]', '', 'g'), '\s+', ' ', 'g')),
    short_name = CASE WHEN c.short_name IS NULL THEN NULL ELSE btrim(regexp_replace(regexp_replace(c.short_name, '[«»“”„‟"]', '', 'g'), '\s+', ' ', 'g')) END,
    updated_at = now()
WHERE coalesce(c.metadata, '{}'::jsonb) ? 'google_sheet_import';

COMMIT;
