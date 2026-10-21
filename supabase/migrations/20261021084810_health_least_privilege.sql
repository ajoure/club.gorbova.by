-- HEALTH-RLS-2026-10-21: least privilege, zero customer/data changes.
-- Exact live68-policy baseline or exact post-apply74-policy fingerprint only.
-- A changed/missing/extra policy stops before REVOKE/ALTER; replay is safe.
DO $preflight$
DECLARE fingerprint text; column_grants integer; unexpected_grants integer;
BEGIN
  SELECT md5(jsonb_agg(jsonb_build_object(
    'schema',schemaname,'table',tablename,'policyname',policyname,'cmd',cmd,
    'permissive',permissive,'roles',roles,'qual',qual,'with_check',with_check
  ) ORDER BY schemaname COLLATE "C",tablename COLLATE "C",policyname COLLATE "C")::text)
  INTO fingerprint FROM pg_policies
  WHERE (schemaname='public' AND tablename IN ('flows','roles','fields','tariffs','permissions','products_v2','access_rules','kb_questions','admin_section','crm_pipelines','module_access','admin_resource','pricing_stages','tariff_features','role_permissions','lesson_price_rules','user_menu_sections','crm_pipeline_stages','site_domain_bindings','document_token_registry','privacy_policy_versions','legal_details_roles_catalog','crm_pipeline_product_bindings','legal_details_positions_catalog'))
    OR (schemaname='storage' AND tablename='objects' AND policyname='Staff can update telegram-media');
  -- Production uses public.order_status; its paid literal deparses as enum,
  -- not text. The historical managed receipt remains unchanged.
  IF fingerprint IS NULL OR fingerprint NOT IN ('f6b34c79c1c4e5f872b45244eecc947e','9533ab393040dfe65fdfbfcc30a79cc1')
  THEN RAISE EXCEPTION 'health_rls_policy_baseline_changed'; END IF;
  -- Existing canonical routing already grants anon these five columns.
  -- Table REVOKE does not remove column ACLs: validate them independently.
  SELECT count(*),count(*) FILTER (WHERE c.relname<>'site_domain_bindings'
    OR acl.grantee<>'anon'::regrole::oid OR acl.privilege_type<>'SELECT'
    OR a.attname NOT IN ('id','site_page_id','domain','is_home','is_primary') OR acl.is_grantable)
  INTO column_grants,unexpected_grants
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  CROSS JOIN LATERAL aclexplode(a.attacl) acl
  WHERE n.nspname='public' AND c.relname IN ('flows','roles','fields','tariffs','permissions','products_v2','access_rules','kb_questions','admin_section','crm_pipelines','module_access','admin_resource','pricing_stages','tariff_features','role_permissions','lesson_price_rules','user_menu_sections','crm_pipeline_stages','site_domain_bindings','document_token_registry','privacy_policy_versions','legal_details_roles_catalog','crm_pipeline_product_bindings','legal_details_positions_catalog')
    AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee IN (0,'anon'::regrole::oid,'authenticated'::regrole::oid);
  IF column_grants<>5 OR unexpected_grants<>0
  THEN RAISE EXCEPTION 'health_rls_column_acl_baseline_changed'; END IF;
END $preflight$;

REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.access_rules FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.access_rules FROM anon;
REVOKE SELECT ON public.access_rules FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.admin_resource FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_resource FROM anon;
REVOKE SELECT ON public.admin_resource FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.admin_section FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.admin_section FROM anon;
REVOKE SELECT ON public.admin_section FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.crm_pipeline_product_bindings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crm_pipeline_product_bindings FROM anon;
REVOKE SELECT ON public.crm_pipeline_product_bindings FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.crm_pipeline_stages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crm_pipeline_stages FROM anon;
REVOKE SELECT ON public.crm_pipeline_stages FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.crm_pipelines FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crm_pipelines FROM anon;
REVOKE SELECT ON public.crm_pipelines FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.document_token_registry FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.document_token_registry FROM anon;
REVOKE SELECT ON public.document_token_registry FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.fields FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.fields FROM anon;
REVOKE SELECT ON public.fields FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.flows FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.flows FROM anon;
REVOKE SELECT ON public.flows FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.kb_questions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.kb_questions FROM anon;
REVOKE SELECT ON public.kb_questions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.legal_details_positions_catalog FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.legal_details_positions_catalog FROM anon;
REVOKE SELECT ON public.legal_details_positions_catalog FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.legal_details_roles_catalog FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.legal_details_roles_catalog FROM anon;
REVOKE SELECT ON public.legal_details_roles_catalog FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.lesson_price_rules FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.lesson_price_rules FROM anon;
REVOKE SELECT ON public.lesson_price_rules FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.module_access FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.module_access FROM anon;
REVOKE SELECT ON public.module_access FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.permissions FROM anon;
REVOKE SELECT ON public.permissions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.pricing_stages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.pricing_stages FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.privacy_policy_versions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.privacy_policy_versions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.products_v2 FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.products_v2 FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.role_permissions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM anon;
REVOKE SELECT ON public.role_permissions FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.roles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.roles FROM anon;
REVOKE SELECT ON public.roles FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.site_domain_bindings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.site_domain_bindings FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.tariff_features FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tariff_features FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.tariffs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tariffs FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.user_menu_sections FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_menu_sections FROM anon;
REVOKE SELECT ON public.user_menu_sections FROM anon;

-- Legacy ALL policies must never evaluate privileged helpers for anon.
ALTER POLICY "doc_token_registry_admin_all" ON public.document_token_registry TO authenticated;
ALTER POLICY "Fields are editable by admins" ON public.fields TO authenticated;
ALTER POLICY "Flows editable by admins" ON public.flows TO authenticated;
ALTER POLICY "Admins can manage module access" ON public.module_access TO authenticated;
ALTER POLICY "Pricing stages editable by admins" ON public.pricing_stages TO authenticated;
ALTER POLICY "Products editable by admins" ON public.products_v2 TO authenticated;
ALTER POLICY "Admins can manage tariff features" ON public.tariff_features TO authenticated;
ALTER POLICY "Tariffs editable by admins" ON public.tariffs TO authenticated;

-- Explicit row predicates preserve public catalogs, learner mappings and role bootstrap.
ALTER POLICY "Authenticated users can read access_rules" ON public.access_rules TO authenticated
  USING (((public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'products', 'view')) OR (is_active AND (EXISTS (SELECT 1 FROM public.products_v2 p WHERE p.id = access_rules.product_id) OR EXISTS (SELECT 1 FROM public.tariffs t WHERE t.id = access_rules.tariff_id)))));
ALTER POLICY "admin_resource read for authenticated" ON public.admin_resource TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'roles', 'view') OR EXISTS (SELECT 1 FROM public.admin_section s WHERE s.id = admin_resource.section_id AND public.has_admin_resource_access((SELECT auth.uid()), s.code, admin_resource.code, 'view'))));
ALTER POLICY "admin_section read for authenticated" ON public.admin_section TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'roles', 'view') OR public.has_admin_section_access((SELECT auth.uid()), code, 'view')));
ALTER POLICY "crm_pipeline_product_bindings_select" ON public.crm_pipeline_product_bindings TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'sites', 'view')));
ALTER POLICY "crm_pipeline_stages_select" ON public.crm_pipeline_stages TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'sites', 'view')));
ALTER POLICY "crm_pipelines_select" ON public.crm_pipelines TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'sites', 'view')));
ALTER POLICY "doc_token_registry_authenticated_read" ON public.document_token_registry TO authenticated
  USING ((archived_at IS NULL OR public.has_admin_section_access((SELECT auth.uid()), 'documents', 'view')));
