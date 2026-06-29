
DROP TABLE IF EXISTS public._html_staging_site018_hero_v2;

DROP POLICY IF EXISTS "Authenticated users can read access_rules" ON public.access_rules;
CREATE POLICY "Admins can read access_rules"
ON public.access_rules
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role));

REVOKE SELECT ON public.site_domain_bindings FROM anon;
GRANT SELECT (id, site_page_id, domain, is_home, is_primary) ON public.site_domain_bindings TO anon;

DROP POLICY IF EXISTS "Authenticated users can view active lessons" ON public.training_lessons;
CREATE POLICY "Users can view training lessons with access"
ON public.training_lessons
FOR SELECT
TO authenticated
USING (
  has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin')
  OR has_permission(auth.uid(), 'content.manage')
  OR EXISTS (
    SELECT 1 FROM public.training_modules tm
    JOIN public.subscriptions_v2 s ON s.product_id = tm.product_id
    WHERE tm.id = training_lessons.module_id
      AND tm.is_active = true
      AND training_lessons.is_active = true
      AND s.user_id = auth.uid()
      AND s.status IN ('active'::subscription_status,'trial'::subscription_status)
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )
  OR EXISTS (
    SELECT 1 FROM public.training_modules tm
    JOIN public.products_v2 p ON p.id = tm.product_id
    JOIN public.entitlements e ON e.product_code = p.code
    WHERE tm.id = training_lessons.module_id
      AND tm.is_active = true
      AND training_lessons.is_active = true
      AND e.user_id = auth.uid()
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )
  OR EXISTS (
    SELECT 1 FROM public.module_access ma
    JOIN public.subscriptions_v2 s ON s.tariff_id = ma.tariff_id
    WHERE ma.module_id = training_lessons.module_id
      AND training_lessons.is_active = true
      AND s.user_id = auth.uid()
      AND s.status IN ('active'::subscription_status,'trial'::subscription_status)
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )
);

ALTER VIEW public.v_club_members_enriched SET (security_invoker = true);

ALTER FUNCTION public.generate_admin_catalog_public_id(text) SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.delete_session_field_value(uuid, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dpsfv_assert_package_match() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_club_members_enriched(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_admin_section_access(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.package_items_unbind_on_template_soft_delete() FROM anon;
REVOKE EXECUTE ON FUNCTION public.save_session_document_atomic(uuid, uuid, jsonb, jsonb, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_club_members_enriched(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.tariff_offers_force_disable_mandatory_internal_mit() FROM anon;
