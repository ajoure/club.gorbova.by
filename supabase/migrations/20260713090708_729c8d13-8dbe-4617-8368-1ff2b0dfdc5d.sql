
-- ============================================================
-- PATCH-PAYMENTS-MANAGEMENT-V2 · Stage 1
-- Canonical order financial state + safe recalc
-- ============================================================

-- Allowlist of canonical payment providers (used by helpers and callers)
CREATE OR REPLACE FUNCTION public.canonical_payment_providers()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY['bepaid','stripe','rr','bank']::text[]
$$;

REVOKE ALL ON FUNCTION public.canonical_payment_providers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.canonical_payment_providers() TO service_role, authenticated;

-- ------------------------------------------------------------
-- compute_order_financial_state(order_id)
--   Pure read function. Returns jsonb.
--
--   Rules:
--     * Considers only active payments (is_deleted=false, deleted_at IS NULL).
--     * Considers only canonical providers (bepaid|stripe|rr|bank).
--     * Non-canonical / legacy payments are counted as `ignored`,
--       they do not contribute to net_paid.
--     * Per-parent refund model:
--         if there are refund child rows (transaction_type='refund',
--         reference_payment_id=parent, status='succeeded') → use SUM of them
--         else fall back to parent.refunded_amount.
--       No GREATEST() merging of the two sources.
--     * Mixed currency: if any counted payment has currency != order.currency
--       → currency_mixed=true, net_paid=null, no status recommendation.
--     * Status recommendation:
--         - historical_conflict statuses (canceled, needs_mapping, lead)
--           → no recommendation (guard_reason='historical_conflict')
--         - net_paid >= final_price AND final_price > 0 → 'paid'
--         - net_paid > 0 AND net_paid < final_price       → 'partial'
--         - had refunds AND net_paid <= 0                 → 'refunded'
--         - net_paid <= 0 AND had no succeeded parents    → keep current
--           (guard_reason='no_activity')
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_order_financial_state(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order              orders_v2%ROWTYPE;
  v_canonical          text[] := public.canonical_payment_providers();
  v_final_price        numeric(10,2);
  v_order_currency     text;
  v_current_status     order_status;
  v_currency_mixed     boolean := false;
  v_ignored_count      integer := 0;
  v_active_parents     integer := 0;
  v_succeeded_parents  integer := 0;
  v_had_refunds        boolean := false;
  v_gross_paid         numeric(14,2) := 0;
  v_effective_refunds  numeric(14,2) := 0;
  v_net_paid           numeric(14,2) := 0;
  v_recommended_status order_status;
  v_guard_reason       text := NULL;
  v_result             jsonb;
BEGIN
  SELECT * INTO v_order FROM public.orders_v2 WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'order_not_found',
      'order_id', p_order_id
    );
  END IF;

  v_final_price    := COALESCE(v_order.final_price, 0);
  v_order_currency := UPPER(COALESCE(v_order.currency, 'BYN'));
  v_current_status := v_order.status;

  -- Count ignored (non-canonical / legacy) active payments for observability.
  SELECT COUNT(*) INTO v_ignored_count
  FROM public.payments_v2 p
  WHERE p.order_id = p_order_id
    AND p.is_deleted = false
    AND p.deleted_at IS NULL
    AND (p.provider IS NULL OR NOT (p.provider = ANY (v_canonical)));

  -- Detect currency mismatch among counted parent payments.
  SELECT EXISTS (
    SELECT 1
    FROM public.payments_v2 p
    WHERE p.order_id = p_order_id
      AND p.is_deleted = false
      AND p.deleted_at IS NULL
      AND p.provider = ANY (v_canonical)
      AND COALESCE(p.transaction_type,'payment') <> 'refund'
      AND UPPER(COALESCE(p.currency, v_order_currency)) <> v_order_currency
  ) INTO v_currency_mixed;

  -- Aggregate active succeeded parent payments (transaction_type != 'refund').
  SELECT
    COUNT(*) FILTER (WHERE p.status = 'succeeded'),
    COUNT(*),
    COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'succeeded'), 0)
  INTO v_succeeded_parents, v_active_parents, v_gross_paid
  FROM public.payments_v2 p
  WHERE p.order_id = p_order_id
    AND p.is_deleted = false
    AND p.deleted_at IS NULL
    AND p.provider = ANY (v_canonical)
    AND COALESCE(p.transaction_type,'payment') <> 'refund';

  -- Per-parent effective refund:
  --   child refund rows are authoritative when present; otherwise
  --   fall back to parent.refunded_amount. No GREATEST merge.
  WITH parents AS (
    SELECT
      p.id,
      p.amount,
      p.refunded_amount,
      p.status
    FROM public.payments_v2 p
    WHERE p.order_id = p_order_id
      AND p.is_deleted = false
      AND p.deleted_at IS NULL
      AND p.provider = ANY (v_canonical)
      AND COALESCE(p.transaction_type,'payment') <> 'refund'
  ),
  child_refunds AS (
    SELECT
      r.reference_payment_id AS parent_id,
      COALESCE(SUM(r.amount), 0) AS refunded_sum,
      COUNT(*) AS refund_rows
    FROM public.payments_v2 r
    WHERE r.reference_payment_id IN (SELECT id FROM parents)
      AND r.is_deleted = false
      AND r.deleted_at IS NULL
      AND COALESCE(r.transaction_type,'payment') = 'refund'
      AND r.status = 'succeeded'
    GROUP BY r.reference_payment_id
  ),
  per_parent AS (
    SELECT
      p.id,
      p.amount,
      p.status,
      CASE
        WHEN cr.refund_rows IS NOT NULL AND cr.refund_rows > 0
          THEN cr.refunded_sum
        ELSE COALESCE(p.refunded_amount, 0)
      END AS effective_refund
    FROM parents p
    LEFT JOIN child_refunds cr ON cr.parent_id = p.id
  )
  SELECT
    COALESCE(SUM(effective_refund) FILTER (WHERE status = 'succeeded'), 0),
    EXISTS (SELECT 1 FROM per_parent WHERE effective_refund > 0)
  INTO v_effective_refunds, v_had_refunds
  FROM per_parent;

  IF v_currency_mixed THEN
    v_net_paid           := NULL;
    v_recommended_status := NULL;
    v_guard_reason       := 'currency_mixed';
  ELSE
    v_net_paid := GREATEST(v_gross_paid - v_effective_refunds, 0);

    IF v_current_status IN ('canceled','needs_mapping','lead') THEN
      v_recommended_status := NULL;
      v_guard_reason       := 'historical_conflict';
    ELSIF v_succeeded_parents = 0 AND v_gross_paid = 0 THEN
      v_recommended_status := NULL;
      v_guard_reason       := 'no_activity';
    ELSIF v_had_refunds AND v_net_paid <= 0 THEN
      v_recommended_status := 'refunded'::order_status;
    ELSIF v_final_price > 0 AND v_net_paid >= v_final_price THEN
      v_recommended_status := 'paid'::order_status;
    ELSIF v_net_paid > 0 THEN
      v_recommended_status := 'partial'::order_status;
    ELSE
      v_recommended_status := NULL;
      v_guard_reason       := 'indeterminate';
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'currency', v_order_currency,
    'currency_mixed', v_currency_mixed,
    'final_price', v_final_price,
    'gross_paid', v_gross_paid,
    'effective_refunds', v_effective_refunds,
    'net_paid', v_net_paid,
    'had_refunds', v_had_refunds,
    'active_parent_count', v_active_parents,
    'succeeded_parent_count', v_succeeded_parents,
    'ignored_non_canonical_count', v_ignored_count,
    'current_status', v_current_status::text,
    'recommended_status',
      CASE WHEN v_recommended_status IS NULL
           THEN NULL
           ELSE v_recommended_status::text
      END,
    'guard_reason', v_guard_reason
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_order_financial_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_order_financial_state(uuid) TO service_role;

