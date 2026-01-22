-- Fix: Change VIEW to use SECURITY INVOKER (default behavior)
-- Drop and recreate the view without SECURITY DEFINER
DROP VIEW IF EXISTS v_club_members_enriched;

CREATE VIEW v_club_members_enriched 
WITH (security_invoker = true)
AS
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
  p.user_id AS auth_user_id,
  p.email,
  p.full_name,
  p.phone,
  
  -- (A) has_active_access
  (
    EXISTS (SELECT 1 FROM telegram_access ta 
            WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id
              AND (ta.active_until IS NULL OR ta.active_until > NOW()))
    OR EXISTS (SELECT 1 FROM telegram_access_grants tag 
               WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id
                 AND tag.status = 'active' 
                 AND (tag.end_at IS NULL OR tag.end_at > NOW()))
    OR EXISTS (SELECT 1 FROM telegram_manual_access tma 
               WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id
                 AND tma.is_active = true 
                 AND (tma.valid_until IS NULL OR tma.valid_until > NOW()))
  ) AS has_active_access,
  
  -- (B) has_any_access_history
  (
    EXISTS (SELECT 1 FROM telegram_access ta WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id)
    OR EXISTS (SELECT 1 FROM telegram_access_grants tag WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id)
    OR EXISTS (SELECT 1 FROM telegram_manual_access tma WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id)
  ) AS has_any_access_history,
  
  -- (C) in_any
  (COALESCE(tcm.in_chat, false) = true OR COALESCE(tcm.in_channel, false) = true) AS in_any,
  
  -- (G) is_orphaned
  (tcm.profile_id IS NULL OR p.id IS NULL) AS is_orphaned

FROM telegram_club_members tcm
LEFT JOIN profiles p ON p.id = tcm.profile_id;