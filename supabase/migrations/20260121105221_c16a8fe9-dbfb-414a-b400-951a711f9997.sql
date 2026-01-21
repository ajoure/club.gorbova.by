-- Fix: Replace overly permissive UPDATE policy with admin-only
DROP POLICY IF EXISTS "System update payments_sync_runs" ON payments_sync_runs;

-- Service role (used by edge functions) bypasses RLS, so we need admin-only for regular users
CREATE POLICY "Admin update payments_sync_runs"
  ON payments_sync_runs FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));