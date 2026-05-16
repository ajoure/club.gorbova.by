\set ON_ERROR_STOP on
DROP TABLE IF EXISTS base, base_email, annotated, classified, cohort_r2;
\pset pager off
\pset null '0'

-- ============================================================================
-- H5.1a-R2 — Expanded Frozen Cohort via Parent Subscription + Product Type SOT
-- READ-ONLY. DML=0.
-- ============================================================================

CREATE TEMP TABLE base AS
SELECT p.id AS payment_id,
       p.order_id AS parent_order_id,
       p.user_id, p.profile_id,
       p.amount, p.provider_payment_id, p.paid_at,
       p.refunded_amount, p.transaction_type,
       p.meta AS payment_meta,
       o.order_number AS parent_order_number,
       o.product_id, o.tariff_id, o.currency,
       o.pipeline_id, o.pipeline_stage_id, o.offer_id,
       o.deal_date AS parent_deal_date,
       o.created_at AS parent_created_at,
       o.bepaid_subscription_id AS parent_sbs,
       o.meta AS parent_meta,
       to_char(p.paid_at AT TIME ZONE 'Europe/Minsk','YYYY-MM') AS pay_month,
       to_char(COALESCE(o.deal_date, o.created_at) AT TIME ZONE 'Europe/Minsk','YYYY-MM') AS parent_month
FROM payments_v2 p
JOIN orders_v2 o ON o.id = p.order_id
WHERE p.provider = 'bepaid'
  AND p.paid_at >= '2026-01-01' AND p.paid_at < '2027-01-01'
  AND p.amount > 0
  AND (p.transaction_type IS NULL OR p.transaction_type NOT ILIKE '%refund%')
  AND COALESCE(p.meta->>'type','') <> 'refund'
  AND o.order_number NOT LIKE 'REBILL-%'
  AND COALESCE(o.meta->>'source','') NOT IN ('h5_historical_repair','rebill_materialization','rebill_materialization_repair');

-- Profiles map for email
CREATE TEMP TABLE base_email AS
SELECT b.payment_id,
  pr.email AS email
FROM base b
LEFT JOIN profiles pr ON pr.id = b.profile_id
/* auth.users not accessible */;

