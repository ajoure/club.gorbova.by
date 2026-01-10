-- Restrict knowledge base data to admins only (development mode)
-- This removes public read access to modules/lessons/access mappings.

-- training_modules: remove public read policy
DROP POLICY IF EXISTS "Anyone can view active modules" ON public.training_modules;

-- training_lessons: remove subscription-based public read policy
DROP POLICY IF EXISTS "Users can view lessons with valid subscription" ON public.training_lessons;

-- module_access: remove public read policy
DROP POLICY IF EXISTS "Anyone can view module access" ON public.module_access;

-- Ensure role-based admins can manage module_access as well (in addition to existing permission-based policy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'module_access'
      AND policyname = 'Admins can manage module access (role)'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Admins can manage module access (role)"
      ON public.module_access
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.user_roles ur
          WHERE ur.user_id = auth.uid()
            AND ur.role = ANY (ARRAY['admin'::public.app_role, 'superadmin'::public.app_role])
        )
      );
    $policy$;
  END IF;
END
$$;