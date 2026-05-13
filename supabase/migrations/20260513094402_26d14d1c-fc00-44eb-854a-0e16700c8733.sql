-- INV-PHANTOM-PARENT-V1 revert: восстановить ошибочно superseded entitlements
-- Затронуто: 23 строки (verified dry-run 2026-05-13)
-- Никаких изменений subscriptions_v2, provider_subscriptions, Telegram, access_end_at.

-- 1. Audit log записи для каждой revert-строки
INSERT INTO public.audit_logs (action, actor_type, actor_label, target_user_id, meta)
SELECT
  'entitlement.reverted.inv_phantom_parent_v1',
  'system',
  'inv_phantom_parent_v1_revert',
  e.user_id,
  jsonb_build_object(
    'entitlement_id', e.id,
    'product_id', e.product_id,
    'batch', 'INV-PHANTOM-PARENT-V1-2026-05-13',
    'previous_status_in_meta', e.meta->'inv_phantom_parent_v1'->>'previous_status',
    'expires_at', e.expires_at,
    'historical_module_product_ids', e.meta->'historical_module_product_ids',
    'revert_reason', 'business_bonus_parent_misclassified_as_phantom_2026_05_13'
  )
FROM public.entitlements e
WHERE e.meta->'inv_phantom_parent_v1'->>'batch' = 'INV-PHANTOM-PARENT-V1-2026-05-13'
  AND e.status = 'superseded'
  AND (e.meta->'inv_phantom_parent_v1'->>'previous_status') = 'active'
  AND (e.expires_at IS NULL OR e.expires_at > now());

-- 2. Revert статуса + пометка в meta
UPDATE public.entitlements
SET
  status = 'active',
  meta = meta || jsonb_build_object(
    'reverted_inv_phantom_parent_v1', true,
    'reverted_at', now(),
    'revert_reason', 'business_bonus_parent_misclassified_as_phantom_2026_05_13',
    'revert_batch', 'INV-PHANTOM-PARENT-V1-REVERT-2026-05-13'
  ),
  updated_at = now()
WHERE meta->'inv_phantom_parent_v1'->>'batch' = 'INV-PHANTOM-PARENT-V1-2026-05-13'
  AND status = 'superseded'
  AND (meta->'inv_phantom_parent_v1'->>'previous_status') = 'active'
  AND (expires_at IS NULL OR expires_at > now());