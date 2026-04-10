-- PATCH 10.1: Fix CTA RLS policies — admin-only write, staff read

-- ===== live_event_product_cta_bindings =====

-- Drop the overly-permissive "Staff can manage" policy
DROP POLICY IF EXISTS "Staff can manage CTA bindings" ON public.live_event_product_cta_bindings;

-- Staff (admin + super_admin + employee) can SELECT all bindings
CREATE POLICY "Staff can read all CTA bindings"
  ON public.live_event_product_cta_bindings
  FOR SELECT
  TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
    OR has_role_v2(auth.uid(), 'employee')
  );

-- Only admin/super_admin can INSERT
CREATE POLICY "Admins can create CTA bindings"
  ON public.live_event_product_cta_bindings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
  );

-- Only admin/super_admin can UPDATE
CREATE POLICY "Admins can update CTA bindings"
  ON public.live_event_product_cta_bindings
  FOR UPDATE
  TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
  );

-- Only admin/super_admin can DELETE
CREATE POLICY "Admins can delete CTA bindings"
  ON public.live_event_product_cta_bindings
  FOR DELETE
  TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
  );


-- ===== live_event_cta_runtime_events =====

-- Drop the overly-permissive "Staff can manage" policy
DROP POLICY IF EXISTS "Staff can manage CTA runtime events" ON public.live_event_cta_runtime_events;

-- Staff can SELECT all runtime events
CREATE POLICY "Staff can read all CTA runtime events"
  ON public.live_event_cta_runtime_events
  FOR SELECT
  TO authenticated
  USING (
    has_role_v2(auth.uid(), 'admin')
    OR has_role_v2(auth.uid(), 'super_admin')
    OR has_role_v2(auth.uid(), 'employee')
  );

-- Admin-only INSERT for show/hide/replace actions
CREATE POLICY "Admins can show hide replace CTA"
  ON public.live_event_cta_runtime_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      has_role_v2(auth.uid(), 'admin')
      OR has_role_v2(auth.uid(), 'super_admin')
    )
    AND event_type IN ('shown', 'hidden', 'replaced')
  );

-- Any authenticated user with event access can record clicks and form submissions
CREATE POLICY "Users can record CTA clicks and submissions"
  ON public.live_event_cta_runtime_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    event_type IN ('clicked', 'form_submitted')
    AND user_has_live_event_access(auth.uid(), live_event_id)
  );