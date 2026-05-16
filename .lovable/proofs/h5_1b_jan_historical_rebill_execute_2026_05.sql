\pset pager off
\pset null '0'

\echo '=== RUNTIME REBILL EXEMPLAR (status / deal_date vs paid_at / created_at / bepaid_subscription_id / meta keys) ==='
SELECT id, order_number, status, deal_date, created_at, paid_amount, final_price, base_price, provider, provider_payment_id, bepaid_subscription_id,
       (meta ? 'source') AS has_source, meta->>'source' AS source,
       (meta ? 'materialized_from_payment_id') AS has_mfpi,
       (meta ? 'materialized_from_payment_uid') AS has_mfpu,
       (meta ? 'parent_order_id') AS has_parent_order_id,
       (meta ? 'do_not_grant_access') AS has_dnga,
       jsonb_object_keys(meta) AS k
FROM orders_v2
WHERE order_number LIKE 'REBILL-%'
ORDER BY created_at DESC
LIMIT 1;

\echo '=== RUNTIME REBILL — distinct status / source / created_at vs deal_date pattern (last 50) ==='
SELECT status::text, meta->>'source' AS src, COUNT(*) AS n,
  COUNT(*) FILTER (WHERE deal_date IS NOT NULL) AS w_deal,
  COUNT(*) FILTER (WHERE deal_date = created_at) AS deal_eq_created,
  COUNT(*) FILTER (WHERE bepaid_subscription_id IS NOT NULL) AS w_sbs
FROM (SELECT * FROM orders_v2 WHERE order_number LIKE 'REBILL-%' ORDER BY created_at DESC LIMIT 50) x
GROUP BY 1,2 ORDER BY n DESC;

\echo '=== RUNTIME REBILL — meta keys distribution (sample 20) ==='
SELECT k, COUNT(*) AS n FROM (
  SELECT jsonb_object_keys(meta) AS k FROM orders_v2 WHERE order_number LIKE 'REBILL-%' ORDER BY created_at DESC LIMIT 20
) y GROUP BY 1 ORDER BY 2 DESC;

\echo '=== MODE PROOF FROM AUDIT (last 20 with materialization signals) ==='
SELECT action, actor_type, actor_label, created_at, jsonb_object_keys(meta) AS k
FROM audit_logs
WHERE action ILIKE '%rebill%' OR action ILIKE '%materializ%'
ORDER BY created_at DESC LIMIT 20;

\echo '=== RUNTIME proof — recent REBILL orders count by day ==='
SELECT date_trunc('day', created_at)::date AS d, COUNT(*) FROM orders_v2 WHERE order_number LIKE 'REBILL-%' AND created_at >= now()-interval '14 days' GROUP BY 1 ORDER BY 1;

\echo '=== FROZEN JAN — load and validate ==='
DROP TABLE IF EXISTS h5_1b_jan_frozen;
CREATE TEMP TABLE h5_1b_jan_frozen (
  email text, payment_id uuid, provider_payment_id text, parent_order_id uuid, parent_order_number text,
  payment_month text, parent_order_month text, amount numeric, currency text, paid_at timestamptz,
  product_id uuid, tariff_id uuid, pipeline_id uuid, pipeline_stage_id uuid, offer_id uuid,
  sbs_source text, sbs_resolved text, sub_id uuid, parent_meta_recurring text, tariff_meta_recurring text,
  tariff_installment text, tariff_trial_auto text, refund_check text, already_materialized_check text,
  expected_rebill_order_number_csv text, recurring_evidence_source text
);
\copy h5_1b_jan_frozen FROM '/tmp/h51b_jan/jan.csv' WITH CSV HEADER

SELECT 'frozen_count' AS k, COUNT(*) AS v, ROUND(SUM(amount)::numeric,2) AS sum_amt FROM h5_1b_jan_frozen;

