-- PATCH-CROSS-PRODUCT-LESSON-BLOCKS-RLS
-- Users with an active entitlement that is mapped by access_rules.training_content
-- must be able to read lesson_blocks for explicitly granted modules/lessons,
-- even when the lesson module belongs to another product.

DROP POLICY IF EXISTS "Users can view lesson blocks with access" ON public.lesson_blocks;

CREATE POLICY "Users can view lesson blocks with access"
ON public.lesson_blocks
FOR SELECT
TO authenticated
USING (
  has_role_v2(auth.uid(), 'admin'::text)
  OR has_role_v2(auth.uid(), 'super_admin'::text)
  OR has_permission(auth.uid(), 'content.manage'::text)

  -- Existing direct product subscription path.
  OR EXISTS (
    SELECT 1
    FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id
    JOIN public.subscriptions_v2 s ON s.product_id = tm.product_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND s.user_id = auth.uid()
      AND s.status = ANY (ARRAY['active'::public.subscription_status, 'trial'::public.subscription_status])
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )

  -- Existing product-code entitlement path.
  OR EXISTS (
    SELECT 1
    FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id
    JOIN public.products_v2 p ON p.id = tm.product_id
    JOIN public.entitlements e ON e.product_code = p.code
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND e.user_id = auth.uid()
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )

  -- Existing module-tariff subscription path.
  OR EXISTS (
    SELECT 1
    FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id
    JOIN public.module_access ma ON ma.module_id = tl.module_id
    JOIN public.subscriptions_v2 s ON s.tariff_id = ma.tariff_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND s.user_id = auth.uid()
      AND s.status = ANY (ARRAY['active'::public.subscription_status, 'trial'::public.subscription_status])
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )

  -- Cross-product training_content entitlement path.
  OR EXISTS (
    SELECT 1
    FROM public.training_lessons tl
    JOIN public.training_modules tm ON tm.id = tl.module_id
    JOIN public.access_rules ar
      ON ar.grant_target_type = 'training_content'
     AND ar.is_active = true
    JOIN public.entitlements e
      ON e.product_id = ar.product_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND e.user_id = auth.uid()
      AND e.status = 'active'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND (
        -- Full grant to root/container or directly to this module.
        ((ar.conditions->>'access_mode') = 'full'
          AND (ar.target_ref = tm.id::text OR ar.target_ref = COALESCE(tm.parent_module_id::text, '')))
        -- Partial grant: module or lesson explicitly allowed.
        OR ((COALESCE(ar.conditions->'allowed_module_ids', '[]'::jsonb)) ? tm.id::text)
        OR ((COALESCE(ar.conditions->'allowed_lesson_ids', '[]'::jsonb)) ? tl.id::text)
      )
  )
);
