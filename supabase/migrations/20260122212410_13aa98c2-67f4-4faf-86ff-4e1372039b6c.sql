
-- ==========================================
-- SECURITY FIX MIGRATION
-- Fixes: Cleanup RPC bypass, lesson_blocks public access, 
--        SECURITY DEFINER view, SMTP/Bot secrets exposure
-- ==========================================

-- ==========================================
-- 1. REVOKE EXECUTE on cleanup functions from PUBLIC
-- This prevents direct RPC calls, forcing use of Edge Functions with auth checks
-- ==========================================

REVOKE EXECUTE ON FUNCTION cleanup_demo_delete_all() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_demo_entitlements(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_demo_safeguard_check() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_demo_counts() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_telegram_orphans_delete(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_telegram_corruption_fix(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cleanup_telegram_expired_tokens(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_demo_profile_ids() FROM PUBLIC;

-- Keep only service_role access (for edge functions)
GRANT EXECUTE ON FUNCTION cleanup_demo_delete_all() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_demo_entitlements(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_demo_safeguard_check() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_demo_counts() TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_telegram_orphans_delete(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_telegram_corruption_fix(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_telegram_expired_tokens(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION get_demo_profile_ids() TO service_role;

-- ==========================================
-- 2. FIX lesson_blocks RLS - Remove public read, add subscription check
-- ==========================================

DROP POLICY IF EXISTS "Public read for lesson blocks" ON public.lesson_blocks;

-- Policy: Users can view lesson blocks only if they have an active subscription
-- or if they are admins
CREATE POLICY "Users can view blocks with valid subscription"
ON public.lesson_blocks
FOR SELECT
USING (
  -- Admin access
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid() 
    AND ur.role IN ('admin', 'superadmin')
  )
  OR
  has_permission(auth.uid(), 'content.manage')
  OR
  -- Valid subscription/entitlement check for the lesson's product
  EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN products_v2 p ON p.id = tm.product_id
    JOIN entitlements e ON e.product_code = p.code
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND e.user_id = auth.uid()
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )
  OR
  -- Also check subscriptions for access
  EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN subscriptions_v2 s ON s.product_id = tm.product_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND s.user_id = auth.uid()
      AND s.status IN ('active', 'trial')
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )
);

-- ==========================================
-- 3. FIX v_club_members_enriched SECURITY DEFINER view
-- Recreate as SECURITY INVOKER (default behavior)
-- ==========================================

DROP VIEW IF EXISTS public.v_club_members_enriched;

CREATE VIEW public.v_club_members_enriched AS
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

-- Grant access to authenticated users (RLS on underlying tables will apply)
GRANT SELECT ON public.v_club_members_enriched TO authenticated;

-- ==========================================
-- 4. CREATE SAFE VIEWS for sensitive tables (hide secrets)
-- ==========================================

-- 4a. email_accounts_safe - hide SMTP password
CREATE OR REPLACE VIEW public.email_accounts_safe AS
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

-- Grant same access as base table to the safe view
GRANT SELECT ON public.email_accounts_safe TO authenticated;

-- 4b. telegram_bots_safe - hide bot token
CREATE OR REPLACE VIEW public.telegram_bots_safe AS
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

-- Grant same access as base table to the safe view
GRANT SELECT ON public.telegram_bots_safe TO authenticated;

-- ==========================================
-- 5. AUDIT LOG for this security fix
-- ==========================================

INSERT INTO audit_logs (
  actor_type, 
  actor_label, 
  action, 
  meta
) VALUES (
  'system',
  'security-migration',
  'security.fixes_applied',
  jsonb_build_object(
    'fixes', ARRAY[
      'cleanup_functions_rpc_revoked',
      'lesson_blocks_rls_fixed',
      'v_club_members_enriched_security_invoker',
      'email_accounts_safe_view_created',
      'telegram_bots_safe_view_created'
    ],
    'applied_at', now()::text
  )
);
