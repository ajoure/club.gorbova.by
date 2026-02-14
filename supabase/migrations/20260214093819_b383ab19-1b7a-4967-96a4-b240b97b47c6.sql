
-- PATCH: Unify RLS role checks to user_roles_v2 + roles
-- Root cause: UI uses user_roles_v2, but RLS checks legacy user_roles -> admins blocked

-- 1) Create role-check function via user_roles_v2 (source of truth)
CREATE OR REPLACE FUNCTION public.has_role_v2(_user_id uuid, _role_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles_v2 ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND r.code = _role_code
  );
$$;

-- 2) training_modules: replace admin policy
DROP POLICY IF EXISTS "Admins can manage modules" ON public.training_modules;

CREATE POLICY "Admins can manage modules"
ON public.training_modules
AS PERMISSIVE
FOR ALL
TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
)
WITH CHECK (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

-- 3) training_lessons: replace admin policy
DROP POLICY IF EXISTS "Admins can manage lessons" ON public.training_lessons;

CREATE POLICY "Admins can manage lessons"
ON public.training_lessons
AS PERMISSIVE
FOR ALL
TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
)
WITH CHECK (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

-- 4) lesson_blocks: replace all admin policies
DROP POLICY IF EXISTS "Admin insert lesson blocks" ON public.lesson_blocks;
DROP POLICY IF EXISTS "Admin update lesson blocks" ON public.lesson_blocks;
DROP POLICY IF EXISTS "Admin delete lesson blocks" ON public.lesson_blocks;
DROP POLICY IF EXISTS "Users can view lesson blocks with access" ON public.lesson_blocks;

CREATE POLICY "Admin insert lesson blocks"
ON public.lesson_blocks
AS PERMISSIVE
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Admin update lesson blocks"
ON public.lesson_blocks
AS PERMISSIVE
FOR UPDATE
TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
)
WITH CHECK (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

CREATE POLICY "Admin delete lesson blocks"
ON public.lesson_blocks
AS PERMISSIVE
FOR DELETE
TO authenticated
USING (
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
);

-- SELECT policy: preserve full access logic, only replace admin check part
CREATE POLICY "Users can view lesson blocks with access"
ON public.lesson_blocks
AS PERMISSIVE
FOR SELECT
TO authenticated
USING (
  -- Admin override (now via user_roles_v2)
  public.has_role_v2(auth.uid(), 'admin')
  OR public.has_role_v2(auth.uid(), 'super_admin')
  -- Permission-based access
  OR has_permission(auth.uid(), 'content.manage'::text)
  -- Access via product subscription
  OR (EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN subscriptions_v2 s ON s.product_id = tm.product_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND s.user_id = auth.uid()
      AND s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  ))
  -- Access via entitlements
  OR (EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN products_v2 p ON p.id = tm.product_id
    JOIN entitlements e ON e.product_code = p.code
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND e.user_id = auth.uid()
      AND e.status = 'active'::text
      AND (e.expires_at IS NULL OR e.expires_at > now())
  ))
  -- Access via module_access (tariff-based)
  OR (EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN module_access ma ON ma.module_id = tl.module_id
    JOIN subscriptions_v2 s ON s.tariff_id = ma.tariff_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND s.user_id = auth.uid()
      AND s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  ))
);
