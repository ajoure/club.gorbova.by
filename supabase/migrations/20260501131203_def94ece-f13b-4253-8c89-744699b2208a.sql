
CREATE OR REPLACE FUNCTION public.has_month_purchase_bulk(_user_id uuid, _items jsonb)
RETURNS TABLE(lesson_id uuid, has_purchase boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH items AS (
    SELECT
      (elem->>'lesson_id')::uuid AS lesson_id,
      (elem->>'tariff_id')::uuid AS tariff_id,
      -- Accept either 'YYYY-MM' or 'YYYY-MM-DD'; normalize to 'YYYY-MM'
      CASE
        WHEN (elem->>'content_month') ~ '^\d{4}-\d{2}$' THEN (elem->>'content_month')
        WHEN (elem->>'content_month') ~ '^\d{4}-\d{2}-\d{2}' THEN substr(elem->>'content_month', 1, 7)
        ELSE NULL
      END AS month_key
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
        WHERE o.user_id   = _user_id
          AND o.tariff_id = i.tariff_id
          AND o.status    = 'paid'
          AND (o.meta->>'deal_month') = i.month_key
          AND COALESCE(o.meta->>'source', '') <> 'rule_engine'
      ) AS has_purchase
    FROM items i
    WHERE i.month_key IS NOT NULL
  )
  SELECT c.lesson_id, c.has_purchase FROM checks c;
END;
$$;
