
-- Fix audience filter: active_access + tariff_ids must filter via subscriptions_v2.tariff_id.
-- Without tariff_ids — keep current entitlements-by-product_id behavior (manual/historical grants preserved).
-- No orders_v2 fallback for one-time access (no precise access-window source).

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
  _system_bypass boolean := COALESCE((_filters->>'__system_bypass')::boolean, false);
BEGIN
  IF NOT (_system_bypass AND auth.uid() IS NULL) THEN
    IF NOT public.has_permission(auth.uid(), 'entitlements.manage') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  WITH
  include_uuid_users AS (
    SELECT (elem #>> '{}')::uuid AS uid
    FROM jsonb_array_elements(_include) AS elem
    WHERE jsonb_typeof(elem) = 'string'
  ),
  include_object_rules AS (
    SELECT
      NULLIF(elem->>'product_id','')::uuid AS product_id,
      COALESCE(elem->>'mode','active_access') AS mode,
      CASE
        WHEN jsonb_typeof(elem->'tariff_ids') = 'array' AND jsonb_array_length(elem->'tariff_ids') > 0
          THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
        ELSE NULL
      END AS tariff_ids
    FROM jsonb_array_elements(_include) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND (elem ? 'product_id')
  ),
  -- active_access без tariff_ids: текущее поведение через entitlements (manual/исторические гранты сохраняются)
  include_active_access_ent AS (
    SELECT DISTINCT e.user_id AS uid
    FROM entitlements e
    JOIN include_object_rules r ON r.product_id = e.product_id
    WHERE r.mode = 'active_access'
      AND r.tariff_ids IS NULL
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ),
  -- active_access с tariff_ids: точный фильтр через subscriptions_v2 по tariff_id
  include_active_access_sub AS (
    SELECT DISTINCT s.user_id AS uid
    FROM subscriptions_v2 s
    JOIN include_object_rules r
      ON (r.product_id IS NULL OR s.product_id = r.product_id)
     AND s.tariff_id = ANY(r.tariff_ids)
    WHERE r.mode = 'active_access'
      AND r.tariff_ids IS NOT NULL
      AND s.status IN ('active','trial','past_due')
  ),
  include_purchased AS (
    SELECT DISTINCT COALESCE(
      o.user_id,
      (SELECT pr.user_id FROM profiles pr WHERE pr.id = o.profile_id LIMIT 1),
      (SELECT pr.user_id FROM profiles pr WHERE lower(pr.email) = lower(o.customer_email) LIMIT 1)
    ) AS uid
    FROM orders_v2 o
    JOIN include_object_rules r ON r.product_id = o.product_id
    WHERE r.mode = 'purchased'
      AND o.status = 'paid'
      AND COALESCE(o.reconcile_source, '') <> 'rule_engine'
      AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
  ),
  include_all AS (
    SELECT uid FROM include_uuid_users WHERE uid IS NOT NULL
    UNION
    SELECT uid FROM include_active_access_ent WHERE uid IS NOT NULL
    UNION
    SELECT uid FROM include_active_access_sub WHERE uid IS NOT NULL
    UNION
    SELECT uid FROM include_purchased WHERE uid IS NOT NULL
  ),

  exclude_uuid_users AS (
    SELECT (elem #>> '{}')::uuid AS uid
    FROM jsonb_array_elements(_exclude) AS elem
    WHERE jsonb_typeof(elem) = 'string'
  ),
  exclude_object_rules AS (
    SELECT
      NULLIF(elem->>'product_id','')::uuid AS product_id,
      COALESCE(elem->>'mode','active_access') AS mode,
      CASE
        WHEN jsonb_typeof(elem->'tariff_ids') = 'array' AND jsonb_array_length(elem->'tariff_ids') > 0
          THEN ARRAY(SELECT (jsonb_array_elements_text(elem->'tariff_ids'))::uuid)
        ELSE NULL
      END AS tariff_ids
    FROM jsonb_array_elements(_exclude) AS elem
    WHERE jsonb_typeof(elem) = 'object' AND (elem ? 'product_id')
  ),
  exclude_active_access_ent AS (
    SELECT DISTINCT e.user_id AS uid
    FROM entitlements e
    JOIN exclude_object_rules r ON r.product_id = e.product_id
    WHERE r.mode = 'active_access'
      AND r.tariff_ids IS NULL
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ),
  exclude_active_access_sub AS (
    SELECT DISTINCT s.user_id AS uid
    FROM subscriptions_v2 s
    JOIN exclude_object_rules r
      ON (r.product_id IS NULL OR s.product_id = r.product_id)
     AND s.tariff_id = ANY(r.tariff_ids)
    WHERE r.mode = 'active_access'
      AND r.tariff_ids IS NOT NULL
      AND s.status IN ('active','trial','past_due')
  ),
  exclude_purchased AS (
    SELECT DISTINCT COALESCE(
      o.user_id,
      (SELECT pr.user_id FROM profiles pr WHERE pr.id = o.profile_id LIMIT 1),
      (SELECT pr.user_id FROM profiles pr WHERE lower(pr.email) = lower(o.customer_email) LIMIT 1)
    ) AS uid
    FROM orders_v2 o
    JOIN exclude_object_rules r ON r.product_id = o.product_id
    WHERE r.mode = 'purchased'
      AND o.status = 'paid'
      AND COALESCE(o.reconcile_source, '') <> 'rule_engine'
      AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
  ),
  exclude_all AS (
    SELECT uid FROM exclude_uuid_users WHERE uid IS NOT NULL
    UNION
    SELECT uid FROM exclude_active_access_ent WHERE uid IS NOT NULL
    UNION
    SELECT uid FROM exclude_active_access_sub WHERE uid IS NOT NULL
    UNION
    SELECT uid FROM exclude_purchased WHERE uid IS NOT NULL
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
  filtered_by_include AS (
    SELECT b.* FROM base b
    WHERE
      (jsonb_array_length(_include) = 0)
      OR EXISTS (SELECT 1 FROM include_all i WHERE i.uid = b.user_id)
  ),
  filtered_by_exclude AS (
    SELECT f.* FROM filtered_by_include f
    WHERE NOT EXISTS (SELECT 1 FROM exclude_all e WHERE e.uid = f.user_id)
  ),
  filtered_by_clubs AS (
    SELECT fbe.*
    FROM filtered_by_exclude fbe
    WHERE
      array_length(_club_ids, 1) IS NULL
      OR EXISTS (
        SELECT 1
        FROM telegram_club_members tcm
        JOIN profiles cp ON cp.id = tcm.profile_id
        WHERE cp.user_id = fbe.user_id
          AND tcm.club_id = ANY(_club_ids)
          AND (
            (_club_membership = 'current' AND tcm.in_chat = true)
            OR (_club_membership = 'ever')
          )
      )
  )
  SELECT DISTINCT fc.user_id, fc.has_tg, fc.has_em
  FROM filtered_by_clubs fc;
END;
$function$;


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
    -- active_access без tariff_ids: через entitlements (сохраняем manual/исторические гранты)
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN public.entitlements e ON e.user_id = p.user_id
    JOIN inc_rules r
      ON r.mode = 'active_access'
     AND r.tariff_ids IS NULL
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND p.user_id IS NOT NULL
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
    UNION
    -- active_access с tariff_ids: точный фильтр через subscriptions_v2.tariff_id
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN public.subscriptions_v2 s ON s.user_id = p.user_id
    JOIN inc_rules r
      ON r.mode = 'active_access'
     AND r.tariff_ids IS NOT NULL
     AND (r.product_id IS NULL OR s.product_id = r.product_id)
     AND s.tariff_id = ANY(r.tariff_ids)
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND p.user_id IS NOT NULL
      AND s.status IN ('active','trial','past_due')
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
     AND r.tariff_ids IS NULL
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND p.user_id IS NOT NULL
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
    UNION
    SELECT DISTINCT p.id AS profile_id
    FROM public.profiles p
    JOIN public.subscriptions_v2 s ON s.user_id = p.user_id
    JOIN exc_rules r
      ON r.mode = 'active_access'
     AND r.tariff_ids IS NOT NULL
     AND (r.product_id IS NULL OR s.product_id = r.product_id)
     AND s.tariff_id = ANY(r.tariff_ids)
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
      AND p.user_id IS NOT NULL
      AND s.status IN ('active','trial','past_due')
  ),
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
