-- One-time cleanup for imported names that contain a long legal-form phrase.
-- The phrase remains available as legal_form; the visible company name is
-- only the human-readable name (for example, "Журнкам").

WITH cleaned AS (
  SELECT
    c.id,
    btrim(regexp_replace(
      regexp_replace(
        regexp_replace(c.full_name, '[«»“”„‟"]', '', 'g'),
        '^(общество[[:space:]]+с[[:space:]]+ограниченной[[:space:]]+ответственностью|закрытое[[:space:]]+акционерное[[:space:]]+общество|открытое[[:space:]]+акционерное[[:space:]]+общество|публичное[[:space:]]+акционерное[[:space:]]+общество|акционерное[[:space:]]+общество|частное[[:space:]]+унитарное[[:space:]]+предприятие)[[:space:]]*[,;:\-]?[[:space:]]*',
        '', 'i'
      ),
      ',?[[:space:]]*(общество[[:space:]]+с[[:space:]]+ограниченной[[:space:]]+ответственностью|закрытое[[:space:]]+акционерное[[:space:]]+общество|открытое[[:space:]]+акционерное[[:space:]]+общество|публичное[[:space:]]+акционерное[[:space:]]+общество|акционерное[[:space:]]+общество|частное[[:space:]]+унитарное[[:space:]]+предприятие)[[:space:]]*$',
      '', 'i'
    )) AS full_name_clean,
    CASE
      WHEN c.full_name ~* '^общество[[:space:]]+с[[:space:]]+ограниченной' THEN 'ООО'
      WHEN c.full_name ~* '^закрытое[[:space:]]+акционерное' THEN 'ЗАО'
      WHEN c.full_name ~* '^открытое[[:space:]]+акционерное' THEN 'ОАО'
      WHEN c.full_name ~* '^публичное[[:space:]]+акционерное' THEN 'ПАО'
      WHEN c.full_name ~* '^частное[[:space:]]+унитарное' THEN 'ЧУП'
      WHEN c.full_name ~* '(^|[[:space:],])акционерное[[:space:]]+общество([[:space:],]|$)' THEN 'АО'
      ELSE NULL
    END AS inferred_legal_form
  FROM public.companies c
  WHERE c.full_name ~* '(общество[[:space:]]+с[[:space:]]+ограниченной[[:space:]]+ответственностью|закрытое[[:space:]]+акционерное[[:space:]]+общество|открытое[[:space:]]+акционерное[[:space:]]+общество|публичное[[:space:]]+акционерное[[:space:]]+общество|акционерное[[:space:]]+общество|частное[[:space:]]+унитарное[[:space:]]+предприятие)'
)
UPDATE public.companies c
SET full_name = NULLIF(cleaned.full_name_clean, ''),
    short_name = CASE WHEN c.short_name IS NULL THEN NULL ELSE NULLIF(btrim(regexp_replace(regexp_replace(c.short_name, '[«»“”„‟"]', '', 'g'), ',?[[:space:]]*(общество[[:space:]]+с[[:space:]]+ограниченной[[:space:]]+ответственностью|закрытое[[:space:]]+акционерное[[:space:]]+общество|открытое[[:space:]]+акционерное[[:space:]]+общество|публичное[[:space:]]+акционерное[[:space:]]+общество|акционерное[[:space:]]+общество|частное[[:space:]]+унитарное[[:space:]]+предприятие)[[:space:]]*$', '', 'i')), '') END,
    legal_form = COALESCE(NULLIF(c.legal_form, ''), cleaned.inferred_legal_form),
    updated_at = now()
FROM cleaned
WHERE c.id = cleaned.id;
