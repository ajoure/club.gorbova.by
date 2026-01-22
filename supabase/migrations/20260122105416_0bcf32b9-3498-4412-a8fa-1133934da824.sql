-- ============================================================
-- PATCH: Расширить search RPC + исправить is_unknown формулу
-- ============================================================

-- 1. Обновить VIEW v_club_members_enriched - добавить external_id_amo
DROP VIEW IF EXISTS v_club_members_enriched;

CREATE VIEW v_club_members_enriched AS
SELECT 
  tcm.id,
  tcm.club_id,
  tcm.telegram_user_id,
  tcm.telegram_username,
  tcm.telegram_first_name,
  tcm.telegram_last_name,
  tcm.in_chat,
  tcm.in_channel,
  tcm.profile_id,
  tcm.link_status,
  tcm.access_status,
  tcm.created_at,
  tcm.updated_at,
  -- Profile fields (denormalized for convenience)
  p.user_id AS auth_user_id,
  p.email,
  p.full_name,
  p.phone,
  p.external_id_amo,  -- Added for search
  -- A: has_active_access via EXISTS (3 tables)
  CASE 
    WHEN p.user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM telegram_access ta 
      WHERE ta.user_id = p.user_id 
        AND ta.club_id = tcm.club_id 
        AND (ta.state_chat = 'active' OR ta.state_channel = 'active')
    ) OR EXISTS (
      SELECT 1 FROM telegram_manual_access tma 
      WHERE tma.user_id = p.user_id 
        AND tma.club_id = tcm.club_id 
        AND tma.is_active = true 
        AND (tma.valid_until IS NULL OR tma.valid_until > now())
    ) OR EXISTS (
      SELECT 1 FROM telegram_access_grants tag 
      WHERE tag.user_id = p.user_id 
        AND tag.club_id = tcm.club_id 
        AND tag.status = 'active' 
        AND (tag.end_at IS NULL OR tag.end_at > now())
    )
  END AS has_active_access,
  -- B: has_any_access_history
  CASE 
    WHEN p.user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1 FROM telegram_access ta WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id
    ) OR EXISTS (
      SELECT 1 FROM telegram_manual_access tma WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id
    ) OR EXISTS (
      SELECT 1 FROM telegram_access_grants tag WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id
    )
  END AS has_any_access_history,
  -- C: in_any = in_chat OR in_channel
  COALESCE(tcm.in_chat, false) OR COALESCE(tcm.in_channel, false) AS in_any,
  -- D: is_orphaned = no telegram_user_id OR telegram_user_id < 100
  (tcm.telegram_user_id IS NULL OR tcm.telegram_user_id < 100) AS is_orphaned
FROM telegram_club_members tcm
LEFT JOIN profiles p ON p.id = tcm.profile_id;

-- 2. Обновить RPC get_club_members_enriched - добавить external_id_amo и исправить is_unknown
DROP FUNCTION IF EXISTS get_club_members_enriched(UUID, TEXT);

CREATE OR REPLACE FUNCTION get_club_members_enriched(
  p_club_id UUID,
  p_scope TEXT DEFAULT 'relevant'
)
RETURNS TABLE (
  id UUID,
  club_id UUID,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  in_chat BOOLEAN,
  in_channel BOOLEAN,
  profile_id UUID,
  link_status TEXT,
  access_status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  auth_user_id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  external_id_amo TEXT,
  has_active_access BOOLEAN,
  has_any_access_history BOOLEAN,
  in_any BOOLEAN,
  is_orphaned BOOLEAN,
  is_violator BOOLEAN,
  is_bought_not_joined BOOLEAN,
  is_relevant BOOLEAN,
  is_unknown BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Admin check
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 
    v.id, v.club_id, v.telegram_user_id, v.telegram_username,
    v.telegram_first_name, v.telegram_last_name, v.in_chat, v.in_channel,
    v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    -- E: is_violator = in_any AND NOT has_active_access
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    -- F: is_bought_not_joined = has_active_access AND NOT in_any
    (COALESCE(v.has_active_access, false) AND NOT v.in_any) AS is_bought_not_joined,
    -- G: is_relevant = in_any OR removed OR has_any_access_history
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    -- H: is_unknown = NOT (in_any OR has_active_access OR is_bought_not_joined OR removed)
    -- Simplified: NOT in any tab = synced but no access, no presence, not removed
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
$$;

-- 3. Обновить RPC search_club_members_enriched - расширить источники поиска
DROP FUNCTION IF EXISTS search_club_members_enriched(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION search_club_members_enriched(
  p_club_id UUID,
  p_query TEXT,
  p_scope TEXT DEFAULT 'relevant'
)
RETURNS TABLE (
  id UUID,
  club_id UUID,
  telegram_user_id BIGINT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  in_chat BOOLEAN,
  in_channel BOOLEAN,
  profile_id UUID,
  link_status TEXT,
  access_status TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  auth_user_id UUID,
  email TEXT,
  full_name TEXT,
  phone TEXT,
  external_id_amo TEXT,
  has_active_access BOOLEAN,
  has_any_access_history BOOLEAN,
  in_any BOOLEAN,
  is_orphaned BOOLEAN,
  is_violator BOOLEAN,
  is_bought_not_joined BOOLEAN,
  is_relevant BOOLEAN,
  is_unknown BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_query TEXT := '%' || lower(p_query) || '%';
  v_user_id UUID;
BEGIN
  -- Admin check
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR NOT public.has_role(v_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (v.id)
    v.id, v.club_id, v.telegram_user_id, v.telegram_username,
    v.telegram_first_name, v.telegram_last_name, v.in_chat, v.in_channel,
    v.profile_id, v.link_status, v.access_status, v.created_at, v.updated_at,
    v.auth_user_id, v.email, v.full_name, v.phone, v.external_id_amo,
    v.has_active_access, v.has_any_access_history, v.in_any, v.is_orphaned,
    -- Computed flags
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any) AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown
  FROM v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      -- Scope filter (for search we use 'all' to not miss results)
      p_scope = 'all' 
      OR (p_scope = 'relevant' AND NOT COALESCE(v.is_orphaned, false) AND 
          (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)))
    )
    AND (
      -- A) Telegram fields
      lower(v.telegram_username) LIKE v_query OR
      v.telegram_user_id::text LIKE v_query OR
      lower(v.telegram_first_name) LIKE v_query OR
      lower(v.telegram_last_name) LIKE v_query OR
      -- B) Profile fields
      lower(v.email) LIKE v_query OR
      v.phone LIKE v_query OR
      lower(v.full_name) LIKE v_query OR
      lower(v.external_id_amo) LIKE v_query OR  -- amoCRM contact ID
      -- C) Orders (order_number, customer fields, GetCourse IDs)
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
      -- D) Payments (provider_payment_id, card_last4, meta.uid)
      EXISTS (
        SELECT 1 FROM payments_v2 pmt
        WHERE pmt.profile_id = v.profile_id
          AND (
            pmt.card_last4 LIKE v_query OR
            lower(pmt.provider_payment_id) LIKE v_query OR
            lower(pmt.meta->>'uid') LIKE v_query
          )
      ) OR
      -- E) Card profile links
      EXISTS (
        SELECT 1 FROM card_profile_links cpl
        WHERE cpl.profile_id = v.profile_id 
          AND (cpl.card_last4 LIKE v_query OR lower(cpl.card_brand) LIKE v_query)
      )
    )
  ORDER BY v.id, v.access_status, v.email NULLS LAST
  LIMIT 500;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_club_members_enriched(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION search_club_members_enriched(UUID, TEXT, TEXT) TO authenticated;