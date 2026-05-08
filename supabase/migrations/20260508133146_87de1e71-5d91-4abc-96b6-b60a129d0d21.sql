-- Sprint 11 — Field-ID backfill (Этап 2, retry). Idempotent.

-- Step 0: Sync FLD counter to actual MAX(public_id) to avoid duplicates.
UPDATE public.public_id_sequences
SET last_value = GREATEST(
  last_value,
  COALESCE(
    (SELECT MAX(NULLIF(SUBSTRING(public_id FROM 5), '')::bigint)
       FROM public.fields_registry
       WHERE public_id ~ '^FLD-[0-9]+$'),
    last_value
  )
)
WHERE entity_type = 'field';

-- Step 1: Insert missing fields_registry rows.
INSERT INTO public.fields_registry (entity_type, key, label, data_type, description)
SELECT
  REPLACE(dtr.category, '.', '_') AS entity_type,
  dtr.token_key                   AS key,
  dtr.ui_label                    AS label,
  COALESCE(dtr.data_type, 'string') AS data_type,
  dtr.description
FROM public.document_token_registry dtr
WHERE dtr.archived_at IS NULL
  AND dtr.field_id IS NULL
ON CONFLICT (key) DO NOTHING;

-- Step 2: Link document_token_registry.field_id where missing.
UPDATE public.document_token_registry dtr
SET field_id = fr.id,
    updated_at = now()
FROM public.fields_registry fr
WHERE dtr.field_id IS NULL
  AND dtr.archived_at IS NULL
  AND fr.archived_at IS NULL
  AND fr.key = dtr.token_key;

-- Step 3: Hard verification.
DO $$
DECLARE
  v_total int;
  v_linked int;
BEGIN
  SELECT COUNT(*), COUNT(field_id)
    INTO v_total, v_linked
  FROM public.document_token_registry
  WHERE archived_at IS NULL;

  IF v_linked <> v_total THEN
    RAISE EXCEPTION 'Sprint 11 backfill incomplete: % of % tokens have field_id', v_linked, v_total;
  END IF;
END $$;