ALTER POLICY "Fields are viewable by authenticated users" ON public.fields TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'contacts', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'integrations', 'view')));
ALTER POLICY "Flows viewable by authenticated users" ON public.flows TO authenticated
  USING (((public.has_admin_section_access((SELECT auth.uid()), 'products', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'payments', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view')) OR EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id = (SELECT auth.uid()) AND s.flow_id = flows.id) OR EXISTS (SELECT 1 FROM public.orders_v2 o WHERE o.user_id = (SELECT auth.uid()) AND o.product_id = flows.product_id AND o.status = 'paid')));
ALTER POLICY "kb_questions_select_authenticated" ON public.kb_questions TO authenticated
  USING (((public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'products', 'view')) OR public.user_has_training_lesson_access((SELECT auth.uid()), lesson_id)));
ALTER POLICY "positions_catalog_read" ON public.legal_details_positions_catalog TO authenticated
  USING ((is_active OR public.has_admin_section_access((SELECT auth.uid()), 'documents', 'view')));
ALTER POLICY "roles_catalog_read" ON public.legal_details_roles_catalog TO authenticated
  USING ((is_active OR public.has_admin_section_access((SELECT auth.uid()), 'documents', 'view')));
ALTER POLICY "Users can view lesson price rules" ON public.lesson_price_rules TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'products', 'view')));
ALTER POLICY "Authenticated users can read module_access" ON public.module_access TO authenticated
  USING (((public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'products', 'view')) OR EXISTS (SELECT 1 FROM public.tariffs t WHERE t.id = module_access.tariff_id)));
ALTER POLICY "Authenticated can view permissions" ON public.permissions TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'roles', 'view') OR EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.user_roles_v2 ur ON ur.role_id = rp.role_id WHERE ur.user_id = (SELECT auth.uid()) AND rp.permission_id = permissions.id)));
ALTER POLICY "Pricing stages are viewable by everyone" ON public.pricing_stages TO anon
  USING ((is_active AND EXISTS (SELECT 1 FROM public.products_v2 p WHERE p.id = pricing_stages.product_id AND p.is_active AND p.status = 'active')));
ALTER POLICY "Anyone can read policy versions" ON public.privacy_policy_versions TO anon
  USING ((is_current OR effective_date <= CURRENT_DATE));
ALTER POLICY "Products are viewable by everyone" ON public.products_v2 TO anon
  USING ((is_active AND status = 'active'));
ALTER POLICY "Authenticated can view role_permissions" ON public.role_permissions TO authenticated
  USING ((public.has_admin_section_access((SELECT auth.uid()), 'roles', 'view') OR EXISTS (SELECT 1 FROM public.user_roles_v2 ur WHERE ur.user_id = (SELECT auth.uid()) AND ur.role_id = role_permissions.role_id)));
ALTER POLICY "Authenticated can view roles" ON public.roles TO authenticated
  USING (((public.has_admin_section_access((SELECT auth.uid()), 'roles', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'communication', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'support', 'view')) OR EXISTS (SELECT 1 FROM public.user_roles_v2 ur WHERE ur.user_id = (SELECT auth.uid()) AND ur.role_id = roles.id)));
ALTER POLICY "site_domain_bindings_public_select" ON public.site_domain_bindings TO anon
  USING (EXISTS (SELECT 1 FROM public.site_pages p WHERE p.id = site_domain_bindings.site_page_id AND p.status = 'published'));
ALTER POLICY "Public can read tariff features" ON public.tariff_features TO anon
  USING (EXISTS (SELECT 1 FROM public.tariffs t WHERE t.id = tariff_features.tariff_id));
ALTER POLICY "Tariffs are viewable by everyone" ON public.tariffs TO anon
  USING ((is_active AND is_public AND (visible_from IS NULL OR visible_from <= now()) AND (visible_to IS NULL OR visible_to > now()) AND EXISTS (SELECT 1 FROM public.products_v2 p WHERE p.id = tariffs.product_id AND p.is_active AND p.status = 'active')));
ALTER POLICY "Authenticated users can view menu sections" ON public.user_menu_sections TO authenticated
  USING ((is_active OR (public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'products', 'view'))));