CREATE TEMP TABLE annotated AS
WITH rn AS (
  SELECT payment_id,
         ROW_NUMBER() OVER (PARTITION BY parent_order_id ORDER BY paid_at, payment_id) AS rn_in_order
  FROM base
),
sbs AS (
  -- R2: parent_sbs treated as primary, NO echo requirement
  SELECT b.payment_id,
    CASE
      WHEN NULLIF(b.payment_meta->>'bepaid_subscription_id','') IS NOT NULL THEN 'payment_meta.bepaid_subscription_id'
      WHEN NULLIF(b.payment_meta->>'subscription_id','') IS NOT NULL THEN 'payment_meta.subscription_id'
      WHEN NULLIF(b.payment_meta->>'sbs','') IS NOT NULL THEN 'payment_meta.sbs'
      WHEN b.payment_meta #>> '{provider_response,transaction,subscription_id}' IS NOT NULL THEN 'provider_response.transaction.subscription_id'
      WHEN b.payment_meta #>> '{provider_response,subscription_id}' IS NOT NULL THEN 'provider_response.subscription_id'
      WHEN b.parent_sbs IS NOT NULL THEN 'parent.bepaid_subscription_id'
      ELSE 'NONE'
    END AS sbs_source,
    COALESCE(
      NULLIF(b.payment_meta->>'bepaid_subscription_id',''),
      NULLIF(b.payment_meta->>'subscription_id',''),
      NULLIF(b.payment_meta->>'sbs',''),
      b.payment_meta #>> '{provider_response,transaction,subscription_id}',
      b.payment_meta #>> '{provider_response,subscription_id}',
      b.parent_sbs
    ) AS sbs_resolved
  FROM base b
),
sub_link AS (
  -- subscriptions_v2 evidence: order linked as initial / checkout / extended_by
  SELECT b.payment_id,
    EXISTS (
      SELECT 1 FROM subscriptions_v2 s
      WHERE s.order_id = b.parent_order_id
         OR s.meta->>'initial_order_id' = b.parent_order_id::text
         OR s.meta->>'checkout_order_id' = b.parent_order_id::text
         OR (s.meta ? 'extended_by_orders' AND s.meta->'extended_by_orders' @> to_jsonb(b.parent_order_id::text))
    ) AS sub_linked,
    (SELECT s.id FROM subscriptions_v2 s
      WHERE s.order_id = b.parent_order_id
         OR s.meta->>'initial_order_id' = b.parent_order_id::text
         OR s.meta->>'checkout_order_id' = b.parent_order_id::text
         OR (s.meta ? 'extended_by_orders' AND s.meta->'extended_by_orders' @> to_jsonb(b.parent_order_id::text))
      LIMIT 1) AS sub_id
  FROM base b
),
parent_meta_rec AS (
  SELECT b.payment_id,
    (
      b.parent_meta::text ILIKE '%subscription%' OR
      b.parent_meta::text ILIKE '%rebill%' OR
      b.parent_meta::text ILIKE '%payment_flow%' OR
      COALESCE(b.parent_meta->>'payment_flow','') ILIKE '%subscription%' OR
      COALESCE(b.parent_meta->>'source','') ILIKE '%subscription%'
    ) AS parent_meta_recurring
  FROM base b
),
product_sot AS (
  -- Product Type SOT: tariff has any tariff_offer with recurring evidence
  SELECT b.payment_id,
    EXISTS (
      SELECT 1 FROM tariff_offers tof
      WHERE tof.tariff_id = b.tariff_id
        AND (
          (tof.meta->'recurring'->>'is_recurring')::boolean IS TRUE
          OR tof.is_installment IS TRUE
          OR tof.requires_card_tokenization IS TRUE
          OR tof.auto_charge_after_trial IS TRUE
        )
    ) AS tariff_recurring,
    (SELECT bool_or((tof.meta->'recurring'->>'is_recurring')::boolean) FROM tariff_offers tof WHERE tof.tariff_id = b.tariff_id) AS tariff_meta_recurring,
    (SELECT bool_or(tof.is_installment) FROM tariff_offers tof WHERE tof.tariff_id = b.tariff_id) AS tariff_installment,
    (SELECT bool_or(tof.auto_charge_after_trial) FROM tariff_offers tof WHERE tof.tariff_id = b.tariff_id) AS tariff_trial_auto
  FROM base b
),
refund_link AS (
  SELECT b.payment_id,
    EXISTS (
      SELECT 1 FROM payments_v2 r
      WHERE (r.amount < 0 OR r.transaction_type ILIKE '%refund%' OR r.meta->>'type'='refund')
        AND (
          r.meta->>'parent_payment_id' = b.payment_id::text
          OR r.meta->>'parent_payment_uid' = b.provider_payment_id
          OR r.meta->>'parent_uid' = b.provider_payment_id
          OR r.meta->>'original_payment_uid' = b.provider_payment_id
        )
    ) AS has_refund_row
  FROM base b
),
already_mat AS (
  SELECT b.payment_id,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN EXISTS (SELECT 1 FROM orders_v2 o WHERE o.order_number = 'REBILL-' || substr(b.payment_id::text,1,12)) THEN 'order_number_match' END,
      CASE WHEN EXISTS (SELECT 1 FROM orders_v2 o WHERE o.meta->>'materialized_from_payment_id' = b.payment_id::text) THEN 'meta_payment_id_match' END,
      CASE WHEN EXISTS (SELECT 1 FROM orders_v2 o WHERE o.meta->>'materialized_from_payment_uid' = b.provider_payment_id) THEN 'meta_payment_uid_match' END,
      CASE WHEN EXISTS (SELECT 1 FROM orders_v2 o WHERE o.provider='bepaid' AND o.provider_payment_id = b.provider_payment_id AND o.order_number LIKE 'REBILL-%') THEN 'provider_payment_id_match' END
    ], NULL) AS matches,
    (SELECT COUNT(DISTINCT o.id) FROM orders_v2 o
       WHERE o.order_number = 'REBILL-' || substr(b.payment_id::text,1,12)
          OR o.meta->>'materialized_from_payment_id' = b.payment_id::text
          OR o.meta->>'materialized_from_payment_uid' = b.provider_payment_id
          OR (o.provider='bepaid' AND o.provider_payment_id = b.provider_payment_id AND o.order_number LIKE 'REBILL-%')
    ) AS distinct_match_count,
    EXISTS (SELECT 1 FROM orders_v2 o WHERE o.id = b.parent_order_id AND o.order_number LIKE 'REBILL-%') AS already_linked_to_rebill
  FROM base b
)
SELECT b.*, rr.rn_in_order,
       s.sbs_source, s.sbs_resolved,
       sl.sub_linked, sl.sub_id,
       pmr.parent_meta_recurring,
       ps.tariff_recurring, ps.tariff_meta_recurring, ps.tariff_installment, ps.tariff_trial_auto,
       rl.has_refund_row,
       am.matches AS already_matches,
       am.distinct_match_count,
       am.already_linked_to_rebill,
       be.email
