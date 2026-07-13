-- ============================================================
-- PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1 · C2R · SQL Fixtures
-- Full transition matrix for compute_order_financial_state
-- and recalc_order_totals. Runs in a single transaction and
-- ROLLBACKs at the end. Exit code non-zero on any failure.
--
-- Usage:   psql -f supabase/tests/order_financial_recalc_fixtures.sql
-- ============================================================

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _fx_results (
  fixture text PRIMARY KEY,
  expected jsonb,
  actual   jsonb,
  passed   boolean
) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.mk_order(
  p_final numeric,
  p_currency text DEFAULT 'BYN',
  p_status  order_status DEFAULT 'pending',
  p_paid    numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders_v2(id, order_number, base_price, final_price, currency, status, paid_amount)
  VALUES (v_id, 'FX-'||substr(v_id::text,1,8), p_final, p_final, p_currency, p_status, p_paid);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mk_pay(
  p_order    uuid,
  p_amount   numeric,
  p_status   payment_status,
  p_provider text DEFAULT 'bepaid',
  p_txtype   text DEFAULT 'payment',
  p_ref      uuid DEFAULT NULL,
  p_refunded numeric DEFAULT 0,
  p_currency text DEFAULT 'BYN',
  p_deleted  boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.payments_v2(id, order_id, amount, currency, status, provider,
    transaction_type, reference_payment_id, refunded_amount, is_deleted, deleted_at)
  VALUES (v_id, p_order, p_amount, p_currency, p_status, p_provider,
    p_txtype, p_ref, p_refunded, p_deleted, CASE WHEN p_deleted THEN now() END);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.record(p_name text, p_expected jsonb, p_actual jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE ok boolean := true; k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(p_expected) LOOP
    IF (p_expected->k) IS DISTINCT FROM (p_actual->k) THEN
      ok := false;
    END IF;
  END LOOP;
  INSERT INTO _fx_results(fixture, expected, actual, passed) VALUES (p_name, p_expected, p_actual, ok);
END $$;

-- ============================================================
-- SECTION A · compute_order_financial_state (read arithmetic)
-- ============================================================

-- A01: single fully paid
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.record('A01_single_paid',
    '{"recommended_status":"paid","net_paid":100.00,"currency_mixed":false,"had_refunds":false,"refund_exceeds_parent":false}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A02: partial
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(200);
  PERFORM pg_temp.mk_pay(o, 80, 'succeeded', 'stripe');
  PERFORM pg_temp.record('A02_partial',
    '{"recommended_status":"partial","net_paid":80.00,"had_refunds":false}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A03: multi-payment paid
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(300);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 200, 'succeeded', 'bank');
  PERFORM pg_temp.record('A03_multi_paid',
    '{"recommended_status":"paid","net_paid":300.00,"active_parent_count":2}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A04: full refund via child
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(150);
  p := pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('A04_full_refund_child',
    '{"recommended_status":"refunded","net_paid":0.00,"had_refunds":true,"effective_refunds":150.00,"refund_exceeds_parent":false}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A05: refund via parent col fallback (no child row)
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(120);
  PERFORM pg_temp.mk_pay(o, 120, 'succeeded', 'stripe', 'payment', NULL, 120);
  PERFORM pg_temp.record('A05_refund_parent_col_full',
    '{"recommended_status":"refunded","net_paid":0.00,"effective_refunds":120.00}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A06: child rows AUTHORITATIVE over parent col (no GREATEST merge)
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(500);
  p := pg_temp.mk_pay(o, 500, 'succeeded', 'bepaid', 'payment', NULL, 500);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('A06_child_wins_over_parent',
    '{"effective_refunds":100.00,"net_paid":400.00,"recommended_status":"partial_refund"}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A07: soft-deleted payment ignored
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'rr', 'payment', NULL, 0, 'BYN', true);
  PERFORM pg_temp.record('A07_soft_deleted_ignored',
    '{"gross_paid":0.00,"net_paid":0.00,"active_parent_count":0}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A08: non-canonical provider ignored
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(200);
  PERFORM pg_temp.mk_pay(o, 200, 'succeeded', 'admin');
  PERFORM pg_temp.record('A08_non_canonical_ignored',
    '{"gross_paid":0.00,"active_parent_count":0,"ignored_non_canonical_count":1}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A09: mixed currency → net_paid null
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(300, 'BYN');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'stripe', 'payment', NULL, 0, 'USD');
  PERFORM pg_temp.record('A09_mixed_currency',
    '{"currency_mixed":true,"net_paid":null,"guard_reason":"currency_mixed","recommended_status":null}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A10: historical conflict (canceled)
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'canceled');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.record('A10_historical_conflict',
    '{"recommended_status":null,"guard_reason":"historical_conflict","current_status":"canceled"}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A11: no activity
DO $$ DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'pending');
  PERFORM pg_temp.mk_pay(o, 100, 'failed', 'bepaid');
  PERFORM pg_temp.record('A11_no_activity',
    '{"guard_reason":"no_activity","recommended_status":null,"succeeded_parent_count":0}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A12: partial refund uses partial_refund status (was partial in old model)
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(200);
  p := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 50, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('A12_partial_refund',
    '{"recommended_status":"partial_refund","net_paid":150.00,"had_refunds":true,"refund_exceeds_parent":false}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A13: over-refund → net_paid null, refund_exceeds_parent
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('A13_over_refund',
    '{"net_paid":null,"guard_reason":"refund_exceeds_parent","refund_exceeds_parent":true,"recommended_status":null}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A14: refund with mismatched provider → ignored
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'admin', 'refund', p);
  PERFORM pg_temp.record('A14_refund_bad_provider_ignored',
    '{"effective_refunds":0.00,"had_refunds":false,"recommended_status":"paid","net_paid":100.00}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A15: refund with mismatched currency → ignored
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN');
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'payment', NULL, 0, 'BYN');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'refund', p, 0, 'USD');
  PERFORM pg_temp.record('A15_refund_bad_currency_flags_mixed',
    '{"currency_mixed":false,"effective_refunds":0.00,"recommended_status":"paid"}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- A16: soft-deleted refund child ignored
DO $$ DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'refund', p, 0, 'BYN', true);
  PERFORM pg_temp.record('A16_refund_soft_deleted_ignored',
    '{"effective_refunds":0.00,"had_refunds":false,"recommended_status":"paid"}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ============================================================
-- SECTION B · recalc_order_totals (reason-aware matrix)
-- ============================================================

-- ---- payment_added ----

-- B01: payment_added: pending → paid ALLOWED
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'pending', 0);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.record('B01_added_pending_to_paid',
    '{"ok":true,"status_transition_allowed":true,"amount_update_allowed":true,"after_status":"paid","after_paid_amount":100.00,"transition_guard_reason":null,"amount_guard_reason":null}'::jsonb,
    r);
END $$;

-- B02: payment_added: paid → partial PROHIBITED (no-demote guard)
--   Simulate: order was paid at 200, a new smaller payment "added" but total is still under.
--   We construct: order.status=paid, paid_amount=200, but active payments only sum to 80.
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(200, 'BYN', 'paid', 200);
  p := pg_temp.mk_pay(o, 80, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.record('B02_added_paid_no_demote',
    '{"ok":true,"status_transition_allowed":false,"transition_guard_reason":"payment_added_no_demote","after_status":"paid","amount_update_allowed":true,"after_paid_amount":80.00}'::jsonb,
    r);
END $$;

-- B03: payment_added: paid → pending PROHIBITED
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(200, 'BYN', 'paid', 200);
  p := pg_temp.mk_pay(o, 200, 'failed', 'bepaid');
  r := public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.record('B03_added_paid_no_demote_pending',
    '{"ok":true,"status_transition_allowed":false,"after_status":"paid"}'::jsonb,
    r);
END $$;

-- B04: payment_added: same-status paid → paid amount update
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 90);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.record('B04_added_paid_amount_refresh',
    '{"ok":true,"status_transition_allowed":true,"amount_update_allowed":true,"after_status":"paid","after_paid_amount":100.00,"amount_changed":true}'::jsonb,
    r);
END $$;

-- B05: payment_added with wrong affected id (belongs to other order) → mismatch
DO $$ DECLARE o1 uuid; o2 uuid; p2 uuid; r jsonb; BEGIN
  o1 := pg_temp.mk_order(100);
  o2 := pg_temp.mk_order(100);
  p2 := pg_temp.mk_pay(o2, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o1, 'payment_added', p2);
  PERFORM pg_temp.record('B05_added_affected_mismatch',
    '{"ok":false,"error":"affected_payment_mismatch","guard_reason":"affected_payment_mismatch"}'::jsonb,
    r);
END $$;

-- B06: payment_added missing affected id → required
DO $$ DECLARE o uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100);
  r := public.recalc_order_totals(o, 'payment_added', NULL);
  PERFORM pg_temp.record('B06_added_affected_required',
    '{"ok":false,"error":"affected_payment_required","guard_reason":"affected_payment_mismatch"}'::jsonb,
    r);
END $$;

-- B07: payment_added with affected=refund row → mismatch
DO $$ DECLARE o uuid; p uuid; ref uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  ref := pg_temp.mk_pay(o, 50, 'succeeded', 'bepaid', 'refund', p);
  r := public.recalc_order_totals(o, 'payment_added', ref);
  PERFORM pg_temp.record('B07_added_refund_row_mismatch',
    '{"ok":false,"error":"affected_payment_mismatch"}'::jsonb, r);
END $$;

-- ---- payment_removed ----

-- B08: payment_removed: paid → pending when last payment soft-deleted
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'payment', NULL, 0, 'BYN', true);
  r := public.recalc_order_totals(o, 'payment_removed', p);
  PERFORM pg_temp.record('B08_removed_last_to_pending',
    '{"ok":true,"status_transition_allowed":true,"after_status":"pending","after_paid_amount":0.00,"status_changed":true,"amount_changed":true}'::jsonb,
    r);
END $$;

-- B09: payment_removed: paid → partial when one of many removed
DO $$ DECLARE o uuid; p1 uuid; p2 uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(300, 'BYN', 'paid', 300);
  p1 := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  p2 := pg_temp.mk_pay(o, 100, 'succeeded', 'bank', 'payment', NULL, 0, 'BYN', true);
  r := public.recalc_order_totals(o, 'payment_removed', p2);
  PERFORM pg_temp.record('B09_removed_paid_to_partial',
    '{"ok":true,"status_transition_allowed":true,"after_status":"partial","after_paid_amount":200.00}'::jsonb,
    r);
END $$;

-- B10: payment_removed with mismatched order → mismatch
DO $$ DECLARE o1 uuid; o2 uuid; p2 uuid; r jsonb; BEGIN
  o1 := pg_temp.mk_order(100);
  o2 := pg_temp.mk_order(100);
  p2 := pg_temp.mk_pay(o2, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o1, 'payment_removed', p2);
  PERFORM pg_temp.record('B10_removed_affected_mismatch',
    '{"ok":false,"error":"affected_payment_mismatch"}'::jsonb, r);
END $$;

-- ---- refund_changed ----

-- B11: refund_changed: paid → partial_refund
DO $$ DECLARE o uuid; p uuid; ref uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(200, 'BYN', 'paid', 200);
  p := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  ref := pg_temp.mk_pay(o, 50, 'succeeded', 'bepaid', 'refund', p);
  r := public.recalc_order_totals(o, 'refund_changed', ref);
  PERFORM pg_temp.record('B11_refund_paid_to_partial_refund',
    '{"ok":true,"status_transition_allowed":true,"after_status":"partial_refund","after_paid_amount":150.00}'::jsonb,
    r);
END $$;

-- B12: refund_changed: paid → refunded (full)
DO $$ DECLARE o uuid; p uuid; ref uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(200, 'BYN', 'paid', 200);
  p := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  ref := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid', 'refund', p);
  r := public.recalc_order_totals(o, 'refund_changed', ref);
  PERFORM pg_temp.record('B12_refund_paid_to_refunded',
    '{"ok":true,"after_status":"refunded","after_paid_amount":0.00}'::jsonb, r);
END $$;

-- B13: refund_changed with unrelated affected payment (no refund/refunded_amount) → mismatch
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'refund_changed', p);
  PERFORM pg_temp.record('B13_refund_bad_affected',
    '{"ok":false,"error":"affected_payment_mismatch"}'::jsonb, r);
END $$;

-- B14: refund_changed via parent.refunded_amount (no child row)
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'payment', NULL, 100);
  r := public.recalc_order_totals(o, 'refund_changed', p);
  PERFORM pg_temp.record('B14_refund_via_parent_col',
    '{"ok":true,"after_status":"refunded","after_paid_amount":0.00}'::jsonb, r);
END $$;

-- ---- manual_repair ----

-- B15: manual_repair with NULL affected allowed
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'partial', 50);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'manual_repair', NULL);
  PERFORM pg_temp.record('B15_manual_null_ok',
    '{"ok":true,"status_transition_allowed":true,"amount_update_allowed":true,"after_status":"paid","after_paid_amount":100.00}'::jsonb,
    r);
END $$;

-- ---- guards ----

-- B16: historical_conflict → no-op both columns
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'canceled', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'manual_repair', NULL);
  PERFORM pg_temp.record('B16_historical_conflict_noop',
    '{"ok":true,"status_transition_allowed":false,"amount_update_allowed":false,"after_status":"canceled","after_paid_amount":100.00,"transition_guard_reason":"historical_conflict","amount_guard_reason":"historical_conflict","status_changed":false,"amount_changed":false}'::jsonb,
    r);
END $$;

-- B17: currency_mixed → no-op both columns
DO $$ DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'partial', 30);
  p := pg_temp.mk_pay(o, 60, 'succeeded', 'stripe', 'payment', NULL, 0, 'USD');
  r := public.recalc_order_totals(o, 'payment_added', p);
  PERFORM pg_temp.record('B17_currency_mixed_noop',
    '{"ok":true,"status_transition_allowed":false,"amount_update_allowed":false,"transition_guard_reason":"currency_mixed","amount_guard_reason":"currency_mixed"}'::jsonb,
    r);
END $$;

-- B18: refund_exceeds_parent → no-op both columns
DO $$ DECLARE o uuid; p uuid; ref uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  ref := pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid', 'refund', p);
  r := public.recalc_order_totals(o, 'refund_changed', ref);
  PERFORM pg_temp.record('B18_refund_exceeds_parent_noop',
    '{"ok":true,"status_transition_allowed":false,"amount_update_allowed":false,"transition_guard_reason":"refund_exceeds_parent","amount_guard_reason":"refund_exceeds_parent"}'::jsonb,
    r);
END $$;

-- B19: invalid reason raises
DO $$ DECLARE o uuid; err text; BEGIN
  o := pg_temp.mk_order(100);
  BEGIN
    PERFORM public.recalc_order_totals(o, 'payment_deleted', NULL);
    err := 'no_error_raised';
  EXCEPTION WHEN OTHERS THEN
    err := 'raised';
  END;
  PERFORM pg_temp.record('B19_invalid_reason_raises',
    jsonb_build_object('_marker','raised'),
    jsonb_build_object('_marker', err));
END $$;

-- B20: same-status partial → partial amount update (payment_added)
DO $$ DECLARE o uuid; p uuid; p2 uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(200, 'BYN', 'partial', 50);
  p := pg_temp.mk_pay(o, 50, 'succeeded', 'bepaid');
  p2 := pg_temp.mk_pay(o, 80, 'succeeded', 'bepaid');
  r := public.recalc_order_totals(o, 'payment_added', p2);
  PERFORM pg_temp.record('B20_partial_same_status_amount',
    '{"ok":true,"status_transition_allowed":true,"amount_update_allowed":true,"after_status":"partial","after_paid_amount":130.00,"amount_changed":true}'::jsonb,
    r);
END $$;

-- ============================================================
-- Summary
-- ============================================================
\echo '--- Fixture results ---'
SELECT fixture, passed FROM _fx_results ORDER BY fixture;

DO $$
DECLARE
  v_total int; v_pass int; v_fail int;
  v_failed_rows text;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE passed), COUNT(*) FILTER (WHERE NOT passed)
  INTO v_total, v_pass, v_fail FROM _fx_results;
  RAISE NOTICE 'FIXTURES: total=% pass=% fail=%', v_total, v_pass, v_fail;
  IF v_fail > 0 THEN
    SELECT string_agg(fixture || E'\n  expected=' || expected::text || E'\n  actual=  ' || actual::text, E'\n')
      INTO v_failed_rows FROM _fx_results WHERE NOT passed;
    RAISE WARNING E'Failed:\n%', v_failed_rows;
    RAISE EXCEPTION 'FIXTURES FAILED: % of %', v_fail, v_total;
  END IF;
END $$;

ROLLBACK;
