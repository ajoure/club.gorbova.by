-- Bulk month-gate check for lessons in the cabinet.
-- Accepts JSONB array: [{ "lesson_id": "...", "tariff_id": "...", "content_month": "YYYY-MM-01" }, ...]
-- Returns: rows of { lesson_id uuid, has_purchase boolean }
-- Logic mirrors supabase/functions/_shared/check-month-purchase.ts:
--   user has paid order in orders_v2 for given tariff_id where order paid_at falls inside content_month.
CREATE OR REPLACE FUNCTION public.has_month_purchase_bulk(
  _user_id uuid,
  _items jsonb
)
RETURNS TABLE (lesson_id uuid, has_purchase boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _user_id IS NULL OR _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH items AS (
    SELECT
      (elem->>'lesson_id')::uuid       AS lesson_id,
      (elem->>'tariff_id')::uuid       AS tariff_id,
      (elem->>'content_month')::date   AS content_month
    FROM jsonb_array_elements(_items) AS elem
    WHERE elem ? 'lesson_id'
      AND elem ? 'tariff_id'
      AND elem ? 'content_month'
  ),
  checks AS (
    SELECT
      i.lesson_id,
      EXISTS (
        SELECT 1
        FROM public.orders_v2 o
        WHERE o.user_id = _user_id
          AND o.tariff_id = i.tariff_id
          AND o.status = 'paid'
          AND o.paid_at IS NOT NULL
          AND o.paid_at >= date_trunc('month', i.content_month)
          AND o.paid_at <  (date_trunc('month', i.content_month) + interval '1 month')
          AND COALESCE(o.meta->>'source', '') <> 'rule_engine'
      ) AS has_purchase
    FROM items i
  )
  SELECT c.lesson_id, c.has_purchase FROM checks c;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_month_purchase_bulk(uuid, jsonb) TO authenticated;