-- ------------------------------------------------------------
-- recalc_order_totals(order_id, reason, affected_payment_id)
--   Locks the order row FOR UPDATE, recomputes canonical state,
--   updates orders_v2.status and paid_amount, returns a diff jsonb.
--   Allowed reasons: payment_added | payment_removed | refund_changed | manual_repair
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_order_totals(
  p_order_id             uuid,
  p_reason               text,
  p_affected_payment_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed_reasons text[] := ARRAY['payment_added','payment_removed','refund_changed','manual_repair'];
  v_before_status   order_status;
  v_before_paid     numeric(10,2);
  v_state           jsonb;
  v_recommended     text;
  v_guard_reason    text;
  v_net_paid_num    numeric(14,2);
  v_new_status      order_status;
  v_new_paid        numeric(10,2);
  v_status_changed  boolean := false;
  v_amount_changed  boolean := false;
BEGIN
  IF p_reason IS NULL OR NOT (p_reason = ANY (v_allowed_reasons)) THEN
    RAISE EXCEPTION 'recalc_order_totals: invalid reason %', p_reason
      USING ERRCODE = '22023';
  END IF;

  -- Lock the order row for the duration of the transaction.
  SELECT status, paid_amount
  INTO v_before_status, v_before_paid
  FROM public.orders_v2
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'order_not_found',
      'order_id', p_order_id,
      'reason', p_reason,
      'affected_payment_id', p_affected_payment_id
    );
  END IF;

  -- Lock relevant payment rows in the same transaction so refund/parent
  -- writers cannot mutate the graph between compute and update.
  PERFORM 1
  FROM public.payments_v2 p
  WHERE p.order_id = p_order_id
  FOR UPDATE;

  v_state := public.compute_order_financial_state(p_order_id);

  IF NOT COALESCE((v_state->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', v_state->>'error',
      'order_id', p_order_id,
      'reason', p_reason,
      'affected_payment_id', p_affected_payment_id,
      'state', v_state
    );
  END IF;

  v_recommended  := v_state->>'recommended_status';
  v_guard_reason := v_state->>'guard_reason';

  IF (v_state->>'net_paid') IS NULL THEN
    v_net_paid_num := NULL;
  ELSE
    v_net_paid_num := (v_state->>'net_paid')::numeric;
  END IF;

  v_new_status := v_before_status;
  v_new_paid   := v_before_paid;

  -- Apply status update only if a recommendation exists (no historical_conflict / no_activity / currency_mixed / indeterminate).
  IF v_recommended IS NOT NULL THEN
    v_new_status := v_recommended::order_status;
  END IF;

  -- Apply paid_amount update only when we have a scalar net_paid.
  IF v_net_paid_num IS NOT NULL THEN
    v_new_paid := v_net_paid_num::numeric(10,2);
  END IF;

  v_status_changed := (v_new_status IS DISTINCT FROM v_before_status);
  v_amount_changed := (v_new_paid   IS DISTINCT FROM v_before_paid);

  IF v_status_changed OR v_amount_changed THEN
    UPDATE public.orders_v2
    SET status      = v_new_status,
        paid_amount = v_new_paid,
        updated_at  = now()
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'reason', p_reason,
    'affected_payment_id', p_affected_payment_id,
    'before_status', v_before_status::text,
    'after_status', v_new_status::text,
    'before_paid_amount', v_before_paid,
    'after_paid_amount', v_new_paid,
    'status_changed', v_status_changed,
    'amount_changed', v_amount_changed,
    'guard_reason', v_guard_reason,
    'state', v_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_order_totals(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.canonical_payment_providers() IS
  'Canonical payment provider allowlist: bepaid, stripe, rr, bank. PATCH-PAYMENTS-MANAGEMENT-V2.';

COMMENT ON FUNCTION public.compute_order_financial_state(uuid) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1. Pure read. Returns canonical financial state for orders_v2. Per-parent refund model, no GREATEST merge. Mixed currency → net_paid=null. Historical statuses (canceled/needs_mapping/lead) → no recommendation.';

COMMENT ON FUNCTION public.recalc_order_totals(uuid, text, uuid) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1. Locks orders_v2 row + payments_v2 rows FOR UPDATE, recomputes canonical state, updates status/paid_amount, returns diff. Allowed reasons: payment_added|payment_removed|refund_changed|manual_repair.';