\echo '=== PREFLIGHT per row ==='
DROP TABLE IF EXISTS preflight;
CREATE TEMP TABLE preflight AS
WITH r AS (
  SELECT f.*,
    'REBILL-' || substr(f.payment_id::text,1,12) AS expected_rebill,
    p.order_id AS current_payment_order_id,
    p.refunded_amount AS p_refunded,
    p.transaction_type AS p_ttype,
    p.amount AS p_amount,
    o.order_number AS p_order_number,
    o.status::text AS o_status,
    (SELECT COUNT(*) FROM payments_v2 q
       WHERE q.order_id = f.parent_order_id
         AND q.id <> f.payment_id
         AND (q.transaction_type IS NULL OR q.transaction_type NOT ILIKE '%refund%')
         AND COALESCE(q.meta->>'type','') <> 'refund'
         AND q.amount > 0
    ) AS sibling_nonrefund_count,
    EXISTS (SELECT 1 FROM orders_v2 oo WHERE oo.order_number = 'REBILL-' || substr(f.payment_id::text,1,12)) AS exist_by_ordnum,
    EXISTS (SELECT 1 FROM orders_v2 oo WHERE oo.meta->>'materialized_from_payment_id' = f.payment_id::text) AS exist_by_mfpi,
    EXISTS (SELECT 1 FROM orders_v2 oo WHERE oo.meta->>'materialized_from_payment_uid' = f.provider_payment_id) AS exist_by_mfpu,
    EXISTS (SELECT 1 FROM orders_v2 oo WHERE oo.provider='bepaid' AND oo.provider_payment_id = f.provider_payment_id AND oo.order_number LIKE 'REBILL-%') AS exist_by_pp,
    EXISTS (SELECT 1 FROM orders_v2 oo WHERE oo.provider='bepaid' AND oo.provider_payment_id = f.provider_payment_id AND oo.id <> f.parent_order_id) AS pp_collision_any,
    EXISTS (SELECT 1 FROM payments_v2 r2
      WHERE (r2.amount < 0 OR r2.transaction_type ILIKE '%refund%' OR r2.meta->>'type'='refund')
        AND (r2.meta->>'parent_payment_id' = f.payment_id::text
          OR r2.meta->>'parent_payment_uid' = f.provider_payment_id
          OR r2.meta->>'parent_uid' = f.provider_payment_id
          OR r2.meta->>'original_payment_uid' = f.provider_payment_id)
    ) AS has_refund_row
  FROM h5_1b_jan_frozen f
  LEFT JOIN payments_v2 p ON p.id = f.payment_id
  LEFT JOIN orders_v2 o ON o.id = f.parent_order_id
)
SELECT *,
  CASE
    WHEN current_payment_order_id IS NULL THEN 'fail:payment_missing'
    WHEN current_payment_order_id <> parent_order_id THEN 'fail:payment_moved'
    WHEN p_order_number LIKE 'REBILL-%' THEN 'fail:parent_is_rebill'
    WHEN exist_by_ordnum OR exist_by_mfpi OR exist_by_mfpu OR exist_by_pp THEN 'fail:already_materialized'
    WHEN pp_collision_any THEN 'fail:provider_payment_unique_collision'
    WHEN COALESCE(p_refunded,0) > 0 OR has_refund_row THEN 'fail:refund_present'
    WHEN sibling_nonrefund_count < 1 THEN 'fail:parent_has_no_other_payment'
    WHEN pipeline_id IS NULL OR pipeline_stage_id IS NULL THEN 'fail:pipeline_missing'
    WHEN tariff_id IS NULL OR product_id IS NULL THEN 'fail:tariff_or_product_null'
    WHEN amount IS NULL OR amount <= 0 THEN 'fail:amount_invalid'
    WHEN currency <> 'BYN' THEN 'fail:currency_not_byn'
    WHEN expected_rebill <> expected_rebill_order_number_csv THEN 'fail:rebill_number_mismatch_with_csv'
    ELSE 'pass'
  END AS guard_status
FROM r;

\echo '=== PREFLIGHT distribution ==='
SELECT guard_status, COUNT(*) FROM preflight GROUP BY 1 ORDER BY 2 DESC;

\echo '=== FINAL FROZEN EXECUTE TABLE (pass only) ==='
SELECT email, payment_id, provider_payment_id, parent_order_id, expected_rebill, amount, paid_at, sibling_nonrefund_count
FROM preflight WHERE guard_status='pass' ORDER BY paid_at;

\echo '=== FROZEN — every row with guard_status (full) ==='
SELECT email, payment_id, parent_order_id, current_payment_order_id, p_order_number, o_status, sibling_nonrefund_count,
       exist_by_ordnum, exist_by_mfpi, exist_by_mfpu, exist_by_pp, pp_collision_any,
       p_refunded, has_refund_row, guard_status
FROM preflight ORDER BY paid_at;

