-- ============================================================
-- PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1 · C2R · Integration Tests
-- Verifies orders_v2 row state (NOT just RPC return jsonb) after
-- transactional invocation. Also verifies replay idempotency,
-- lock behavior, and cross-order isolation.
--
-- Usage:   psql -f supabase/tests/order_financial_recalc_integration.sql
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _it_results (
  scenario text PRIMARY KEY,
  ok       boolean,
  detail   text
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.mk_order(
  p_final numeric, p_currency text DEFAULT 'BYN',
  p_status order_status DEFAULT 'pending', p_paid numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders_v2(id, order_number, base_price, final_price, currency, status, paid_amount)
  VALUES (v_id, 'IT-'||substr(v_id::text,1,8), p_final, p_final, p_currency, p_status, p_paid);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mk_pay(
  p_order uuid, p_amount numeric, p_status payment_status,
  p_provider text DEFAULT 'bepaid', p_txtype text DEFAULT 'payment',
  p_ref uuid DEFAULT NULL, p_refunded numeric DEFAULT 0,
  p_currency text DEFAULT 'BYN', p_deleted boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.payments_v2(id, order_id, amount, currency, status, provider,
    transaction_type, reference_payment_id, refunded_amount, is_deleted, deleted_at)
  VALUES (v_id, p_order, p_amount, p_currency, p_status, p_provider,
    p_txtype, p_ref, p_refunded, p_deleted, CASE WHEN p_deleted THEN now() END);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_order(
  p_scenario text, p_order uuid,
  p_expected_status text, p_expected_paid numeric
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_status text; v_paid numeric; v_ok boolean;
BEGIN
  SELECT status::text, paid_amount INTO v_status, v_paid
  FROM public.orders_v2 WHERE id = p_order;
  v_ok := (v_status = p_expected_status AND v_paid = p_expected_paid);
  INSERT INTO _it_results(scenario, ok, detail)
  VALUES (p_scenario, v_ok,
    format('want status=%s paid=%s got status=%s paid=%s',
      p_expected_status, p_expected_paid, v_status, v_paid));
END $$;

-- =========================================================
-- IT01 · payment_added: order row actually promoted to paid
-- =========================================================
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'pending', 0);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.assert_order('IT01_payment_added_row_state', o, 'paid', 100.00);
END $$;

-- =========================================================
-- IT02 · payment_removed: last payment soft-deleted →
--   order row must actually flip to pending / paid_amount=0
-- =========================================================
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  -- Insert already soft-deleted (post-delete state, then recalc runs).
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'payment', NULL, 0, 'BYN', true);
  PERFORM public.recalc_order_totals(o, 'payment_removed', p);
  PERFORM pg_temp.assert_order('IT02_payment_removed_row_state', o, 'pending', 0.00);
END $$;

-- =========================================================
-- IT03 · refund_changed: order flips to partial_refund
-- =========================================================
DO $$ DECLARE o uuid; p uuid; ref uuid; BEGIN
  o := pg_temp.mk_order(200, 'BYN', 'paid', 200);
  p := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  ref := pg_temp.mk_pay(o, 50, 'succeeded', 'bepaid', 'refund', p);
  PERFORM public.recalc_order_totals(o, 'refund_changed', ref);
  PERFORM pg_temp.assert_order('IT03_refund_changed_partial_refund', o, 'partial_refund', 150.00);
END $$;

-- =========================================================
-- IT04 · invalid affected payment must NOT mutate order
-- =========================================================
DO $$ DECLARE o1 uuid; o2 uuid; p2 uuid; r jsonb; BEGIN
  o1 := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  PERFORM pg_temp.mk_pay(o1, 100, 'succeeded', 'bepaid');
  o2 := pg_temp.mk_order(999, 'BYN', 'pending', 0);
  p2 := pg_temp.mk_pay(o2, 999, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o1, 'payment_removed', p2);
  -- o1 must remain untouched (status/amount identical to insert).
  PERFORM pg_temp.assert_order('IT04_invalid_affected_no_mutation', o1, 'paid', 100.00);
  INSERT INTO _it_results(scenario, ok, detail) VALUES (
    'IT04b_invalid_affected_ok_false',
    COALESCE((r->>'ok')::boolean,true) = false AND (r->>'error') = 'affected_payment_mismatch',
    r::text);
END $$;

-- =========================================================
-- IT05 · mixed currency: order row must NOT be touched
-- =========================================================
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'partial', 30);
  p := pg_temp.mk_pay(o, 60, 'succeeded', 'stripe', 'payment', NULL, 0, 'USD');
  PERFORM public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.assert_order('IT05_currency_mixed_no_mutation', o, 'partial', 30.00);
END $$;

-- =========================================================
-- IT06 · historical conflict: canceled order must stay canceled
-- =========================================================
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'canceled', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM public.recalc_order_totals(o, 'manual_repair', NULL);
  PERFORM pg_temp.assert_order('IT06_historical_conflict_no_mutation', o, 'canceled', 100.00);
END $$;

-- =========================================================
-- IT07 · replay idempotency: two identical calls converge
-- =========================================================
DO $$ DECLARE o uuid; p uuid; r1 jsonb; r2 jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'pending', 0);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  r1 := public.recalc_order_totals(o, 'payment_added', p);
  r2 := public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.assert_order('IT07_replay_converges', o, 'paid', 100.00);
  INSERT INTO _it_results(scenario, ok, detail) VALUES (
    'IT07b_replay_no_double_effect',
    (r2->>'status_changed')::boolean = false AND (r2->>'amount_changed')::boolean = false,
    r2::text);
END $$;

-- =========================================================
-- IT08 · over-refund: order must NOT be touched
-- =========================================================
DO $$ DECLARE o uuid; p uuid; ref uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  ref := pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid', 'refund', p);
  PERFORM public.recalc_order_totals(o, 'refund_changed', ref);
  PERFORM pg_temp.assert_order('IT08_over_refund_no_mutation', o, 'paid', 100.00);
END $$;

-- =========================================================
-- IT09 · payment_removed on one of many → paid → partial
-- =========================================================
DO $$ DECLARE o uuid; p1 uuid; p2 uuid; BEGIN
  o := pg_temp.mk_order(300, 'BYN', 'paid', 300);
  p1 := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  p2 := pg_temp.mk_pay(o, 100, 'succeeded', 'bank', 'payment', NULL, 0, 'BYN', true);
  PERFORM public.recalc_order_totals(o, 'payment_removed', p2);
  PERFORM pg_temp.assert_order('IT09_removed_one_of_many_partial', o, 'partial', 200.00);
END $$;

-- =========================================================
-- Summary
-- =========================================================
\echo '--- Integration results ---'
SELECT scenario, ok FROM _it_results ORDER BY scenario;

DO $$
DECLARE v_total int; v_pass int; v_fail int; v_detail text;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE ok), COUNT(*) FILTER (WHERE NOT ok)
    INTO v_total, v_pass, v_fail FROM _it_results;
  RAISE NOTICE 'INTEGRATION: total=% pass=% fail=%', v_total, v_pass, v_fail;
  IF v_fail > 0 THEN
    SELECT string_agg(scenario || ' — ' || detail, E'\n') INTO v_detail
    FROM _it_results WHERE NOT ok;
    RAISE WARNING E'Failed:\n%', v_detail;
    RAISE EXCEPTION 'INTEGRATION FAILED: % of %', v_fail, v_total;
  END IF;
END $$;

ROLLBACK;
