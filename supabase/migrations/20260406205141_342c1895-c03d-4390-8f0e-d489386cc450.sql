
-- Fix scope_resolution_mode for cb20 entitlements where user has full-tariff purchase
-- but batch repair incorrectly set module_scope_only

-- Step 1: Fix the 7 entitlements that have module_scope_only but user has full tariff purchase
UPDATE entitlements e
SET 
  meta = jsonb_set(
    jsonb_set(
      COALESCE(e.meta::jsonb, '{}'::jsonb),
      '{scope_resolution_mode}', '"full_tariff_scope"'
    ),
    '{scope_repair_reason}', '"user_has_full_tariff_purchase_not_module_only"'
  ),
  -- Align expires_at with BUSINESS subscription access_end_at
  expires_at = COALESCE(
    (SELECT s.access_end_at 
     FROM subscriptions_v2 s 
     WHERE s.user_id = e.user_id 
       AND s.product_id = '11c9f1b8-0355-4753-bd74-40b42aa53616'
       AND s.status IN ('active', 'past_due')
     ORDER BY s.access_end_at DESC NULLS FIRST
     LIMIT 1),
    e.expires_at
  ),
  updated_at = now()
WHERE e.product_id = '7101ed3c-7839-4a74-ad95-aa0660369b22'
  AND e.status = 'active'
  AND e.meta->>'scope_resolution_mode' = 'module_scope_only'
  AND e.meta->>'source_rule_id' = '1b497fba-031a-4318-8d9f-2530f1bac116'
  AND EXISTS (
    SELECT 1 FROM orders_v2 o
    WHERE o.user_id = e.user_id
      AND o.product_id = '7101ed3c-7839-4a74-ad95-aa0660369b22'
      AND o.status = 'paid'
      AND o.tariff_id IS NOT NULL
  );

-- Step 2: Audit log entries
INSERT INTO audit_logs (action, actor_type, actor_label, target_user_id, meta)
SELECT 
  'entitlement.scope_repaired',
  'system',
  'migration_fix_module_scope_only',
  e.user_id,
  jsonb_build_object(
    'entitlement_id', e.id,
    'product_id', e.product_id,
    'old_scope', 'module_scope_only',
    'new_scope', 'full_tariff_scope',
    'reason', 'user_has_full_tariff_purchase_not_module_only',
    'rule_id', '1b497fba-031a-4318-8d9f-2530f1bac116'
  )
FROM entitlements e
WHERE e.product_id = '7101ed3c-7839-4a74-ad95-aa0660369b22'
  AND e.status = 'active'
  AND e.meta->>'scope_resolution_mode' = 'full_tariff_scope'
  AND e.meta->>'scope_repair_reason' = 'user_has_full_tariff_purchase_not_module_only';
