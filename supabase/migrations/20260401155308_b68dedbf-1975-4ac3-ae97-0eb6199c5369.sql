
-- Fix subscription over-extension caused by multiple re-runs of grant-access-for-order
-- Revert access_end_at to correct value (one legitimate extension from ddfaeb9c)
-- Clean up duplicate entries in extended_by_orders array
UPDATE subscriptions_v2
SET 
  access_end_at = '2026-05-17T12:00:00.000Z',
  next_charge_at = '2026-05-17T12:00:00.000Z',
  meta = jsonb_set(
    meta,
    '{extended_by_orders}',
    '["1e79586c-ebcf-4306-a3a4-87d8c05c3f3d", "ddfaeb9c-0cdb-4c1b-b6ed-6963911aa3a9"]'::jsonb
  ),
  updated_at = now()
WHERE id = '830998dc-ede6-4542-891f-7913021ab39a';

-- Audit log for the fix
INSERT INTO audit_logs (action, actor_type, actor_label, target_user_id, meta)
VALUES (
  'subscription.data_fix',
  'system',
  'patch_retroactive_product_access_overextension_fix',
  '1b68252b-62ca-4e99-b1fd-d07706ac134d',
  jsonb_build_object(
    'subscription_id', '830998dc-ede6-4542-891f-7913021ab39a',
    'reason', 'Multiple re-runs of grant-access-for-order caused 3 extra extensions. Reverting to correct access_end_at.',
    'was_access_end_at', '2026-06-17T12:00:00.000Z',
    'corrected_access_end_at', '2026-05-17T12:00:00.000Z',
    'was_extended_by_orders_count', 5,
    'corrected_extended_by_orders_count', 2
  )
);
