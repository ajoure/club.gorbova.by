
-- 0) Helper: has_any_role for unified guards
CREATE OR REPLACE FUNCTION public.has_any_role(p_user_id uuid, p_roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM unnest(p_roles) AS r(role)
    WHERE public.has_role(p_user_id, r.role)
  );
$$;

-- 1) Patch get_club_members_enriched: admin OR superadmin
CREATE OR REPLACE FUNCTION public.get_club_members_enriched(p_club_id uuid, p_scope text DEFAULT 'relevant'::text)
 RETURNS TABLE(id uuid, club_id uuid, telegram_user_id bigint, telegram_username text, telegram_first_name text, telegram_last_name text, in_chat boolean, in_channel boolean, profile_id uuid, link_status text, access_status text, created_at timestamp with time zone, updated_at timestamp with time zone, auth_user_id uuid, email text, full_name text, phone text, external_id_amo text, has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean, is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    v.id, v.club_id, v.telegram_user_id, v.telegram_username,
    v.telegram_first_name, v.telegram_last_name, v.in_chat, v.in_channel,
    v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any) AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (
      v.in_any OR 
      COALESCE(v.has_active_access, false) OR 
      v.access_status = 'removed'
    ) AS is_unknown
  FROM v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all' 
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false) AND 
          (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)))
    )
  ORDER BY v.access_status, v.email NULLS LAST;
END;
$function$;

-- 2) Patch search_club_members_enriched: admin OR superadmin
CREATE OR REPLACE FUNCTION public.search_club_members_enriched(p_club_id uuid, p_query text, p_scope text DEFAULT 'relevant'::text)
 RETURNS TABLE(id uuid, club_id uuid, telegram_user_id bigint, telegram_username text, telegram_first_name text, telegram_last_name text, in_chat boolean, in_channel boolean, profile_id uuid, link_status text, access_status text, created_at timestamp with time zone, updated_at timestamp with time zone, auth_user_id uuid, email text, full_name text, phone text, external_id_amo text, has_active_access boolean, has_any_access_history boolean, in_any boolean, is_orphaned boolean, is_violator boolean, is_bought_not_joined boolean, is_relevant boolean, is_unknown boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_query TEXT := '%' || lower(p_query) || '%';
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (v.id)
    v.id, v.club_id, v.telegram_user_id, v.telegram_username,
    v.telegram_first_name, v.telegram_last_name, v.in_chat, v.in_channel,
    v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any) AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown
  FROM v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all' 
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false) AND 
          (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)))
    )
    AND (
      lower(v.telegram_username) LIKE v_query OR
      v.telegram_user_id::text LIKE v_query OR
      lower(v.telegram_first_name) LIKE v_query OR
      lower(v.telegram_last_name) LIKE v_query OR
      lower(v.email) LIKE v_query OR
      v.phone LIKE v_query OR
      lower(v.full_name) LIKE v_query OR
      lower(v.external_id_amo) LIKE v_query OR
      EXISTS (
        SELECT 1 FROM orders_v2 o 
        WHERE o.profile_id = v.profile_id
          AND (
            lower(o.order_number) LIKE v_query OR
            lower(o.customer_email) LIKE v_query OR
            o.customer_phone LIKE v_query OR
            lower(o.meta->>'gc_deal_number') LIKE v_query OR
            lower(o.meta->>'getcourse_order_id') LIKE v_query
          )
      ) OR
      EXISTS (
        SELECT 1 FROM payments_v2 pmt
        WHERE pmt.profile_id = v.profile_id
          AND (
            pmt.card_last4 LIKE v_query OR
            lower(pmt.provider_payment_id) LIKE v_query OR
            lower(pmt.meta->>'uid') LIKE v_query
          )
      ) OR
      EXISTS (
        SELECT 1 FROM card_profile_links cpl
        WHERE cpl.profile_id = v.profile_id 
          AND (cpl.card_last4 LIKE v_query OR lower(cpl.card_brand) LIKE v_query)
      )
    )
  ORDER BY v.id, v.access_status, v.email NULLS LAST
  LIMIT 500;
END;
$function$;
