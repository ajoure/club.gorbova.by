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

  v_clean := btrim(regexp_replace(
    regexp_replace(btrim(coalesce(NEW.full_name, '')), '[«»“”„‟"]', '', 'g'),
    '\s+', ' ', 'g'
  ));
  v_clean := btrim(regexp_replace(v_clean, '^[,;:\-\s]+|[,;:\-\s]+$', '', 'g'));

  IF v_clean ~* '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)([[:space:]]|$)' THEN
    v_form := upper((regexp_match(v_clean, '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)([[:space:]]|$)', 'i'))[1]);
    v_clean := btrim(regexp_replace(v_clean, '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*[,;:\-]?\s*', '', 'i'));
  ELSIF v_clean ~* ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$' THEN
    v_form := upper((regexp_match(v_clean, ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$', 'i'))[1]);
    v_clean := btrim(regexp_replace(v_clean, ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$', '', 'i'));
  END IF;

  v_clean := btrim(regexp_replace(v_clean,
    '(^|[^[:alnum:]А-Яа-яЁё])(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)([^[:alnum:]А-Яа-яЁё]|$)', '\1\3', 'gi'));
  v_clean := btrim(regexp_replace(v_clean, '[[:space:]]{2,}', ' ', 'g'));

  IF v_clean <> '' THEN NEW.full_name := v_clean; END IF;
  IF nullif(btrim(coalesce(NEW.legal_form, '')), '') IS NULL AND v_form IS NOT NULL THEN
    NEW.legal_form := v_form;
  END IF;
  IF nullif(btrim(coalesce(NEW.short_name, '')), '') IS NOT NULL THEN
    NEW.short_name := btrim(regexp_replace(
      regexp_replace(btrim(NEW.short_name), '[«»“”„‟"]', '', 'g'),
      '\s+', ' ', 'g'
    ));
    NEW.short_name := btrim(regexp_replace(NEW.short_name,
      '^(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*[,;:\-]?\s*', '', 'i'));
    NEW.short_name := btrim(regexp_replace(NEW.short_name,
      ',?\s*(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)\s*$', '', 'i'));
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

UPDATE public.companies AS c
SET full_name = btrim(regexp_replace(
      regexp_replace(btrim(coalesce(c.full_name, '')), '[«»“”„‟"]', '', 'g'),
      '\s+', ' ', 'g'
    )),
    short_name = CASE WHEN c.short_name IS NULL THEN NULL ELSE btrim(regexp_replace(
      regexp_replace(btrim(c.short_name), '[«»“”„‟"]', '', 'g'),
      '\s+', ' ', 'g'
    )) END,
    updated_at = now()
WHERE coalesce(c.metadata, '{}'::jsonb) ? 'google_sheet_import'
  AND (
    c.full_name ~ '[«»“”„‟"]'
    OR c.short_name ~ '[«»“”„‟"]'
    OR c.full_name ~* '(^|[^[:alnum:]А-Яа-яЁё])(ООО|ОДО|ЗАО|ОАО|ПАО|АО|СООО|ИООО|СЗАО|УП|ЧУП|КУП|ГУП|РУП|ТУП|ИУП|ЧПУП|ЧТУП|ПК|ИП|ТДО|ТОО|МУП|ФГУП|ГП)([^[:alnum:]А-Яа-яЁё]|$)'
  );