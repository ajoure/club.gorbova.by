
-- PATCH 9.1: Fix owner model RLS + add updated_at trigger
-- Mapping: old policies (profile_id = auth.uid()) -> new policies (profile_id IN profiles WHERE user_id = auth.uid())

-- ============================================
-- 1. DROP old broken RLS policies
-- ============================================

DROP POLICY IF EXISTS "Owner can select own packages" ON public.document_package_templates;
DROP POLICY IF EXISTS "Owner can insert own packages" ON public.document_package_templates;
DROP POLICY IF EXISTS "Owner can update own packages" ON public.document_package_templates;
DROP POLICY IF EXISTS "Owner can delete own packages" ON public.document_package_templates;

DROP POLICY IF EXISTS "Owner can select own package items" ON public.document_package_template_items;
DROP POLICY IF EXISTS "Owner can insert own package items" ON public.document_package_template_items;
DROP POLICY IF EXISTS "Owner can update own package items" ON public.document_package_template_items;
DROP POLICY IF EXISTS "Owner can delete own package items" ON public.document_package_template_items;

-- ============================================
-- 2. RECREATE RLS for document_package_templates (correct owner model)
-- ============================================

CREATE POLICY "Owner can select own packages"
ON public.document_package_templates FOR SELECT TO authenticated
USING (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Owner can insert own packages"
ON public.document_package_templates FOR INSERT TO authenticated
WITH CHECK (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Owner can update own packages"
ON public.document_package_templates FOR UPDATE TO authenticated
USING (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
)
WITH CHECK (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Owner can delete own packages"
ON public.document_package_templates FOR DELETE TO authenticated
USING (
  profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

-- ============================================
-- 3. RECREATE RLS for document_package_template_items (via join to owner package)
-- ============================================

CREATE POLICY "Owner can select own package items"
ON public.document_package_template_items FOR SELECT TO authenticated
USING (
  package_template_id IN (
    SELECT id FROM public.document_package_templates
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Owner can insert own package items"
ON public.document_package_template_items FOR INSERT TO authenticated
WITH CHECK (
  package_template_id IN (
    SELECT id FROM public.document_package_templates
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Owner can update own package items"
ON public.document_package_template_items FOR UPDATE TO authenticated
USING (
  package_template_id IN (
    SELECT id FROM public.document_package_templates
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
)
WITH CHECK (
  package_template_id IN (
    SELECT id FROM public.document_package_templates
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Owner can delete own package items"
ON public.document_package_template_items FOR DELETE TO authenticated
USING (
  package_template_id IN (
    SELECT id FROM public.document_package_templates
    WHERE profile_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  )
  OR public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

-- ============================================
-- 4. Add updated_at trigger for document_package_templates
-- ============================================

CREATE OR REPLACE FUNCTION public.update_document_package_templates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_document_package_templates_updated_at ON public.document_package_templates;

CREATE TRIGGER trg_update_document_package_templates_updated_at
  BEFORE UPDATE ON public.document_package_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_document_package_templates_updated_at();
