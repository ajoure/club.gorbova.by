-- ==========================================================
-- SECURITY HARDENING BATCH (2026-04-21)
-- ==========================================================

-- 1) PRIVILEGE_ESCALATION: access_rules — restrict ALL to admins
DROP POLICY IF EXISTS "Authenticated users can manage access_rules" ON public.access_rules;

CREATE POLICY "Admins can insert access_rules"
  ON public.access_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Admins can update access_rules"
  ON public.access_rules
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Admins can delete access_rules"
  ON public.access_rules
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

-- 2) PUBLIC_WRITE_ACCESS: product_reentry_pricing — restrict to service_role + admin
DROP POLICY IF EXISTS "Service role full access" ON public.product_reentry_pricing;

CREATE POLICY "Service role manages reentry pricing"
  ON public.product_reentry_pricing
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can read reentry pricing"
  ON public.product_reentry_pricing
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Users can read own reentry pricing"
  ON public.product_reentry_pricing
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- 3) PUBLIC_DATA_EXPOSURE: bepaid_sync_logs — drop authenticated write policies
DROP POLICY IF EXISTS "System can insert sync logs" ON public.bepaid_sync_logs;
DROP POLICY IF EXISTS "System can update sync logs" ON public.bepaid_sync_logs;

CREATE POLICY "Service role inserts sync logs"
  ON public.bepaid_sync_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role updates sync logs"
  ON public.bepaid_sync_logs
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4) EXPOSED_SENSITIVE_DATA: ilex_settings — restrict session_cookie to super_admin only
DROP POLICY IF EXISTS "Staff can read ilex settings" ON public.ilex_settings;
DROP POLICY IF EXISTS "Staff can update ilex settings" ON public.ilex_settings;

CREATE POLICY "Super admins can read ilex settings"
  ON public.ilex_settings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can update ilex settings"
  ON public.ilex_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::app_role) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::app_role) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can insert ilex settings"
  ON public.ilex_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::app_role) OR public.is_super_admin(auth.uid()));

-- 5) MISSING_STORAGE_OWNERSHIP_CHECK: training-assets — require user folder ownership
DROP POLICY IF EXISTS "Authenticated users can upload training assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update training assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete training assets" ON storage.objects;

CREATE POLICY "Users can upload to own training-assets folder"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'training-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can update own training-assets files"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'training-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'training-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own training-assets files"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'training-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 6) SUPA_security_definer_view: live_event_active_participants_v -> security_invoker
ALTER VIEW public.live_event_active_participants_v SET (security_invoker = true);