FROM base b
JOIN rn rr ON rr.payment_id = b.payment_id
JOIN sbs s ON s.payment_id = b.payment_id
JOIN sub_link sl ON sl.payment_id = b.payment_id
JOIN parent_meta_rec pmr ON pmr.payment_id = b.payment_id
JOIN product_sot ps ON ps.payment_id = b.payment_id
JOIN refund_link rl ON rl.payment_id = b.payment_id
JOIN already_mat am ON am.payment_id = b.payment_id
JOIN base_email be ON be.payment_id = b.payment_id;

CREATE TEMP TABLE classified AS
SELECT a.*,
  CASE
    WHEN array_length(a.already_matches, 1) IS NULL THEN 'none'
    WHEN a.distinct_match_count > 1 THEN 'multi_match'
    WHEN array_length(a.already_matches, 1) = 1 THEN a.already_matches[1]
    ELSE 'multi_signal_single_order'
  END AS already_materialized_check,
  CASE
    WHEN COALESCE(a.refunded_amount,0) > 0 THEN 'parent_refunded'
    WHEN a.has_refund_row THEN 'refund_row_found'
    ELSE 'clean'
  END AS refund_check,
  (a.pay_month <> a.parent_month OR a.rn_in_order > 1) AS split_signal,
  -- R2 parent-order recurring evidence (any)
  (
    a.parent_sbs IS NOT NULL
    OR a.parent_meta_recurring
    OR a.sub_linked
  ) AS parent_recurring_evidence,
  -- Product Type SOT
  a.tariff_recurring AS product_sot_recurring,
  -- detailed evidence string
  CONCAT_WS(',',
    CASE WHEN a.parent_sbs IS NOT NULL THEN 'parent.bepaid_subscription_id' END,
    CASE WHEN a.parent_meta_recurring THEN 'parent.meta.subscription_markers' END,
    CASE WHEN a.sub_linked THEN 'subscriptions_v2.link' END,
    CASE WHEN a.tariff_meta_recurring THEN 'tariff_offer.meta.recurring' END,
    CASE WHEN a.tariff_installment THEN 'tariff_offer.installment' END,
    CASE WHEN a.tariff_trial_auto THEN 'tariff_offer.trial_auto_charge' END,
    CASE WHEN a.sbs_source <> 'NONE' THEN 'sbs=' || a.sbs_source END
  ) AS recurring_evidence_source
FROM annotated a;

CREATE TEMP TABLE cohort_r2 AS
SELECT c.*,
  CASE
    WHEN NOT c.split_signal THEN 'skip_no_split'
    WHEN c.refund_check <> 'clean' THEN 'manual_review:refund_present'
    WHEN c.distinct_match_count > 1 THEN 'manual_review:already_materialized_conflict'
    WHEN c.already_materialized_check <> 'none' THEN
      CASE WHEN c.already_linked_to_rebill THEN 'skip_done' ELSE 'manual_review:already_materialized_conflict' END
    WHEN c.pipeline_id IS NULL OR c.pipeline_stage_id IS NULL THEN 'manual_review:pipeline_missing'
    WHEN c.tariff_id IS NULL THEN 'manual_review:tariff_id_null'
    WHEN c.sbs_source = 'NONE' AND NOT c.parent_recurring_evidence THEN 'manual_review:sbs_unresolved'
    WHEN NOT c.parent_recurring_evidence THEN 'manual_review:no_parent_recurring_evidence'
    WHEN NOT c.product_sot_recurring THEN 'manual_review:not_recurring_product'
    ELSE 'green'
  END AS guard_status,
  'REBILL-' || substr(c.payment_id::text,1,12) AS expected_rebill_order_number
FROM classified c;

\echo '=== BASE ==='
SELECT COUNT(*) AS base_rows, COUNT(DISTINCT user_id) AS users, COUNT(DISTINCT parent_order_id) AS parents, ROUND(SUM(amount)::numeric,2) AS sum_amt FROM base;

