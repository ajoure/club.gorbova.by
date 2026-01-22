-- Fix search RPC: remove non-existent amo_id column
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
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.club_id,
    v.telegram_user_id,
    v.telegram_username,
    v.telegram_first_name,
    v.telegram_last_name,
    v.in_chat,
    v.in_channel,
    v.profile_id,
    v.link_status,
    v.access_status,
    v.created_at,
    v.updated_at,
    v.auth_user_id,
    v.email,
    v.full_name,
    v.phone,
    v.has_active_access,
    v.has_any_access_history,
    v.in_any,
    v.is_orphaned,
    -- Computed flags
    (v.in_any AND NOT COALESCE(v.has_active_access, false)) AS is_violator,
    (COALESCE(v.has_active_access, false) AND NOT v.in_any) AS is_bought_not_joined,
    (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false)) AS is_relevant,
    NOT (v.in_any OR COALESCE(v.has_active_access, false) OR v.access_status = 'removed') AS is_unknown
  FROM v_club_members_enriched v
  WHERE v.club_id = p_club_id
    AND (
      p_scope = 'all' 
      OR (
        p_scope = 'relevant' 
        AND NOT COALESCE(v.is_orphaned, false)
        AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))
      )
    )
    AND (
      -- Telegram fields
      lower(v.telegram_username) LIKE v_query OR
      v.telegram_user_id::text LIKE v_query OR
      lower(v.telegram_first_name) LIKE v_query OR
      lower(v.telegram_last_name) LIKE v_query OR
      -- Profile fields
      lower(v.email) LIKE v_query OR
      v.phone LIKE v_query OR
      lower(v.full_name) LIKE v_query OR
      -- Orders (by profile_id) - search by order_number and customer fields
      EXISTS (
        SELECT 1 FROM orders_v2 o 
        WHERE o.profile_id = v.profile_id
          AND (
            lower(o.order_number) LIKE v_query OR
            lower(o.customer_email) LIKE v_query OR
            o.customer_phone LIKE v_query
          )
      ) OR
      -- Payments (by profile_id) - search by card_last4, provider_payment_id
      EXISTS (
        SELECT 1 FROM payments_v2 pmt
        WHERE pmt.profile_id = v.profile_id
          AND (
            pmt.card_last4 LIKE v_query OR 
            lower(pmt.provider_payment_id) LIKE v_query
          )
      ) OR
      -- Card links (by profile_id)
      EXISTS (
        SELECT 1 FROM card_profile_links cpl
        WHERE cpl.profile_id = v.profile_id AND cpl.card_last4 LIKE v_query
      )
    )
  ORDER BY v.access_status ASC, v.email ASC NULLS LAST
  LIMIT 500;
END;
$$;

GRANT EXECUTE ON FUNCTION search_club_members_enriched(UUID, TEXT, TEXT) TO authenticated;