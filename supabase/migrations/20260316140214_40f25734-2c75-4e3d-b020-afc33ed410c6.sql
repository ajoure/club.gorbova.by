-- FIX: Restore correct JOIN structure for get_club_member_summary
-- The previous migration (20260316134817) broke this by referencing v.last_telegram_check_result
-- which does not exist in v_club_members_enriched. Must JOIN telegram_club_members for that column.
-- Preserves PATCH-B: with_access excludes removed users.

CREATE OR REPLACE FUNCTION public.get_club_member_summary(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result jsonb;
  v_bot_admin_count int := 0;
  v_bot_tg_id bigint;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR (
    NOT public.has_role(v_user_id, 'admin'::app_role)
    AND NOT public.has_role(v_user_id, 'superadmin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Count bot admins not in members table
  SELECT tb.bot_id INTO v_bot_tg_id
  FROM telegram_clubs tc
  JOIN telegram_bots tb ON tb.id = tc.bot_id
  WHERE tc.id = p_club_id;

  IF v_bot_tg_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM telegram_club_members tcm
      WHERE tcm.club_id = p_club_id AND tcm.telegram_user_id = v_bot_tg_id
    ) THEN
      v_bot_admin_count := 1;
    END IF;
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
    -- PATCH-B: with_access excludes removed users
    'with_access_total', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND v.access_status != 'removed'),
    'with_access_admins', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND ac.is_admin AND v.access_status != 'removed'),
    'with_access_regular', COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin AND v.access_status != 'removed'),
    'bought_not_joined_count', COUNT(*) FILTER (
      WHERE COALESCE(v.has_active_access, false) 
        AND NOT v.in_any 
        AND NOT COALESCE(v.is_orphaned, false)
        AND v.access_status != 'removed'
    ),
    'violators_count', COUNT(*) FILTER (WHERE v.in_any AND NOT COALESCE(v.has_active_access, false) AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'removed_count', COUNT(*) FILTER (WHERE v.access_status = 'removed' AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'admins_total', COUNT(*) FILTER (WHERE ac.is_admin AND NOT COALESCE(v.is_orphaned, false)) + v_bot_admin_count,
    'outside_system_count', 
      CASE 
        WHEN tc.chat_id IS NOT NULL THEN 
          GREATEST(0, COALESCE(tc.members_count_chat, 0) - COUNT(*) FILTER (WHERE COALESCE(v.in_chat, false) AND NOT COALESCE(v.is_orphaned, false)))
        ELSE NULL
      END,
    'total_synced', COUNT(*) FILTER (WHERE NOT COALESCE(v.is_orphaned, false)),
    'orphaned', COUNT(*) FILTER (WHERE COALESCE(v.is_orphaned, false)),

    -- === PATCH-STAT-4: Additional fields ===
    'admins_in_club', COUNT(*) FILTER (WHERE ac.is_admin AND v.in_any AND NOT COALESCE(v.is_orphaned, false)),
    'admins_not_in_club', COUNT(*) FILTER (WHERE ac.is_admin AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false)),
    'bot_admins_not_in_members', v_bot_admin_count,
    'removed_non_admin', COUNT(*) FILTER (WHERE v.access_status = 'removed' AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false) AND NOT ac.is_admin),
    'removed_admin', COUNT(*) FILTER (WHERE v.access_status = 'removed' AND NOT v.in_any AND NOT COALESCE(v.is_orphaned, false) AND ac.is_admin),
    'not_joined_any', COUNT(*) FILTER (
      WHERE COALESCE(v.has_active_access, false) 
        AND NOT v.in_any 
        AND NOT COALESCE(v.is_orphaned, false)
        AND v.access_status != 'removed'
    ),
    -- Diagnostic metrics
    'in_chat_count', COUNT(*) FILTER (WHERE COALESCE(v.in_chat, false) AND NOT COALESCE(v.is_orphaned, false)),
    'in_channel_count', COUNT(*) FILTER (WHERE COALESCE(v.in_channel, false) AND NOT COALESCE(v.is_orphaned, false)),
    'in_both_count', COUNT(*) FILTER (WHERE COALESCE(v.in_chat, false) AND COALESCE(v.in_channel, false) AND NOT COALESCE(v.is_orphaned, false)),
    'chat_only_count', COUNT(*) FILTER (WHERE COALESCE(v.in_chat, false) AND NOT COALESCE(v.in_channel, false) AND NOT COALESCE(v.is_orphaned, false)),
    'channel_only_count', COUNT(*) FILTER (WHERE NOT COALESCE(v.in_chat, false) AND COALESCE(v.in_channel, false) AND NOT COALESCE(v.is_orphaned, false)),
    'not_joined_chat', CASE WHEN tc.chat_id IS NOT NULL THEN
      COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.in_chat, false) AND NOT COALESCE(v.is_orphaned, false) AND v.access_status != 'removed')
      ELSE NULL END,
    'not_joined_channel', CASE WHEN tc.channel_id IS NOT NULL THEN
      COUNT(*) FILTER (WHERE COALESCE(v.has_active_access, false) AND NOT COALESCE(v.in_channel, false) AND NOT COALESCE(v.is_orphaned, false) AND v.access_status != 'removed')
      ELSE NULL END
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
    AND NOT COALESCE(v.is_orphaned, false)
    AND (v.in_any OR v.access_status = 'removed' OR COALESCE(v.has_any_access_history, false))
  GROUP BY tc.channel_id, tc.chat_id, tc.members_count_chat;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;