-- ============================================================
-- BACKUP: resolve_broadcast_audience_user_ids (BEFORE Sprint B P0 PATCH)
-- Captured: 2026-04-25
-- Reason: P0 fix — функция возвращает 0 для include с product_id,
--         хотя SQL-логика вне функции даёт корректный результат.
-- Способ восстановления: выполнить весь блок CREATE OR REPLACE ниже.
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience_user_ids(_filters jsonb)
 RETURNS TABLE(user_id uuid, has_telegram boolean, has_email boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _include jsonb := COALESCE(_filters->'include', '[]'::jsonb);
  _exclude jsonb := COALESCE(_filters->'exclude', '[]'::jsonb);
  _club_ids uuid[] := CASE
    WHEN jsonb_typeof(_filters->'club_ids') = 'array'
      THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'club_ids'))::uuid)
    ELSE ARRAY[]::uuid[]
  END;
  _club_membership text := COALESCE(_filters->>'club_membership', 'current');
  _channels text[] := CASE
    WHEN jsonb_typeof(_filters->'channels') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'channels'))
    ELSE ARRAY['telegram','email']
  END;
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NOT NULL AND NOT public.has_permission(_uid, 'entitlements.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT p.user_id, (p.telegram_user_id IS NOT NULL) AS has_tg,
           (p.email IS NOT NULL AND length(p.email) > 0) AS has_em
    FROM profiles p
    WHERE ('telegram' = ANY(_channels) AND p.telegram_user_id IS NOT NULL)
       OR ('email' = ANY(_channels) AND p.email IS NOT NULL AND length(p.email) > 0)
  ),
  included AS (
    SELECT b.user_id, b.has_tg, b.has_em
    FROM base b
    WHERE jsonb_array_length(_include) = 0
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(_include) AS rule
         WHERE CASE COALESCE(rule->>'mode', 'purchased')
           WHEN 'active_access' THEN EXISTS (
             SELECT 1 FROM subscriptions_v2 s
             WHERE s.user_id = b.user_id AND s.status = 'active'
               AND ((rule->>'product_id') IS NULL OR (rule->>'product_id') = '' OR s.product_id = (rule->>'product_id')::uuid)
               AND (jsonb_typeof(rule->'tariff_ids') <> 'array' OR jsonb_array_length(rule->'tariff_ids') = 0
                    OR s.tariff_id = ANY(ARRAY(SELECT (jsonb_array_elements_text(rule->'tariff_ids'))::uuid)))
           )
           ELSE EXISTS (
             SELECT 1 FROM orders_v2 o
             WHERE o.user_id = b.user_id AND o.status = 'paid'
               AND ((rule->>'product_id') IS NULL OR (rule->>'product_id') = '' OR o.product_id = (rule->>'product_id')::uuid)
               AND (jsonb_typeof(rule->'tariff_ids') <> 'array' OR jsonb_array_length(rule->'tariff_ids') = 0
                    OR o.tariff_id = ANY(ARRAY(SELECT (jsonb_array_elements_text(rule->'tariff_ids'))::uuid)))
           )
         END
       )
  ),
  after_exclude AS (
    SELECT i.user_id, i.has_tg, i.has_em FROM included i
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_exclude) AS rule
      WHERE CASE COALESCE(rule->>'mode', 'purchased')
        WHEN 'active_access' THEN EXISTS (
          SELECT 1 FROM subscriptions_v2 s
          WHERE s.user_id = i.user_id AND s.status = 'active'
            AND ((rule->>'product_id') IS NULL OR (rule->>'product_id') = '' OR s.product_id = (rule->>'product_id')::uuid)
            AND (jsonb_typeof(rule->'tariff_ids') <> 'array' OR jsonb_array_length(rule->'tariff_ids') = 0
                 OR s.tariff_id = ANY(ARRAY(SELECT (jsonb_array_elements_text(rule->'tariff_ids'))::uuid)))
        )
        ELSE EXISTS (
          SELECT 1 FROM orders_v2 o
          WHERE o.user_id = i.user_id AND o.status = 'paid'
            AND ((rule->>'product_id') IS NULL OR (rule->>'product_id') = '' OR o.product_id = (rule->>'product_id')::uuid)
            AND (jsonb_typeof(rule->'tariff_ids') <> 'array' OR jsonb_array_length(rule->'tariff_ids') = 0
                 OR o.tariff_id = ANY(ARRAY(SELECT (jsonb_array_elements_text(rule->'tariff_ids'))::uuid)))
        )
      END
    )
  ),
  after_clubs AS (
    SELECT a.user_id, a.has_tg, a.has_em FROM after_exclude a
    WHERE array_length(_club_ids, 1) IS NULL
       OR EXISTS (
         SELECT 1 FROM telegram_access ta
         WHERE ta.user_id = a.user_id AND ta.club_id = ANY(_club_ids)
           AND CASE _club_membership
             WHEN 'current' THEN (ta.active_until IS NULL OR ta.active_until > now())
             ELSE TRUE
           END
       )
  )
  SELECT ac.user_id, ac.has_tg, ac.has_em FROM after_clubs ac;
END;
$function$;
