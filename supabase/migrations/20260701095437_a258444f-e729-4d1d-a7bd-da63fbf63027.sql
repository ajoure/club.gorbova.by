
-- Extend lesson_blocks SELECT policy to honour cross-product access_rules
-- (training_content grants that expose specific modules from other products).
-- Prior policy only allowed direct product-level subscription/entitlement/module_access.
-- This left trial buyers of a landing-product (e.g. "Gorbova Club - идеология")
-- unable to see blocks of a Club module they were explicitly granted via
-- access_rules (allowed_module_ids).

DROP POLICY IF EXISTS "Users can view lesson blocks with access" ON public.lesson_blocks;

CREATE POLICY "Users can view lesson blocks with access"
ON public.lesson_blocks
FOR SELECT
USING (
  has_role_v2(auth.uid(), 'admin'::text)
  OR has_role_v2(auth.uid(), 'super_admin'::text)
  OR has_permission(auth.uid(), 'content.manage'::text)
  -- Direct subscription on the module's own product
  OR EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN subscriptions_v2 s  ON s.product_id = tm.product_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND s.user_id = auth.uid()
      AND s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )
  -- Direct entitlement on the module's own product (legacy match by product_code)
  OR EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN products_v2 p       ON p.id = tm.product_id
    JOIN entitlements e      ON e.product_code = p.code
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND e.user_id = auth.uid()
      AND e.status = 'active'::text
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )
  -- module_access via tariff
  OR EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN training_modules tm ON tm.id = tl.module_id
    JOIN module_access ma    ON ma.module_id = tl.module_id
    JOIN subscriptions_v2 s  ON s.tariff_id = ma.tariff_id
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND tm.is_active = true
      AND s.user_id = auth.uid()
      AND s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])
      AND (s.access_end_at IS NULL OR s.access_end_at > now())
  )
  -- Cross-product training_content grant via access_rules (allowed_module_ids)
  OR EXISTS (
    SELECT 1
    FROM training_lessons tl
    JOIN access_rules ar ON ar.is_active = true
                        AND ar.grant_target_type = 'training_content'
                        AND (ar.conditions->'allowed_module_ids') ? tl.module_id::text
    WHERE tl.id = lesson_blocks.lesson_id
      AND tl.is_active = true
      AND (
        EXISTS (
          SELECT 1 FROM subscriptions_v2 s
          WHERE s.user_id = auth.uid()
            AND s.product_id = ar.product_id
            AND s.status = ANY (ARRAY['active'::subscription_status, 'trial'::subscription_status])
            AND (s.access_end_at IS NULL OR s.access_end_at > now())
            AND (ar.tariff_id IS NULL OR s.tariff_id = ar.tariff_id)
        )
        OR EXISTS (
          SELECT 1 FROM entitlements e
          WHERE e.user_id = auth.uid()
            AND e.product_id = ar.product_id
            AND e.status = 'active'::text
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
      )
  )
);
