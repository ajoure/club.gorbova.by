-- ============================================================
-- PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1 · Fixtures
-- 14 SQL scenarios for compute_order_financial_state / recalc_order_totals.
-- Runs in a single transaction and ROLLBACKs at the end.
-- Usage:   psql -f supabase/tests/order_financial_recalc_fixtures.sql
-- Exit code is non-zero if any assertion fails.
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
  p_final numeric, p_currency text DEFAULT 'BYN', p_status order_status DEFAULT 'pending',
  p_paid numeric DEFAULT 0
) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.orders_v2(id, order_number, base_price, final_price, currency, status, paid_amount)
  VALUES (v_id, 'FX-'||substr(v_id::text,1,8), p_final, p_final, p_currency, p_status, p_paid);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.mk_pay(
  p_order uuid, p_amount numeric, p_status payment_status,
  p_provider text DEFAULT 'bepaid',
  p_txtype text DEFAULT 'payment',
  p_ref uuid DEFAULT NULL,
  p_refunded numeric DEFAULT 0,
  p_currency text DEFAULT 'BYN',
  p_deleted boolean DEFAULT false
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

-- ---------- Fixture 1: single fully-paid bepaid payment ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.record('01_single_paid',
    '{"recommended_status":"paid","net_paid":100.00,"currency_mixed":false,"had_refunds":false}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 2: partial payment ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(200);
  PERFORM pg_temp.mk_pay(o, 80, 'succeeded', 'stripe');
  PERFORM pg_temp.record('02_partial',
    '{"recommended_status":"partial","net_paid":80.00}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 3: multiple payments summing to paid ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(300);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 200, 'succeeded', 'bank');
  PERFORM pg_temp.record('03_multi_paid',
    '{"recommended_status":"paid","net_paid":300.00,"active_parent_count":2}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 4: refund via child row (authoritative) ----------
DO $$
DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(150);
  p := pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 150, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('04_refund_child',
    '{"recommended_status":"refunded","net_paid":0.00,"had_refunds":true,"effective_refunds":150.00}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 5: refund via parent.refunded_amount (fallback) ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(120);
  PERFORM pg_temp.mk_pay(o, 120, 'succeeded', 'stripe', 'payment', NULL, 120);
  PERFORM pg_temp.record('05_refund_parent_col',
    '{"recommended_status":"refunded","net_paid":0.00,"effective_refunds":120.00}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 6: child rows AUTHORITATIVE over parent col (no GREATEST) ----------
DO $$
DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(500);
  -- Parent claims 500 refunded, but the only succeeded child refund is 100.
  p := pg_temp.mk_pay(o, 500, 'succeeded', 'bepaid', 'payment', NULL, 500);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('06_child_wins_over_parent',
    '{"effective_refunds":100.00,"net_paid":400.00,"recommended_status":"partial"}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 7: soft-deleted payment ignored ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100);
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'rr', 'payment', NULL, 0, 'BYN', true);
  PERFORM pg_temp.record('07_soft_deleted_ignored',
    '{"gross_paid":0.00,"net_paid":0.00,"active_parent_count":0}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 8: non-canonical provider ignored ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(200);
  PERFORM pg_temp.mk_pay(o, 200, 'succeeded', 'admin');
  PERFORM pg_temp.record('08_non_canonical_ignored',
    '{"gross_paid":0.00,"active_parent_count":0,"ignored_non_canonical_count":1}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 9: mixed currency → net_paid null ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(300, 'BYN');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'stripe', 'payment', NULL, 0, 'USD');
  PERFORM pg_temp.record('09_mixed_currency',
    '{"currency_mixed":true,"net_paid":null,"guard_reason":"currency_mixed","recommended_status":null}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 10: historical conflict (canceled) → no recommendation ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'canceled');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.record('10_historical_conflict',
    '{"recommended_status":null,"guard_reason":"historical_conflict","current_status":"canceled"}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 11: no activity → no recommendation ----------
DO $$
DECLARE o uuid; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'pending');
  PERFORM pg_temp.mk_pay(o, 100, 'failed', 'bepaid');
  PERFORM pg_temp.record('11_no_activity',
    '{"guard_reason":"no_activity","recommended_status":null,"succeeded_parent_count":0}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 12: partial refund keeps status partial ----------
DO $$
DECLARE o uuid; p uuid; BEGIN
  o := pg_temp.mk_order(200);
  p := pg_temp.mk_pay(o, 200, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 50, 'succeeded', 'bepaid', 'refund', p);
  PERFORM pg_temp.record('12_partial_refund',
    '{"recommended_status":"partial","net_paid":150.00,"had_refunds":true}'::jsonb,
    public.compute_order_financial_state(o));
END $$;

-- ---------- Fixture 13: recalc_order_totals PAID(100) → REFUNDED(0), amount changes ----------
DO $$
DECLARE o uuid; p uuid; r jsonb; BEGIN
  o := pg_temp.mk_order(100, 'BYN', 'paid', 100);
  p := pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid');
  PERFORM pg_temp.mk_pay(o, 100, 'succeeded', 'bepaid', 'refund', p);
  r := public.recalc_order_totals(o, 'refund_changed', p);
  PERFORM pg_temp.record('13_recalc_paid_to_refunded',
    '{"ok":true,"before_status":"paid","after_status":"refunded","status_changed":true,"amount_changed":true,"before_paid_amount":100.00,"after_paid_amount":0.00}'::jsonb,
    r);
END $$;

-- ---------- Fixture 14: recalc rejects invalid reason ----------
DO $$
DECLARE o uuid; err text; BEGIN
  o := pg_temp.mk_order(100);
  BEGIN
    PERFORM public.recalc_order_totals(o, 'payment_deleted', NULL);
    err := 'no_error_raised';
  EXCEPTION WHEN OTHERS THEN
    err := 'raised';
  END;
  PERFORM pg_temp.record('14_recalc_rejects_bad_reason',
    jsonb_build_object('_marker','raised'),
    jsonb_build_object('_marker', err));
END $$;

-- ---------- Summary ----------
\echo '--- Fixture results ---'
SELECT fixture, passed FROM _fx_results ORDER BY fixture;

DO $$
DECLARE v_total int; v_pass int; v_fail int;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE passed), COUNT(*) FILTER (WHERE NOT passed)
  INTO v_total, v_pass, v_fail FROM _fx_results;
  RAISE NOTICE 'FIXTURES: total=% pass=% fail=%', v_total, v_pass, v_fail;
  IF v_fail > 0 THEN
    FOR v_total IN 1..1 LOOP
      RAISE WARNING 'Failed rows follow:';
    END LOOP;
    PERFORM (SELECT string_agg(fixture||' expected='||expected::text||' actual='||actual::text, E'\n') FROM _fx_results WHERE NOT passed);
    RAISE EXCEPTION 'FIXTURES FAILED: % of %', v_fail, v_total;
  END IF;
END $$;

ROLLBACK;
