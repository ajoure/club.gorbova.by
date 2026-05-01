-- Fix has_month_purchase_bulk: include profile_id linkage so legacy orders
-- (where orders_v2.user_id is NULL but profile_id resolves to the same auth user)
-- correctly count toward the month-gate. SOT unchanged: orders_v2.meta.deal_month,
-- status='paid', source<>'rule_engine'.
CREATE OR REPLACE FUNCTION public.has_month_purchase_bulk(_user_id uuid, _items jsonb)
 RETURNS TABLE(lesson_id uuid, has_purchase boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items AS (
    SELECT
      (elem->>'lesson_id')::uuid AS lesson_id,
      (elem->>'tariff_id')::uuid AS tariff_id,
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
  user_profiles AS (
    SELECT id AS profile_id FROM public.profiles WHERE user_id = _user_id
  ),
  checks AS (
    SELECT
      i.lesson_id,
      EXISTS (
        SELECT 1
        FROM public.orders_v2 o
        WHERE o.tariff_id = i.tariff_id
          AND o.status    = 'paid'
          AND (o.meta->>'deal_month') = i.month_key
          AND COALESCE(o.meta->>'source', '') <> 'rule_engine'
          AND (
            o.user_id = _user_id
            OR o.profile_id IN (SELECT profile_id FROM user_profiles)
          )
      ) AS has_purchase
    FROM items i
    WHERE i.month_key IS NOT NULL
  )
  SELECT c.lesson_id, c.has_purchase FROM checks c;
END;
$function$;