\echo '=== R2 — guard_status distribution ==='
SELECT guard_status, COUNT(*) AS n, ROUND(SUM(amount)::numeric,2) AS sum_amt FROM cohort_r2 GROUP BY 1 ORDER BY 2 DESC;

\echo '=== R2 GREEN — months distribution ==='
SELECT pay_month, COUNT(*) AS n, ROUND(SUM(amount)::numeric,2) AS sum_amt FROM cohort_r2 WHERE guard_status='green' GROUP BY 1 ORDER BY 1;

\echo '=== R2 GREEN — evidence sources distribution ==='
SELECT
  COUNT(*) FILTER (WHERE parent_sbs IS NOT NULL) AS w_parent_sbs,
  COUNT(*) FILTER (WHERE parent_meta_recurring) AS w_parent_meta,
  COUNT(*) FILTER (WHERE sub_linked) AS w_sub_linked,
  COUNT(*) FILTER (WHERE tariff_meta_recurring) AS w_tariff_meta_rec,
  COUNT(*) FILTER (WHERE tariff_installment) AS w_tariff_installment,
  COUNT(*) FILTER (WHERE tariff_trial_auto) AS w_tariff_trial,
  COUNT(*) FILTER (WHERE sbs_source <> 'NONE') AS w_sbs_resolved
FROM cohort_r2 WHERE guard_status='green';

\echo '=== R2 GREEN — distinct dimensions ==='
SELECT COUNT(*) AS n_payments,
  COUNT(DISTINCT user_id) AS users,
  COUNT(DISTINCT parent_order_id) AS parents,
  COUNT(DISTINCT product_id) AS products,
  COUNT(DISTINCT tariff_id) AS tariffs,
  ROUND(SUM(amount)::numeric,2) AS sum_amt
FROM cohort_r2 WHERE guard_status='green';

\echo '=== A_green vs R2_green vs C_candidate compare ==='
WITH a_green AS (
  SELECT c.payment_id
  FROM classified c
  WHERE c.refund_check='clean'
    AND c.distinct_match_count <= 1
    AND c.already_materialized_check='none'
    AND c.pipeline_id IS NOT NULL AND c.pipeline_stage_id IS NOT NULL
    AND c.tariff_id IS NOT NULL
    AND c.sbs_source IN ('payment_meta.bepaid_subscription_id','payment_meta.subscription_id','payment_meta.sbs','provider_response.transaction.subscription_id','provider_response.subscription_id','parent.bepaid_subscription_id')
    AND c.split_signal
),
a_green_strict AS (
  -- old strict definition (with echo requirement): we can't reproduce without re-run, approximate as payment_meta sbs only
  SELECT c.payment_id FROM classified c
  WHERE c.refund_check='clean' AND c.distinct_match_count <= 1 AND c.already_materialized_check='none'
    AND c.pipeline_id IS NOT NULL AND c.pipeline_stage_id IS NOT NULL AND c.tariff_id IS NOT NULL
    AND c.split_signal
    AND c.sbs_source IN ('payment_meta.bepaid_subscription_id','payment_meta.subscription_id','payment_meta.sbs','provider_response.transaction.subscription_id','provider_response.subscription_id')
),
r2_green AS (SELECT payment_id FROM cohort_r2 WHERE guard_status='green'),
c_candidate AS (SELECT payment_id FROM classified WHERE split_signal)
SELECT
  (SELECT COUNT(*) FROM a_green_strict) AS strict_a_green,
  (SELECT COUNT(*) FROM r2_green) AS r2_green,
  (SELECT COUNT(*) FROM c_candidate) AS broad_c,
  (SELECT COUNT(*) FROM (SELECT payment_id FROM r2_green INTERSECT SELECT payment_id FROM c_candidate) x) AS r2_intersect_c,
  (SELECT COUNT(*) FROM (SELECT payment_id FROM c_candidate EXCEPT SELECT payment_id FROM r2_green) x) AS c_minus_r2,
  (SELECT COUNT(*) FROM (SELECT payment_id FROM r2_green EXCEPT SELECT payment_id FROM c_candidate) x) AS r2_minus_c,
  (SELECT COUNT(*) FROM (SELECT payment_id FROM a_green_strict EXCEPT SELECT payment_id FROM r2_green) x) AS strict_minus_r2;

