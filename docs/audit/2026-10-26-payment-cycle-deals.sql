-- READ ONLY. Run only through the canonical Lovable Cloud project.
-- Complete 2026+ ledger scope, not a first-page/sample audit. No PII/payloads.
-- Candidates need source-backed review; a date mismatch alone is not permission
-- to rewrite a contractual month, split an installment, or grant access.
WITH receipts AS (
  SELECT p.order_id, p.provider, p.provider_payment_id, min(p.paid_at) paid_at,
    max(p.amount) amount, upper(p.currency) currency
  FROM public.payments_v2 p
  WHERE NOT coalesce(p.is_deleted,false) AND p.amount>0
    AND p.status::text IN ('succeeded','refunded','partially_refunded')
    AND coalesce(p.transaction_type,'payment') IN ('payment','sale','capture','Платеж')
    AND p.provider_payment_id IS NOT NULL AND p.paid_at>='2026-01-01T00:00:00Z'
  GROUP BY p.order_id,p.provider,p.provider_payment_id,upper(p.currency)
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
    o.meta#>>'{checkout_purchase_identity,context,month}' identity_month,
    o.meta#>>'{checkout_purchase_identity,context,kind}' purchase_kind,
    o.final_price
  FROM per_order r LEFT JOIN public.orders_v2 o ON o.id=r.order_id
  WHERE NOT coalesce(o.is_deleted,false)
), findings AS (
  SELECT *,
    CASE WHEN id IS NULL THEN 'missing_order'
      WHEN is_installment THEN 'installment_review_separately'
      WHEN receipt_count>1 AND gross>final_price AND purchase_kind='one_time'
        THEN 'multiple_real_receipts_on_one_time_order'
      WHEN flow='renewal_one_time' AND receipt_count=1 AND identity_month IS NULL
        AND deal_month IS DISTINCT FROM to_char(first_paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM')
        THEN 'renewal_legacy_month_candidate'
      ELSE 'other_or_no_candidate' END classification
  FROM classified
)
SELECT classification,count(*) order_count,count(DISTINCT user_id) user_count,
  sum(receipt_count) receipt_count,min(first_paid_at) oldest_receipt,max(last_paid_at) newest_receipt
FROM findings GROUP BY classification ORDER BY classification;
