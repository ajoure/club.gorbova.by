
-- ==========================================
-- FIX: Set views to SECURITY INVOKER explicitly
-- This ensures RLS from underlying tables applies to view queries
-- ==========================================

-- Recreate email_accounts_safe with explicit SECURITY INVOKER
DROP VIEW IF EXISTS public.email_accounts_safe;
CREATE VIEW public.email_accounts_safe 
WITH (security_invoker = true)
AS
SELECT 
  id,
  email,
  display_name,
  provider,
  smtp_host,
  smtp_port,
  smtp_encryption,
  smtp_username,
  (smtp_password IS NOT NULL) AS has_password,
  from_name,
  from_email,
  reply_to,
  is_default,
  is_active,
  use_for,
  created_at,
  updated_at,
  imap_host,
  imap_port,
  imap_encryption,
  imap_enabled,
  last_fetched_at,
  last_fetched_uid
FROM public.email_accounts;

GRANT SELECT ON public.email_accounts_safe TO authenticated;

-- Recreate telegram_bots_safe with explicit SECURITY INVOKER
DROP VIEW IF EXISTS public.telegram_bots_safe;
CREATE VIEW public.telegram_bots_safe 
WITH (security_invoker = true)
AS
SELECT 
  id,
  bot_name,
  bot_username,
  bot_id,
  (bot_token_encrypted IS NOT NULL) AS has_token,
  status,
  last_check_at,
  error_message,
  is_primary,
  created_at,
  updated_at
FROM public.telegram_bots;

GRANT SELECT ON public.telegram_bots_safe TO authenticated;

-- Recreate v_club_members_enriched with explicit SECURITY INVOKER
DROP VIEW IF EXISTS public.v_club_members_enriched;
CREATE VIEW public.v_club_members_enriched 
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
  p.external_id_amo,
  CASE
    WHEN p.user_id IS NULL THEN false
    ELSE (
      EXISTS (
        SELECT 1 FROM telegram_access ta
        WHERE ta.user_id = p.user_id 
          AND ta.club_id = tcm.club_id 
          AND (ta.state_chat = 'active' OR ta.state_channel = 'active')
      ) 
      OR EXISTS (
        SELECT 1 FROM telegram_manual_access tma
        WHERE tma.user_id = p.user_id 
          AND tma.club_id = tcm.club_id 
          AND tma.is_active = true 
          AND (tma.valid_until IS NULL OR tma.valid_until > now())
      ) 
      OR EXISTS (
        SELECT 1 FROM telegram_access_grants tag
        WHERE tag.user_id = p.user_id 
          AND tag.club_id = tcm.club_id 
          AND tag.status = 'active' 
          AND (tag.end_at IS NULL OR tag.end_at > now())
      )
    )
  END AS has_active_access,
  CASE
    WHEN p.user_id IS NULL THEN false
    ELSE (
      EXISTS (SELECT 1 FROM telegram_access ta WHERE ta.user_id = p.user_id AND ta.club_id = tcm.club_id)
      OR EXISTS (SELECT 1 FROM telegram_manual_access tma WHERE tma.user_id = p.user_id AND tma.club_id = tcm.club_id)
      OR EXISTS (SELECT 1 FROM telegram_access_grants tag WHERE tag.user_id = p.user_id AND tag.club_id = tcm.club_id)
    )
  END AS has_any_access_history,
  (COALESCE(tcm.in_chat, false) OR COALESCE(tcm.in_channel, false)) AS in_any,
  (tcm.telegram_user_id IS NULL OR tcm.telegram_user_id < 100) AS is_orphaned
FROM telegram_club_members tcm
LEFT JOIN profiles p ON p.id = tcm.profile_id;

GRANT SELECT ON public.v_club_members_enriched TO authenticated;
