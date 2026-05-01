
CREATE OR REPLACE FUNCTION public.has_month_purchase_bulk(_user_id uuid, _items jsonb)
RETURNS TABLE(lesson_id uuid, has_purchase boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL OR _items IS NULL OR jsonb_typeof(_items) <> 'array' THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH items AS (
    SELECT
      (elem->>'lesson_id')::uuid     AS lesson_id,
      (elem->>'tariff_id')::uuid     AS tariff_id,
      -- Accept YYYY-MM-DD or YYYY-MM; normalize to 'YYYY-MM' for deal_month match
      to_char((elem->>'content_month')::date, 'YYYY-MM') AS month_key
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
  )
  SELECT c.lesson_id, c.has_purchase FROM checks c;
END;
$function$;
