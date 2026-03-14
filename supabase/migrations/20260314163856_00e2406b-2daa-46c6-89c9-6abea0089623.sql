-- PATCH-STAT-1: Fix entitlement cross-club leak + summary scope alignment

-- Fix 1: has_valid_access_for_club — scope entitlements by club via product_club_mappings
CREATE OR REPLACE FUNCTION public.has_valid_access_for_club(p_user_id uuid, p_club_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 1. Active subscription with product mapped to this club
  IF EXISTS (
    SELECT 1
    FROM subscriptions_v2 s
    JOIN product_club_mappings pcm ON pcm.product_id = s.product_id AND pcm.is_active = true
    WHERE s.user_id = p_user_id
      AND pcm.club_id = p_club_id
      AND s.status IN ('active', 'trial', 'past_due')
      AND (s.access_end_at IS NULL OR s.access_end_at > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 2. Active entitlement with product mapped to this club (PATCH-STAT-1: was unscoped)
  IF EXISTS (
    SELECT 1
    FROM entitlements e
    JOIN product_club_mappings pcm
      ON pcm.product_id = e.product_id
      AND pcm.is_active = true
      AND pcm.club_id = p_club_id
    WHERE e.user_id = p_user_id
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 3. Manual access
  IF EXISTS (
    SELECT 1
    FROM telegram_manual_access tma
    WHERE tma.user_id = p_user_id
      AND tma.club_id = p_club_id
      AND tma.is_active = true
      AND (tma.valid_until IS NULL OR tma.valid_until > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 4. telegram_access not revoked
  IF EXISTS (
    SELECT 1
    FROM telegram_access ta
    WHERE ta.user_id = p_user_id
      AND ta.club_id = p_club_id
      AND ta.state_chat != 'revoked'
      AND ta.state_channel != 'revoked'
      AND (ta.active_until IS NULL OR ta.active_until > NOW())
  ) THEN
    RETURN true;
  END IF;

  -- 5. Active grant
  IF EXISTS (
    SELECT 1
    FROM telegram_access_grants tag
    WHERE tag.user_id = p_user_id
      AND tag.club_id = p_club_id
      AND tag.status = 'active'
      AND (tag.end_at IS NULL OR tag.end_at > NOW())
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

-- Fix 3: get_club_member_summary — add relevant-scope filter to match list display scope
CREATE OR REPLACE FUNCTION public.get_club_member_summary(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'resource_mode', 
    CASE
      WHEN tc.channel_id IS NULL AND tc.chat_id IS NOT NULL THEN 'chat_only'
      WHEN tc.chat_id IS NULL AND tc.channel_id IS NOT NULL THEN 'channel_only'
      ELSE 'chat_and_channel'
    END,
    'in_club_total', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.is_orphaned, false)),
    'in_club_admins', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.is_orphaned, false) AND ac.is_admin),
    'in_club_regular', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'with_access_total', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false)),
    'with_access_admins', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND ac.is_admin),
    'with_access_regular', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'bought_not_joined_count', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false)),
    'violators_count', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'removed_count', COUNT(*) FILTER (WHERE v.access_status = 'removed' AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'outside_system_count', 
      CASE 
        WHEN tc.chat_id IS NOT NULL THEN 
          GREATEST(0, COALESCE(tc.members_count_chat, 0) - COUNT(*) FILTER (WHERE COALESCE(v.in_chat, false) AND NOT COALESCE(v.is_orphaned, false)))
        ELSE NULL
      END,
    'total_synced', COUNT(*) FILTER (WHERE NOT COALESCE(v.is_orphaned, false)),
    'orphaned', COUNT(*) FILTER (WHERE COALESCE(v.is_orphaned, false))
  ) INTO v_result
  FROM v_club_members_enriched v
  JOIN telegram_clubs tc ON tc.id = v.club_id
  LEFT JOIN telegram_club_members tcm2 ON tcm2.id = v.id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      tcm2.last_telegram_check_result->'chat'->>'status' IN ('administrator', 'creator')
      OR tcm2.last_telegram_check_result->'channel'->>'status' IN ('administrator', 'creator'),
      false
    ) AS is_admin
  ) ac
  WHERE v.club_id = p_club_id
    -- PATCH-STAT-1: relevant-scope filter to match list display scope
    AND NOT COALESCE(v.is_orphaned, false)
    AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))
  GROUP BY tc.channel_id, tc.chat_id, tc.members_count_chat;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;