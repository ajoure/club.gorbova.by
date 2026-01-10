-- Fix overly permissive insert policies on log tables
-- These should only allow service role (Edge Functions) to insert, not any authenticated user

-- 1. Fix audit_logs - drop permissive policy and add proper one
DROP POLICY IF EXISTS "Insert audit logs" ON public.audit_logs;
CREATE POLICY "Service role can insert audit logs"
  ON public.audit_logs
  FOR INSERT
  WITH CHECK (
    -- Allow service role (used by Edge Functions)
    (auth.jwt()->>'role' = 'service_role')
    OR
    -- Allow admins with audit permission to insert their own logs
    (actor_user_id = auth.uid() AND has_permission(auth.uid(), 'audit.view'))
  );

-- 2. Fix telegram_logs - ensure only service role can insert
DROP POLICY IF EXISTS "System can insert telegram logs" ON public.telegram_logs;
CREATE POLICY "Service role can insert telegram logs"
  ON public.telegram_logs
  FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- 3. Fix tg_chat_messages - ensure only service role can insert
DROP POLICY IF EXISTS "System can insert chat messages" ON public.tg_chat_messages;
CREATE POLICY "Service role can insert chat messages"
  ON public.tg_chat_messages
  FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');