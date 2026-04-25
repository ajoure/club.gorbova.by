-- PATCH: оптимизация resolve_broadcast_audience_contacts
-- Проблема: OR в JOIN orders_v2 (profile_id OR lower(email)) приводит к seq scan + nested loop
-- и таймауту (statement_timeout) на больших продуктах.
-- Решение: разделить join по двум каналам соответствия через UNION,
-- и ограничить базу контактов теми, что реально могут попасть в include.

CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience_contacts(_filters jsonb)
 RETURNS TABLE(profile_id uuid, email text, email_normalized text, user_id uuid, has_account boolean, is_archived boolean, has_telegram boolean, full_name text, telegram_username text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _include jsonb := COALESCE(_filters->'include', '[]'::jsonb);
  _exclude jsonb := COALESCE(_filters->'exclude', '[]'::jsonb);
  _club_ids uuid[] := CASE
    WHEN jsonb_typeof(_filters->'club_ids') = 'array'
      THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'club_ids'))::uuid)
    ELSE ARRAY[]::uuid[]
  END;
  _club_membership text := COALESCE(_filters->>'club_membership', 'current');
  _include_archived boolean := COALESCE((_filters->>'include_archived')::boolean, false);
  _system_bypass boolean := COALESCE((_filters->>'__system_bypass')::boolean, false);
BEGIN
  IF NOT (_system_bypass AND auth.uid() IS NULL) THEN
    IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH
  inc_rules AS (
    SELECT
      COALESCE(elem->>'mode','purchased') AS mode,
      NULLIF(elem->>'product_id','')::uuid AS product_id,
      CASE WHEN jsonb_typeof(elem->'tariff_ids')='array' AND jsonb_array_length(elem->'tariff_ids') > 0
        THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
        ELSE NULL::uuid[] END AS tariff_ids
    FROM jsonb_array_elements(_include) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND (elem ? 'product_id' OR elem ? 'mode')
  ),
  exc_rules AS (
    SELECT
      COALESCE(elem->>'mode','purchased') AS mode,
      NULLIF(elem->>'product_id','')::uuid AS product_id,
      CASE WHEN jsonb_typeof(elem->'tariff_ids')='array' AND jsonb_array_length(elem->'tariff_ids') > 0
        THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
        ELSE NULL::uuid[] END AS tariff_ids
    FROM jsonb_array_elements(_exclude) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND (elem ? 'product_id' OR elem ? 'mode')
  ),
  -- Заранее отбираем все paid orders, релевантные include-правилам
  inc_paid_orders AS (
    SELECT o.profile_id, lower(nullif(trim(o.customer_email),'')) AS email_normalized
    FROM orders_v2 o
    JOIN inc_rules r
      ON r.mode = 'purchased'
     AND (r.product_id IS NULL OR o.product_id = r.product_id)
     AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
    WHERE o.status = 'paid'
      AND COALESCE(o.reconcile_source,'') <> 'rule_engine'
  ),
  exc_paid_orders AS (
    SELECT o.profile_id, lower(nullif(trim(o.customer_email),'')) AS email_normalized
    FROM orders_v2 o
    JOIN exc_rules r
      ON r.mode = 'purchased'
     AND (r.product_id IS NULL OR o.product_id = r.product_id)
     AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
    WHERE o.status = 'paid'
      AND COALESCE(o.reconcile_source,'') <> 'rule_engine'
  ),
  -- Кандидатные profile_id для include: union по двум каналам соответствия
  inc_candidate_profiles AS (
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN inc_paid_orders ipo ON ipo.profile_id = p.id
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
    UNION
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN inc_paid_orders ipo
      ON ipo.email_normalized = lower(nullif(trim(p.email),''))
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
    UNION
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN public.entitlements e ON e.user_id = p.user_id
    JOIN inc_rules r
      ON r.mode = 'active_access'
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND p.user_id IS NOT NULL
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ),
  exc_candidate_profiles AS (
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN exc_paid_orders epo ON epo.profile_id = p.id
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
    UNION
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN exc_paid_orders epo
      ON epo.email_normalized = lower(nullif(trim(p.email),''))
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
    UNION
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN public.entitlements e ON e.user_id = p.user_id
    JOIN exc_rules r
      ON r.mode = 'active_access'
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND p.user_id IS NOT NULL
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ),
  -- База: либо все профили (если include пустой), либо только кандидаты
  base_profiles AS (
    SELECT p.id AS profile_id
    FROM public.profiles p
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND (
        (SELECT count(*) FROM inc_rules) = 0
        OR p.id IN (SELECT profile_id FROM inc_candidate_profiles)
      )
      AND p.id NOT IN (SELECT profile_id FROM exc_candidate_profiles)
  ),
  filtered AS (
    SELECT
      p.id AS profile_id,
      p.email,
      lower(nullif(trim(p.email),'')) AS email_normalized,
      p.user_id,
      (p.user_id IS NOT NULL) AS has_account,
      (COALESCE(p.is_archived, false) OR p.status = 'archived') AS is_archived,
      (p.telegram_user_id IS NOT NULL) AS has_telegram,
      p.full_name,
      p.telegram_username
    FROM public.profiles p
    JOIN base_profiles bp ON bp.profile_id = p.id
    WHERE
      (_include_archived OR NOT (COALESCE(p.is_archived, false) OR p.status = 'archived'))
    AND
      (
        array_length(_club_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.telegram_club_members tcm
          WHERE tcm.profile_id = p.id
            AND tcm.club_id = ANY(_club_ids)
            AND (
              (_club_membership = 'current' AND tcm.in_chat = true)
              OR (_club_membership IN ('ever','any'))
            )
        )
      )
  ),
  dedup AS (
    SELECT f.*,
      row_number() OVER (
        PARTITION BY f.email_normalized
        ORDER BY f.has_account DESC, f.is_archived ASC, f.profile_id ASC
      ) AS rn
    FROM filtered f
    WHERE f.email_normalized IS NOT NULL
  )
  SELECT
    d.profile_id,
    d.email,
    d.email_normalized,
    d.user_id,
    d.has_account,
    d.is_archived,
    d.has_telegram,
    d.full_name,
    d.telegram_username
  FROM dedup d
  WHERE d.rn = 1;
END;
$function$;