DROP POLICY IF EXISTS health_catalog_authenticated_select ON public.products_v2;
CREATE POLICY health_catalog_authenticated_select ON public.products_v2 FOR SELECT TO authenticated
  USING ((is_active AND status = 'active') OR (((public.has_admin_section_access((SELECT auth.uid()), 'products', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'payments', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view')) OR EXISTS (SELECT 1 FROM public.orders_v2 o WHERE o.user_id = (SELECT auth.uid()) AND o.product_id = products_v2.id AND o.status = 'paid') OR EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id = (SELECT auth.uid()) AND s.product_id = products_v2.id) OR EXISTS (SELECT 1 FROM public.entitlements e WHERE e.user_id = (SELECT auth.uid()) AND e.product_id = products_v2.id))));
DROP POLICY IF EXISTS health_catalog_authenticated_select ON public.pricing_stages;
CREATE POLICY health_catalog_authenticated_select ON public.pricing_stages FOR SELECT TO authenticated
  USING ((is_active AND EXISTS (SELECT 1 FROM public.products_v2 p WHERE p.id = pricing_stages.product_id AND p.is_active AND p.status = 'active')) OR ((public.has_admin_section_access((SELECT auth.uid()), 'products', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'payments', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'))));
DROP POLICY IF EXISTS health_catalog_authenticated_select ON public.privacy_policy_versions;
CREATE POLICY health_catalog_authenticated_select ON public.privacy_policy_versions FOR SELECT TO authenticated
  USING ((is_current OR effective_date <= CURRENT_DATE) OR (public.has_admin_section_access((SELECT auth.uid()), 'consents', 'view')));
DROP POLICY IF EXISTS health_catalog_authenticated_select ON public.tariffs;
CREATE POLICY health_catalog_authenticated_select ON public.tariffs FOR SELECT TO authenticated
  USING ((is_active AND is_public AND (visible_from IS NULL OR visible_from <= now()) AND (visible_to IS NULL OR visible_to > now()) AND EXISTS (SELECT 1 FROM public.products_v2 p WHERE p.id = tariffs.product_id AND p.is_active AND p.status = 'active')) OR (((public.has_admin_section_access((SELECT auth.uid()), 'products', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'payments', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view')) OR EXISTS (SELECT 1 FROM public.orders_v2 o WHERE o.user_id = (SELECT auth.uid()) AND o.tariff_id = tariffs.id AND o.status = 'paid') OR EXISTS (SELECT 1 FROM public.subscriptions_v2 s WHERE s.user_id = (SELECT auth.uid()) AND s.tariff_id = tariffs.id) OR EXISTS (SELECT 1 FROM public.entitlements e WHERE e.user_id = (SELECT auth.uid()) AND e.product_id = tariffs.product_id))));
DROP POLICY IF EXISTS health_catalog_authenticated_select ON public.tariff_features;
CREATE POLICY health_catalog_authenticated_select ON public.tariff_features FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tariffs t WHERE t.id = tariff_features.tariff_id) OR ((public.has_admin_section_access((SELECT auth.uid()), 'products', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'training', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'deals', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'payments', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'forms-hub', 'view') OR public.has_admin_section_access((SELECT auth.uid()), 'referrals', 'view'))));
DROP POLICY IF EXISTS health_catalog_authenticated_select ON public.site_domain_bindings;
CREATE POLICY health_catalog_authenticated_select ON public.site_domain_bindings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.site_pages p WHERE p.id = site_domain_bindings.site_page_id AND p.status = 'published') OR (public.has_admin_section_access((SELECT auth.uid()), 'sites', 'view')));

-- Published domain routing exposes only routing columns to unauthenticated browsers.
REVOKE SELECT ON public.site_domain_bindings FROM anon;
GRANT SELECT (id, site_page_id, domain, is_home, is_primary) ON public.site_domain_bindings TO anon;

-- Shared staff media remains shared; destination UPDATE has the same staff guard.
ALTER POLICY "Staff can update telegram-media" ON storage.objects
  WITH CHECK (((bucket_id = 'telegram-media'::text) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'superadmin'::app_role) OR has_role_v2(auth.uid(), 'super_admin'::text) OR has_role_v2(auth.uid(), 'admin'::text) OR has_role_v2(auth.uid(), 'menedzher'::text) OR has_role_v2(auth.uid(), 'support'::text) OR has_role_v2(auth.uid(), 'editor'::text) OR has_role_v2(auth.uid(), 'admin_gost'::text) OR has_admin_section_access(auth.uid(), 'communication'::text, 'manage'::text))));
