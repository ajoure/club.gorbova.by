-- PATCH-2: Reclassify payments with correct rules
-- Step 1: 1 BYN without order in BYN currency → card_verification
UPDATE payments_v2
SET 
  payment_classification = 'card_verification',
  updated_at = NOW()
WHERE amount <= 1
  AND currency = 'BYN'
  AND order_id IS NULL
  AND status = 'succeeded'
  AND payment_classification = 'orphan_technical'
  AND created_at >= '2026-01-01';

-- Step 2: Failed with order → failed_purchase
UPDATE payments_v2
SET 
  payment_classification = 'failed_purchase',
  updated_at = NOW()
WHERE order_id IS NOT NULL
  AND status = 'failed'
  AND payment_classification = 'orphan_technical'
  AND created_at >= '2026-01-01';

-- Audit log for data fix
INSERT INTO audit_logs (action, actor_type, actor_label, meta)
VALUES (
  'data_fix.reclassify_payments_v2',
  'system',
  'nightly-monitoring-patch',
  jsonb_build_object(
    'description', 'PATCH-2: Reclassify 1 BYN card_verification and failed_purchase',
    'rules_applied', jsonb_build_array(
      'amount<=1 AND currency=BYN AND no order → card_verification',
      'order_id + status=failed → failed_purchase'
    ),
    'executed_at', NOW()
  )
);