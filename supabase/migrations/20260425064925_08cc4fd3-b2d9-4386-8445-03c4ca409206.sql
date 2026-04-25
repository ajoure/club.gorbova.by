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
  _has_inc boolean := jsonb_array_length(_include) > 0;
  _has_exc boolean := jsonb_array_length(_exclude) > 0;
BEGIN
  IF _uid IS NOT NULL AND NOT public.has_permission(_uid, 'entitlements.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
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
    inc_matches AS (
      SELECT DISTINCT o.user_id
      FROM orders_v2 o
      JOIN inc_rules r ON r.mode <> 'active_access'
                      AND (r.product_id IS NULL OR o.product_id = r.product_id)
                      AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
      WHERE o.status = 'paid'
      UNION
      SELECT DISTINCT s.user_id
      FROM subscriptions_v2 s
      JOIN inc_rules r ON r.mode = 'active_access'
                      AND (r.product_id IS NULL OR s.product_id = r.product_id)
                      AND (r.tariff_ids IS NULL OR s.tariff_id = ANY(r.tariff_ids))
      WHERE s.status = 'active'
    ),
    exc_matches AS (
      SELECT DISTINCT o.user_id
      FROM orders_v2 o
      JOIN exc_rules r ON r.mode <> 'active_access'
                      AND (r.product_id IS NULL OR o.product_id = r.product_id)
                      AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
      WHERE o.status = 'paid'
      UNION
      SELECT DISTINCT s.user_id
      FROM subscriptions_v2 s
      JOIN exc_rules r ON r.mode = 'active_access'
                      AND (r.product_id IS NULL OR s.product_id = r.product_id)
                      AND (r.tariff_ids IS NULL OR s.tariff_id = ANY(r.tariff_ids))
      WHERE s.status = 'active'
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
    included AS (
      SELECT b.user_id, b.has_tg, b.has_em
      FROM base b
      WHERE NOT _has_inc
         OR b.user_id IN (SELECT m.user_id FROM inc_matches m)
    ),
    after_exclude AS (
      SELECT i.user_id, i.has_tg, i.has_em
      FROM included i
      WHERE NOT _has_exc
         OR i.user_id NOT IN (SELECT m.user_id FROM exc_matches m)
    ),
    -- Club filter — uses telegram_access (1:1 with v0 backup)
    after_clubs AS (
      SELECT a.user_id, a.has_tg, a.has_em
      FROM after_exclude a
      WHERE array_length(_club_ids, 1) IS NULL
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
  SELECT ac.user_id, ac.has_tg, ac.has_em
  FROM after_clubs ac;
END;
$function$;

COMMENT ON FUNCTION public.resolve_broadcast_audience_user_ids(jsonb) IS
'P0 PATCH v2.1 (perf+club fix): pre-materialize matched user_ids before joining profiles. Same logic 1:1 with v0, uses telegram_access for club filter. ~10ms vs v0 10.7s.';