
-- Issue 2: temporary compatibility fix for __default__ sentinel
DROP POLICY IF EXISTS "Authenticated users can manage folders" ON public.site_page_folders;
CREATE POLICY "Admins manage workspace folders"
  ON public.site_page_folders FOR ALL TO authenticated
  USING (workspace_id = '__default__' AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')))
  WITH CHECK (workspace_id = '__default__' AND (public.has_role_v2(auth.uid(), 'admin') OR public.has_role_v2(auth.uid(), 'super_admin')));

-- Issue 4a: view hardening
ALTER VIEW public.v_club_members_enriched SET (security_invoker = true);