\echo '=== C \ R2 — reasons distribution ==='
WITH c_cand AS (SELECT payment_id FROM classified WHERE split_signal),
     r2_green AS (SELECT payment_id FROM cohort_r2 WHERE guard_status='green'),
     diff AS (SELECT payment_id FROM c_cand EXCEPT SELECT payment_id FROM r2_green)
SELECT cr.guard_status, COUNT(*) AS n FROM cohort_r2 cr JOIN diff d ON d.payment_id=cr.payment_id GROUP BY 1 ORDER BY 2 DESC;

\echo '=== R2 GREEN per-tariff ==='
SELECT product_id, tariff_id, COUNT(*) AS n, ROUND(SUM(amount)::numeric,2) AS sum_amt
FROM cohort_r2 WHERE guard_status='green' GROUP BY 1,2 ORDER BY n DESC;

\echo '=== SCOPED BASELINES (R2 GREEN users) ==='
WITH gusers AS (SELECT DISTINCT user_id FROM cohort_r2 WHERE guard_status='green')
SELECT
  (SELECT COUNT(*) FROM payments_v2 p JOIN gusers g ON g.user_id=p.user_id) AS payments_rows,
  (SELECT md5(string_agg(p.id::text||'|'||COALESCE(p.amount::text,'')||'|'||COALESCE(p.provider_payment_id,'')||'|'||COALESCE(p.transaction_type,''), '' ORDER BY p.id))
     FROM payments_v2 p JOIN gusers g ON g.user_id=p.user_id) AS payments_md5_stable,
  (SELECT COUNT(*) FROM orders_v2 o JOIN gusers g ON g.user_id=o.user_id) AS orders_rows,
  (SELECT md5(string_agg(o.id::text, '' ORDER BY o.id)) FROM orders_v2 o JOIN gusers g ON g.user_id=o.user_id) AS orders_md5,
  (SELECT COUNT(*) FROM subscriptions_v2 s JOIN gusers g ON g.user_id=s.user_id) AS subs_rows,
  (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM s.access_end_at)::bigint),0) FROM subscriptions_v2 s JOIN gusers g ON g.user_id=s.user_id WHERE s.access_end_at IS NOT NULL) AS subs_epoch_sum,
  (SELECT COUNT(*) FROM entitlements e JOIN gusers g ON g.user_id=e.user_id) AS ent_rows,
  (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM e.expires_at)::bigint),0) FROM entitlements e JOIN gusers g ON g.user_id=e.user_id WHERE e.expires_at IS NOT NULL) AS ent_epoch_sum;

\echo '=== GLOBAL REBILL baseline ==='
SELECT COUNT(*) AS rebill_orders, md5(string_agg(id::text, '' ORDER BY id)) AS md5 FROM orders_v2 WHERE order_number LIKE 'REBILL-%';

\echo '=== MODE check ==='
SELECT 'mode_check_skipped_no_system_settings_table' AS note;

\echo '=== CSV export — R2 all ==='
\copy (SELECT email, payment_id, provider_payment_id, parent_order_id, parent_order_number, pay_month AS payment_month, parent_month AS parent_order_month, amount, currency, paid_at, product_id, tariff_id, pipeline_id, pipeline_stage_id, offer_id, sbs_source, sbs_resolved, sub_id, parent_meta_recurring, tariff_meta_recurring, tariff_installment, tariff_trial_auto, refund_check, already_materialized_check, expected_rebill_order_number, recurring_evidence_source, guard_status FROM cohort_r2 ORDER BY pay_month, parent_order_id, paid_at) TO '/tmp/h51a_r2/r2_all.csv' WITH CSV HEADER

\echo '=== CSV export — R2 GREEN only ==='
\copy (SELECT email, payment_id, provider_payment_id, parent_order_id, parent_order_number, pay_month AS payment_month, parent_month AS parent_order_month, amount, currency, paid_at, product_id, tariff_id, pipeline_id, pipeline_stage_id, offer_id, sbs_source, sbs_resolved, sub_id, parent_meta_recurring, tariff_meta_recurring, tariff_installment, tariff_trial_auto, refund_check, already_materialized_check, expected_rebill_order_number, recurring_evidence_source FROM cohort_r2 WHERE guard_status='green' ORDER BY pay_month, parent_order_id, paid_at) TO '/tmp/h51a_r2/r2_green.csv' WITH CSV HEADER
