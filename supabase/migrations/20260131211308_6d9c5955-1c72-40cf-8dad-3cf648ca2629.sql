-- Fix remaining unclassified payment (failed with order)
UPDATE payments_v2
SET 
  payment_classification = 'failed_purchase',
  updated_at = NOW()
WHERE id = 'cfb2b6cd-4195-4728-9ecb-f30deb14be0b'
  AND payment_classification IS NULL;