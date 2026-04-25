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
  -- Resolve include rules into a set of user_ids
  include_uuid_users AS (
    -- raw uuid strings in include
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
  include_active_access AS (
    SELECT DISTINCT e.user_id AS uid
    FROM entitlements e
    JOIN include_object_rules r ON r.product_id = e.product_id
    WHERE r.mode = 'active_access'
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ),
  include_purchased AS (
    SELECT DISTINCT s.user_id AS uid
    FROM subscriptions_v2 s
    JOIN include_object_rules r ON r.product_id = s.product_id
    WHERE r.mode = 'purchased'
      AND (r.tariff_ids IS NULL OR s.tariff_id = ANY(r.tariff_ids))
  ),
  include_all AS (
    SELECT uid FROM include_uuid_users
    UNION
    SELECT uid FROM include_active_access
    UNION
    SELECT uid FROM include_purchased
  ),

  -- Resolve exclude rules into a set of user_ids
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
  exclude_active_access AS (
    SELECT DISTINCT e.user_id AS uid
    FROM entitlements e
    JOIN exclude_object_rules r ON r.product_id = e.product_id
    WHERE r.mode = 'active_access'
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ),
  exclude_purchased AS (
    SELECT DISTINCT s.user_id AS uid
    FROM subscriptions_v2 s
    JOIN exclude_object_rules r ON r.product_id = s.product_id
    WHERE r.mode = 'purchased'
      AND (r.tariff_ids IS NULL OR s.tariff_id = ANY(r.tariff_ids))
  ),
  exclude_all AS (
    SELECT uid FROM exclude_uuid_users
    UNION
    SELECT uid FROM exclude_active_access
    UNION
    SELECT uid FROM exclude_purchased
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
    WHERE
      jsonb_array_length(_include) = 0
      OR EXISTS (SELECT 1 FROM include_all i WHERE i.uid = b.user_id)
  ),
  excluded AS (
    SELECT i.user_id, i.has_tg, i.has_em
    FROM included i
    WHERE NOT EXISTS (SELECT 1 FROM exclude_all x WHERE x.uid = i.user_id)
  ),
  club_filtered AS (
    SELECT e.user_id, e.has_tg, e.has_em
    FROM excluded e
    WHERE
      array_length(_club_ids, 1) IS NULL
      OR (
        _club_membership = 'current' AND EXISTS (
          SELECT 1 FROM telegram_club_members tcm
          WHERE tcm.profile_id = e.user_id
            AND tcm.club_id = ANY(_club_ids)
            AND (tcm.in_chat = true OR tcm.in_channel = true)
        )
      )
      OR (
        _club_membership = 'former' AND EXISTS (
          SELECT 1 FROM telegram_club_members tcm
          WHERE tcm.profile_id = e.user_id
            AND tcm.club_id = ANY(_club_ids)
            AND COALESCE(tcm.in_chat, false) = false
            AND COALESCE(tcm.in_channel, false) = false
        )
      )
      OR (
        _club_membership = 'any' AND EXISTS (
          SELECT 1 FROM telegram_club_members tcm
          WHERE tcm.profile_id = e.user_id
            AND tcm.club_id = ANY(_club_ids)
        )
      )
  )
  SELECT cf.user_id, cf.has_tg, cf.has_em
  FROM club_filtered cf;
END;
$function$;