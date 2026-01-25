-- Fix RLS: Replace public-scoped policy with service_role-scoped policy
-- This allows Edge Functions using service_role key to insert telegram_logs

DROP POLICY IF EXISTS "service_role_insert_telegram_logs" ON public.telegram_logs;

CREATE POLICY "service_role_full_access_telegram_logs"
ON public.telegram_logs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);