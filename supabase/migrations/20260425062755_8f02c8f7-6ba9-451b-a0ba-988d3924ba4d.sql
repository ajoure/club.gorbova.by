-- Sprint B P0 PATCH: resolve_broadcast_audience_user_ids
-- Root cause: jsonb_array_elements внутри EXISTS+CASE в plpgsql STABLE SECURITY DEFINER
-- даёт пустой результат при include с product_id (планировщик/lateral edge case).
-- Fix: материализуем _include/_exclude через CTE с распарсенными полями,
-- применяем JOIN-based матчинг вместо EXISTS+CASE с jsonb-параметром.
-- Бизнес-логика 1:1: purchased=orders_v2.status='paid', active_access=subscriptions_v2.status='active',
-- product_id, tariff_ids, exclude, channels, club_ids, club_membership.

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
  -- Allow system context (service_role / cron); enforce permission for interactive callers.
  IF _uid IS NOT NULL AND NOT public.has_permission(_uid, 'entitlements.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
    -- ► Материализуем include-правила в табличный вид
    inc_rules AS (
      SELECT
        COALESCE(elem->>'mode','purchased')               AS mode,
        NULLIF(elem->>'product_id','')::uuid              AS product_id,
        CASE WHEN jsonb_typeof(elem->'tariff_ids')='array' AND jsonb_array_length(elem->'tariff_ids') > 0
          THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
          ELSE NULL::uuid[] END                           AS tariff_ids
      FROM jsonb_array_elements(_include) AS elem
    ),
    exc_rules AS (
      SELECT
        COALESCE(elem->>'mode','purchased')               AS mode,
        NULLIF(elem->>'product_id','')::uuid              AS product_id,
        CASE WHEN jsonb_typeof(elem->'tariff_ids')='array' AND jsonb_array_length(elem->'tariff_ids') > 0
          THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
          ELSE NULL::uuid[] END                           AS tariff_ids
      FROM jsonb_array_elements(_exclude) AS elem
    ),
    base AS (
      SELECT
        p.user_id,
        (p.telegram_user_id IS NOT NULL) AS has_tg,
        (p.email IS NOT NULL AND length(p.email) > 0) AS has_em
      FROM profiles p
      WHERE
        ('telegram' = ANY(_channels) AND p.telegram_user_id IS NOT NULL)
        OR ('email' = ANY(_channels) AND p.email IS NOT NULL AND length(p.email) > 0)
    ),
    -- ► JOIN-based матчинг include: пользователь матчится, если ЛЮБОЕ правило истинно
    inc_matches AS (
      SELECT DISTINCT b.user_id
      FROM base b
      JOIN inc_rules r ON TRUE
      WHERE
        (r.mode = 'active_access' AND EXISTS (
          SELECT 1 FROM subscriptions_v2 s
          WHERE s.user_id = b.user_id
            AND s.status = 'active'
            AND (r.product_id IS NULL OR s.product_id = r.product_id)
            AND (r.tariff_ids IS NULL OR s.tariff_id = ANY(r.tariff_ids))
        ))
        OR (r.mode <> 'active_access' AND EXISTS (
          SELECT 1 FROM orders_v2 o
          WHERE o.user_id = b.user_id
            AND o.status = 'paid'
            AND (r.product_id IS NULL OR o.product_id = r.product_id)
            AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
        ))
    ),
    included AS (
      SELECT b.user_id, b.has_tg, b.has_em
      FROM base b
      WHERE (SELECT count(*) FROM inc_rules) = 0
         OR EXISTS (SELECT 1 FROM inc_matches m WHERE m.user_id = b.user_id)
    ),
    exc_matches AS (
      SELECT DISTINCT i.user_id
      FROM included i
      JOIN exc_rules r ON TRUE
      WHERE
        (r.mode = 'active_access' AND EXISTS (
          SELECT 1 FROM subscriptions_v2 s
          WHERE s.user_id = i.user_id
            AND s.status = 'active'
            AND (r.product_id IS NULL OR s.product_id = r.product_id)
            AND (r.tariff_ids IS NULL OR s.tariff_id = ANY(r.tariff_ids))
        ))
        OR (r.mode <> 'active_access' AND EXISTS (
          SELECT 1 FROM orders_v2 o
          WHERE o.user_id = i.user_id
            AND o.status = 'paid'
            AND (r.product_id IS NULL OR o.product_id = r.product_id)
            AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
        ))
    ),
    after_exclude AS (
      SELECT i.user_id, i.has_tg, i.has_em
      FROM included i
      WHERE NOT EXISTS (SELECT 1 FROM exc_matches e WHERE e.user_id = i.user_id)
    ),
    after_clubs AS (
      SELECT a.user_id, a.has_tg, a.has_em
      FROM after_exclude a
      WHERE
        array_length(_club_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1 FROM telegram_access ta
          WHERE ta.user_id = a.user_id
            AND ta.club_id = ANY(_club_ids)
            AND CASE _club_membership
              WHEN 'current' THEN (ta.active_until IS NULL OR ta.active_until > now())
              ELSE TRUE
            END
        )
    )
  SELECT ac.user_id, ac.has_tg, ac.has_em FROM after_clubs ac;
END;
$function$;
