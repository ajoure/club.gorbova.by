-- Ход A″: сузить SELECT на training_lessons — только staff или пользователь с активным entitlement на продукт урока.

DROP POLICY IF EXISTS "Authenticated users can view active lessons" ON public.training_lessons;

CREATE POLICY "Users can view lessons they are entitled to"
ON public.training_lessons
FOR SELECT
TO authenticated
USING (
  is_active = true
  AND (
    public.has_role_v2(auth.uid(), 'admin')
    OR public.has_role_v2(auth.uid(), 'super_admin')
    OR (
      product_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.entitlements e
        WHERE e.user_id = auth.uid()
          AND e.product_id = training_lessons.product_id
          AND e.status = 'active'
          AND (e.expires_at IS NULL OR e.expires_at > now())
      )
    )
  )
);