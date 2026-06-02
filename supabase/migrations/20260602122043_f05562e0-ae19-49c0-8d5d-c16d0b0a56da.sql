
-- Fix: lesson_id в has_month_purchase_bulk — opaque text-ключ.
-- Хуки useMonthGate / useModuleMonthGate шлют синтетический ключ
-- `${lesson_id}::${tariff_id}` для OR-агрегации по тарифам.
-- Каст ::uuid падал с 22P02, хук уходил в fallback "открыть всё".
-- Логика, фильтры, источник истины (orders_v2 paid + meta.deal_month) не меняются.

DROP FUNCTION IF EXISTS public.has_month_purchase_bulk(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.has_month_purchase_bulk(_user_id uuid, _items jsonb)
RETURNS TABLE(lesson_id text, has_purchase boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH items AS (
    SELECT
      (elem->>'lesson_id')              AS lesson_id,   -- opaque text key
      (elem->>'tariff_id')::uuid        AS tariff_id,
      CASE
        WHEN (elem->>'content_month') ~ '^\d{4}-\d{2}$'    THEN (elem->>'content_month')
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

GRANT EXECUTE ON FUNCTION public.has_month_purchase_bulk(uuid, jsonb) TO authenticated, service_role;
