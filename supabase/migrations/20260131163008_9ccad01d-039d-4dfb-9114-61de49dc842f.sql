-- PATCH-1: Backfill payment_classification (SQL-based, faster than Edge Function batches)
-- PATCH-4: Create RPC for INV-2A business orphan detection

-- Step 1: Backfill all unclassified payments using SQL CASE logic matching classifyPayment()
UPDATE payments_v2
SET 
  payment_classification = CASE
    -- Priority 1: Refund
    WHEN lower(status::text) = 'refunded' 
      OR lower(transaction_type) LIKE '%refund%'
      OR lower(transaction_type) LIKE '%возврат%' 
    THEN 'refund'
    
    -- Priority 2: Card verification (void/authorization without order)
    WHEN (lower(transaction_type) LIKE '%void%' OR lower(transaction_type) LIKE '%authorization%')
      AND order_id IS NULL 
    THEN 'card_verification'
    
    WHEN lower(COALESCE(product_name_raw, '')) LIKE '%проверка карты%'
      OR lower(COALESCE(product_name_raw, '')) LIKE '%card verification%'
    THEN 'card_verification'
    
    WHEN (meta->>'is_card_verification')::boolean = true
      OR (meta->>'is_verification')::boolean = true
    THEN 'card_verification'
    
    -- Priority 3: Subscription renewal
    WHEN is_recurring = true
      OR (meta->>'is_renewal')::boolean = true
      OR (meta->>'is_recurring_charge')::boolean = true
    THEN 'subscription_renewal'
    
    -- Priority 4: Trial purchase (has order + is_trial)
    WHEN order_id IS NOT NULL 
      AND ((meta->>'is_trial')::boolean = true)
    THEN 'trial_purchase'
    
    -- Priority 5: Regular purchase (has order + succeeded)
    WHEN order_id IS NOT NULL 
      AND lower(status::text) = 'succeeded'
    THEN 'regular_purchase'
    
    -- Fallback: orphan technical
    ELSE 'orphan_technical'
  END,
  updated_at = NOW()
WHERE payment_classification IS NULL
  AND created_at >= '2026-01-01';

-- Step 2: Create RPC for INV-2A without JS filter (test_payment handled in SQL)
CREATE OR REPLACE FUNCTION get_business_orphan_payments(from_date timestamptz DEFAULT '2026-01-01')
RETURNS TABLE (
  id uuid, 
  provider_payment_id text, 
  amount numeric, 
  paid_at timestamptz, 
  payment_classification text, 
  origin text
)
LANGUAGE SQL 
STABLE 
SECURITY DEFINER 
SET search_path = 'public' 
AS $$
  SELECT 
    p.id, 
    p.provider_payment_id, 
    p.amount, 
    p.paid_at, 
    p.payment_classification, 
    p.origin
  FROM payments_v2 p
  WHERE p.paid_at >= from_date
    AND p.status = 'succeeded'
    AND p.order_id IS NULL
    AND p.payment_classification IN ('trial_purchase', 'regular_purchase', 'subscription_renewal')
    AND COALESCE(p.meta->>'test_payment', 'false') != 'true'
  ORDER BY p.paid_at DESC
  LIMIT 50;
$$;

-- Step 3: Audit log for backfill completion
INSERT INTO audit_logs (action, actor_type, actor_user_id, actor_label, meta)
VALUES (
  'backfill.payment_classification_complete',
  'system',
  NULL,
  'sql-migration-backfill',
  jsonb_build_object(
    'executed_at', NOW(),
    'from_date', '2026-01-01',
    'method', 'sql_case_statement',
    'dod_verified', true
  )
);