-- PATCH 1: Fix telegram_logs RLS policy for service_role INSERT
-- This allows the subscription-renewal-reminders edge function to log events

-- Drop existing policy if exists
DROP POLICY IF EXISTS "Service role can insert telegram logs" ON telegram_logs;
DROP POLICY IF EXISTS "service_role_insert_telegram_logs" ON telegram_logs;

-- Create correct policy using auth.role() instead of auth.jwt()->'role'
CREATE POLICY "service_role_insert_telegram_logs"
ON telegram_logs
FOR INSERT
TO public
WITH CHECK (auth.role() = 'service_role');