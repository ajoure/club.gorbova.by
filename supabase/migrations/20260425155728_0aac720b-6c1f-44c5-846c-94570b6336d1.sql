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
  base_contacts AS (
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
    WHERE p.email IS NOT NULL AND length(trim(p.email)) > 0
  ),
  inc_purchased_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN orders_v2 o
      ON (o.profile_id = bc.profile_id
          OR lower(nullif(trim(o.customer_email),'')) = bc.email_normalized)
    JOIN inc_rules r
      ON r.mode = 'purchased'
     AND (r.product_id IS NULL OR o.product_id = r.product_id)
     AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
    WHERE o.status = 'paid'
      AND COALESCE(o.reconcile_source,'') <> 'rule_engine'
  ),
  inc_active_access_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN public.entitlements e ON e.user_id = bc.user_id
    JOIN inc_rules r
      ON r.mode = 'active_access'
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND bc.user_id IS NOT NULL
  ),
  inc_all AS (
    SELECT profile_id FROM inc_purchased_contacts
    UNION
    SELECT profile_id FROM inc_active_access_contacts
  ),
  exc_purchased_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN orders_v2 o
      ON (o.profile_id = bc.profile_id
          OR lower(nullif(trim(o.customer_email),'')) = bc.email_normalized)
    JOIN exc_rules r
      ON r.mode = 'purchased'
     AND (r.product_id IS NULL OR o.product_id = r.product_id)
     AND (r.tariff_ids IS NULL OR o.tariff_id = ANY(r.tariff_ids))
    WHERE o.status = 'paid'
      AND COALESCE(o.reconcile_source,'') <> 'rule_engine'
  ),
  exc_active_access_contacts AS (
    SELECT DISTINCT bc.profile_id
    FROM base_contacts bc
    JOIN public.entitlements e ON e.user_id = bc.user_id
    JOIN exc_rules r
      ON r.mode = 'active_access'
     AND (r.product_id IS NULL OR e.product_id = r.product_id)
    WHERE e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND bc.user_id IS NOT NULL
  ),
  exc_all AS (
    SELECT profile_id FROM exc_purchased_contacts
    UNION
    SELECT profile_id FROM exc_active_access_contacts
  ),
  filtered AS (
    SELECT bc.*
    FROM base_contacts bc
    WHERE
      (jsonb_array_length(_include) = 0
       OR EXISTS (SELECT 1 FROM inc_all i WHERE i.profile_id = bc.profile_id))
    AND
      NOT EXISTS (SELECT 1 FROM exc_all e WHERE e.profile_id = bc.profile_id)
    AND
      (_include_archived OR NOT bc.is_archived)
    AND
      (
        array_length(_club_ids, 1) IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.telegram_club_members tcm
          WHERE tcm.profile_id = bc.profile_id
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

CREATE OR REPLACE FUNCTION public.resolve_broadcast_audience_contacts_system(_filters jsonb)
RETURNS TABLE(profile_id uuid, email text, email_normalized text, user_id uuid, has_account boolean, is_archived boolean, has_telegram boolean, full_name text, telegram_username text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT * FROM public.resolve_broadcast_audience_contacts(
    COALESCE(_filters,'{}'::jsonb) || jsonb_build_object('__system_bypass', true)
  );
$function$;

REVOKE ALL ON FUNCTION public.resolve_broadcast_audience_contacts_system(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_broadcast_audience_contacts_system(jsonb) TO service_role;