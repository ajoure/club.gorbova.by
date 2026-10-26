-- READ ONLY. Run only through the canonical Lovable Cloud project.
-- Complete 2026+ ledger scope, not a first-page/sample audit. No PII/payloads.
-- Candidates need source-backed review; a date mismatch alone is not permission
-- to rewrite a contractual month, split an installment, or grant access.
WITH scoped AS (
  SELECT * FROM public.payments_v2 WHERE coalesce(paid_at,created_at)>='2026-01-01T00:00:00Z'
), main AS (
  SELECT * FROM scoped p WHERE NOT coalesce(is_deleted,false) AND amount>0
    AND status::text IN ('succeeded','refunded','partially_refunded')
    AND coalesce(transaction_type,'payment') IN ('payment','sale','capture','Платеж')
    AND coalesce(payment_classification::text,'') NOT IN ('card_verification','fee','external','refund')
)
SELECT 'scoped' scope,count(*) rows,count(*) FILTER(WHERE paid_at IS NULL) null_paid_at,
  count(*) FILTER(WHERE nullif(btrim(provider_payment_id),'') IS NULL) missing_uid FROM scoped
UNION ALL SELECT 'main',count(*),count(*) FILTER(WHERE paid_at IS NULL),
  count(*) FILTER(WHERE nullif(btrim(provider_payment_id),'') IS NULL) FROM main;

WITH receipts AS (
  SELECT p.order_id, p.provider, p.provider_payment_id,
    coalesce(p.meta#>>'{stripe,account_code}',p.meta->>'account_code','') account_code,min(p.paid_at) paid_at,
    max(p.amount) amount, upper(p.currency) currency
  FROM public.payments_v2 p
  WHERE NOT coalesce(p.is_deleted,false) AND p.amount>0
    AND p.status::text IN ('succeeded','refunded','partially_refunded')
    AND coalesce(p.transaction_type,'payment') IN ('payment','sale','capture','Платеж')
    AND coalesce(p.payment_classification::text,'') NOT IN ('card_verification','fee','external','refund')
    AND nullif(btrim(p.provider_payment_id),'') IS NOT NULL AND p.paid_at>='2026-01-01T00:00:00Z'
  GROUP BY p.order_id,p.provider,p.provider_payment_id,upper(p.currency),
    coalesce(p.meta#>>'{stripe,account_code}',p.meta->>'account_code','')
), per_order AS (
  SELECT order_id,count(*) receipt_count,sum(amount) gross,
    min(paid_at) first_paid_at,max(paid_at) last_paid_at,
    count(DISTINCT to_char(paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')) paid_month_count
  FROM receipts GROUP BY order_id
), classified AS (
  SELECT o.id,o.user_id,o.deal_date,o.meta->>'deal_month' deal_month,
    o.meta->>'payment_flow' flow,r.*,
    coalesce(to_jsonb(o)->>'payment_plan_id','')<>''
      OR coalesce(o.meta->>'flow','')='rr_installment'
      OR o.meta ? 'installment' OR o.meta ? 'installment_count' is_installment,
    o.is_deleted order_deleted,
    o.meta#>>'{checkout_purchase_identity,context,month}' identity_month,
    o.meta#>>'{checkout_purchase_identity,context,kind}' purchase_kind,
    o.final_price
  FROM per_order r LEFT JOIN public.orders_v2 o ON o.id=r.order_id
), findings AS (
  SELECT *,
    CASE WHEN order_id IS NULL THEN 'null_order_id'
      WHEN id IS NULL THEN 'missing_order'
      WHEN order_deleted THEN 'deleted_order'
      WHEN is_installment THEN 'installment_review_separately'
      WHEN receipt_count>1 THEN 'multiple_real_receipts_requires_review'
      WHEN flow='renewal_one_time' AND receipt_count=1 AND identity_month IS NULL
        AND deal_month IS DISTINCT FROM to_char(first_paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')
        THEN 'renewal_legacy_month_candidate'
      ELSE 'other_or_no_candidate' END classification
  FROM classified
)
SELECT classification,count(*) order_count,count(DISTINCT user_id) user_count,
  count(*) FILTER(WHERE receipt_count>1) multiple_receipt_orders,
  sum(receipt_count) receipt_count,min(first_paid_at) oldest_receipt,max(last_paid_at) newest_receipt
FROM findings GROUP BY classification ORDER BY classification;