\echo '=== SCOPED BASELINES (12 users) ==='
WITH g AS (SELECT DISTINCT p.user_id FROM h5_1b_jan_frozen f JOIN payments_v2 p ON p.id=f.payment_id WHERE p.user_id IS NOT NULL)
SELECT
  (SELECT COUNT(*) FROM g) AS n_users,
  (SELECT COUNT(*) FROM subscriptions_v2 s JOIN g ON g.user_id=s.user_id) AS sub_rows,
  (SELECT md5(string_agg(s.id::text||'|'||COALESCE(s.access_end_at::text,'')||'|'||s.status::text||'|'||s.updated_at::text,'' ORDER BY s.id))
     FROM subscriptions_v2 s JOIN g ON g.user_id=s.user_id) AS sub_md5,
  (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM s.access_end_at)::bigint),0) FROM subscriptions_v2 s JOIN g ON g.user_id=s.user_id WHERE s.access_end_at IS NOT NULL) AS sub_epoch,
  (SELECT COUNT(*) FROM entitlements e JOIN g ON g.user_id=e.user_id) AS ent_rows,
  (SELECT md5(string_agg(e.id::text||'|'||COALESCE(e.expires_at::text,'')||'|'||e.updated_at::text,'' ORDER BY e.id))
     FROM entitlements e JOIN g ON g.user_id=e.user_id) AS ent_md5,
  (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM e.expires_at)::bigint),0) FROM entitlements e JOIN g ON g.user_id=e.user_id WHERE e.expires_at IS NOT NULL) AS ent_epoch,
  (SELECT COUNT(*) FROM provider_subscriptions ps JOIN g ON g.user_id=ps.user_id) AS ps_rows,
  (SELECT md5(string_agg(ps.id::text||'|'||ps.state||'|'||COALESCE(ps.next_charge_at::text,'')||'|'||ps.updated_at::text,'' ORDER BY ps.id))
     FROM provider_subscriptions ps JOIN g ON g.user_id=ps.user_id) AS ps_md5;

\echo '=== telegram_access_queue scoped ==='
WITH g AS (SELECT DISTINCT p.user_id FROM h5_1b_jan_frozen f JOIN payments_v2 p ON p.id=f.payment_id WHERE p.user_id IS NOT NULL),
parents AS (SELECT DISTINCT parent_order_id AS oid FROM h5_1b_jan_frozen)
SELECT
  (SELECT COUNT(*) FROM telegram_access_queue q WHERE q.user_id IN (SELECT user_id FROM g) OR q.meta->>'order_id' IN (SELECT oid::text FROM parents)) AS taq_scoped_rows,
  (SELECT md5(COALESCE(string_agg(q.id::text||'|'||q.status::text,'' ORDER BY q.id),'EMPTY')) FROM telegram_access_queue q
    WHERE q.user_id IN (SELECT user_id FROM g) OR q.meta->>'order_id' IN (SELECT oid::text FROM parents)) AS taq_scoped_md5;

\echo '=== GLOBAL REBILL baseline ==='
SELECT COUNT(*) AS rebill_rows, md5(string_agg(id::text,'' ORDER BY id)) AS md5 FROM orders_v2 WHERE order_number LIKE 'REBILL-%';

\echo '=== PAYMENTS_V2 scoped baseline (12 payments) ==='
SELECT md5(string_agg(p.id::text||'|'||COALESCE(p.order_id::text,'')||'|'||COALESCE(p.amount::text,'')||'|'||COALESCE(p.provider_payment_id,''),'' ORDER BY p.id))
FROM payments_v2 p WHERE p.id IN (SELECT payment_id FROM h5_1b_jan_frozen);

\echo '=== EXPECTED ROWCOUNTS ==='
SELECT
  (SELECT COUNT(*) FROM preflight WHERE guard_status='pass') AS expected_inserts_orders_v2,
  (SELECT COUNT(*) FROM preflight WHERE guard_status='pass') AS expected_updates_payments_v2,
  (SELECT COUNT(*) FROM preflight WHERE guard_status='pass') + 1 AS expected_audit_rows,
  (SELECT COUNT(*) FROM preflight WHERE guard_status<>'pass') AS skipped;

\echo '=== ROLLBACK PREVIEW (what would be touched) ==='
SELECT 'orders_v2 to DELETE (count=0 now, count=N after execute)' AS k,
  (SELECT COUNT(*) FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026') AS v_before_execute;
SELECT 'payments_v2 to UPDATE back to parent (count=0 now, count=N after execute)' AS k,
  (SELECT COUNT(*) FROM payments_v2 WHERE order_id IN (SELECT id FROM orders_v2 WHERE meta->>'run'='h5_1b_jan_2026')) AS v_before_execute;
