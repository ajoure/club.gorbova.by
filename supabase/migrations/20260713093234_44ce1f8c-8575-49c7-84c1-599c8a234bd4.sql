
-- ============================================================
-- PATCH-PAYMENTS-MANAGEMENT-V2 · Stage 1 · C2R
-- Reason-aware transition matrix, affected-payment validation,
-- refund anomaly guards, partial_refund semantics.
-- ============================================================

-- 1. Extend order_status enum with partial_refund (idempotent).
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'partial_refund';

-- 2. compute_order_financial_state
--    Tightened refund-child scope, over-refund guard, partial_refund status.
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
  v_refund_exceeds     boolean := false;
  v_recommended_text   text := NULL;
  v_guard_reason       text := NULL;
BEGIN
  SELECT * INTO v_order FROM public.orders_v2 WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found', 'order_id', p_order_id);
  END IF;

  v_final_price    := COALESCE(v_order.final_price, 0);
  v_order_currency := UPPER(COALESCE(v_order.currency, 'BYN'));
  v_current_status := v_order.status;

  SELECT COUNT(*) INTO v_ignored_count
  FROM public.payments_v2 p
  WHERE p.order_id = p_order_id
    AND p.is_deleted = false
    AND p.deleted_at IS NULL
    AND (p.provider IS NULL OR NOT (p.provider = ANY (v_canonical)));

  SELECT EXISTS (
    SELECT 1 FROM public.payments_v2 p
    WHERE p.order_id = p_order_id
      AND p.is_deleted = false
      AND p.deleted_at IS NULL
      AND p.provider = ANY (v_canonical)
      AND COALESCE(p.transaction_type,'payment') <> 'refund'
      AND UPPER(COALESCE(p.currency, v_order_currency)) <> v_order_currency
  ) INTO v_currency_mixed;

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

  -- Per-parent refund with STRICT scope:
  --   refund.order_id = parent.order_id (== p_order_id)
  --   refund.provider ∈ canonical
  --   refund.currency = parent.currency AND = order.currency
  --   refund.status = 'succeeded'
  --   NOT deleted
  -- Over-refund on any parent → guard: refund_exceeds_parent.
  WITH parents AS (
    SELECT p.id, p.amount, p.refunded_amount, p.status,
           UPPER(COALESCE(p.currency, v_order_currency)) AS parent_currency
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
    JOIN parents pr ON pr.id = r.reference_payment_id
    WHERE r.order_id = p_order_id
      AND r.is_deleted = false
      AND r.deleted_at IS NULL
      AND r.provider = ANY (v_canonical)
      AND COALESCE(r.transaction_type,'payment') = 'refund'
      AND r.status = 'succeeded'
      AND UPPER(COALESCE(r.currency, v_order_currency)) = v_order_currency
      AND UPPER(COALESCE(r.currency, v_order_currency)) = pr.parent_currency
    GROUP BY r.reference_payment_id
  ),
  per_parent AS (
    SELECT
      p.id, p.amount, p.status,
      CASE
        WHEN cr.refund_rows IS NOT NULL AND cr.refund_rows > 0 THEN cr.refunded_sum
        ELSE COALESCE(p.refunded_amount, 0)
      END AS effective_refund
    FROM parents p
    LEFT JOIN child_refunds cr ON cr.parent_id = p.id
  )
  SELECT
    COALESCE(SUM(effective_refund) FILTER (WHERE status = 'succeeded'), 0),
    EXISTS (SELECT 1 FROM per_parent WHERE effective_refund > 0),
    EXISTS (SELECT 1 FROM per_parent WHERE effective_refund > amount + 0.005)
  INTO v_effective_refunds, v_had_refunds, v_refund_exceeds
  FROM per_parent;

  IF v_currency_mixed THEN
    v_recommended_text := NULL;
    v_guard_reason     := 'currency_mixed';
    RETURN jsonb_build_object(
      'ok', true, 'order_id', v_order.id, 'currency', v_order_currency,
      'currency_mixed', true, 'final_price', v_final_price,
      'gross_paid', v_gross_paid, 'effective_refunds', v_effective_refunds,
      'net_paid', NULL, 'had_refunds', v_had_refunds,
      'active_parent_count', v_active_parents,
      'succeeded_parent_count', v_succeeded_parents,
      'ignored_non_canonical_count', v_ignored_count,
      'current_status', v_current_status::text,
      'recommended_status', NULL, 'guard_reason', v_guard_reason,
      'refund_exceeds_parent', v_refund_exceeds
    );
  END IF;

  IF v_refund_exceeds THEN
    RETURN jsonb_build_object(
      'ok', true, 'order_id', v_order.id, 'currency', v_order_currency,
      'currency_mixed', false, 'final_price', v_final_price,
      'gross_paid', v_gross_paid, 'effective_refunds', v_effective_refunds,
      'net_paid', NULL, 'had_refunds', v_had_refunds,
      'active_parent_count', v_active_parents,
      'succeeded_parent_count', v_succeeded_parents,
      'ignored_non_canonical_count', v_ignored_count,
      'current_status', v_current_status::text,
      'recommended_status', NULL,
      'guard_reason', 'refund_exceeds_parent',
      'refund_exceeds_parent', true
    );
  END IF;

  v_net_paid := GREATEST(v_gross_paid - v_effective_refunds, 0);

  IF v_current_status IN ('canceled','needs_mapping','lead') THEN
    v_recommended_text := NULL;
    v_guard_reason     := 'historical_conflict';
  ELSIF v_succeeded_parents = 0 AND v_gross_paid = 0 THEN
    v_recommended_text := NULL;
    v_guard_reason     := 'no_activity';
  ELSIF v_had_refunds AND v_net_paid <= 0 THEN
    v_recommended_text := 'refunded';
  ELSIF v_had_refunds AND v_final_price > 0 AND v_net_paid < v_final_price THEN
    -- Partial refund: paid something, refunded something, remainder < final_price.
    v_recommended_text := 'partial_refund';
  ELSIF v_final_price > 0 AND v_net_paid >= v_final_price THEN
    v_recommended_text := 'paid';
  ELSIF v_net_paid > 0 THEN
    v_recommended_text := 'partial';
  ELSE
    v_recommended_text := NULL;
    v_guard_reason     := 'indeterminate';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'order_id', v_order.id, 'currency', v_order_currency,
    'currency_mixed', false, 'final_price', v_final_price,
    'gross_paid', v_gross_paid, 'effective_refunds', v_effective_refunds,
    'net_paid', v_net_paid, 'had_refunds', v_had_refunds,
    'active_parent_count', v_active_parents,
    'succeeded_parent_count', v_succeeded_parents,
    'ignored_non_canonical_count', v_ignored_count,
    'current_status', v_current_status::text,
    'recommended_status', v_recommended_text,
    'guard_reason', v_guard_reason,
    'refund_exceeds_parent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_order_financial_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_order_financial_state(uuid) TO service_role;

-- 3. recalc_order_totals — reason-aware transition matrix,
--    affected-payment validation, independent status/amount updates.
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
  v_transition_ok   boolean := false;
  v_amount_ok       boolean := false;
  v_transition_guard text := NULL;
  v_amount_guard    text := NULL;

  v_affected        public.payments_v2%ROWTYPE;
  v_affected_found  boolean := false;
  v_txtype          text;
BEGIN
  IF p_reason IS NULL OR NOT (p_reason = ANY (v_allowed_reasons)) THEN
    RAISE EXCEPTION 'recalc_order_totals: invalid reason %', p_reason
      USING ERRCODE = '22023';
  END IF;

  -- Lock order row.
  SELECT status, paid_amount INTO v_before_status, v_before_paid
  FROM public.orders_v2 WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', 'order_not_found',
      'order_id', p_order_id, 'reason', p_reason,
      'affected_payment_id', p_affected_payment_id
    );
  END IF;

  -- Affected-payment validation & lock (mandatory for non-manual_repair reasons).
  IF p_reason <> 'manual_repair' THEN
    IF p_affected_payment_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'affected_payment_required',
        'order_id', p_order_id, 'reason', p_reason,
        'affected_payment_id', NULL,
        'guard_reason', 'affected_payment_mismatch'
      );
    END IF;

    SELECT * INTO v_affected
    FROM public.payments_v2
    WHERE id = p_affected_payment_id
    FOR UPDATE;
    v_affected_found := FOUND;

    IF NOT v_affected_found OR v_affected.order_id IS DISTINCT FROM p_order_id THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'affected_payment_mismatch',
        'order_id', p_order_id, 'reason', p_reason,
        'affected_payment_id', p_affected_payment_id,
        'guard_reason', 'affected_payment_mismatch'
      );
    END IF;

    v_txtype := COALESCE(v_affected.transaction_type, 'payment');

    -- Reason-relevance: affected row must match reason semantics.
    IF p_reason = 'payment_added' AND v_txtype = 'refund' THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'affected_payment_mismatch',
        'order_id', p_order_id, 'reason', p_reason,
        'affected_payment_id', p_affected_payment_id,
        'guard_reason', 'affected_payment_mismatch',
        'detail', 'payment_added requires parent payment row'
      );
    END IF;

    IF p_reason = 'refund_changed' AND v_txtype <> 'refund' AND COALESCE(v_affected.refunded_amount,0) = 0 THEN
      RETURN jsonb_build_object(
        'ok', false, 'error', 'affected_payment_mismatch',
        'order_id', p_order_id, 'reason', p_reason,
        'affected_payment_id', p_affected_payment_id,
        'guard_reason', 'affected_payment_mismatch',
        'detail', 'refund_changed requires refund row or parent with refunded_amount'
      );
    END IF;
  END IF;

  -- Lock the full payment graph for the order.
  PERFORM 1 FROM public.payments_v2 p WHERE p.order_id = p_order_id FOR UPDATE;

  v_state := public.compute_order_financial_state(p_order_id);
  IF NOT COALESCE((v_state->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'ok', false, 'error', v_state->>'error',
      'order_id', p_order_id, 'reason', p_reason,
      'affected_payment_id', p_affected_payment_id, 'state', v_state
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

  -- ---------- reason-aware transition matrix ----------
  --
  -- payment_added:
  --   pending → paid                              ALLOWED
  --   paid    → partial|pending                   PROHIBITED (never demote on add)
  --   same-status amount update                   ALLOWED
  -- payment_removed:
  --   paid    → partial|pending                   ALLOWED (demotion is the point)
  --   partial → pending                           ALLOWED
  --   no_activity guard → force pending (only if net_paid=0)  ALLOWED
  -- refund_changed:
  --   any     → refunded|partial_refund|partial   ALLOWED (recommendation drives)
  -- manual_repair:
  --   explicit controlled transition               ALLOWED
  -- historical_conflict / currency_mixed / refund_exceeds_parent:
  --   status no-op; amount no-op unless allowed
  -- ------------------------------------------------------

  -- Default: transition disallowed until we prove otherwise.
  v_transition_ok := false;
  v_amount_ok     := false;

  -- Currency mixed / refund_exceeds_parent → hard no-op for both columns.
  IF v_guard_reason IN ('currency_mixed','refund_exceeds_parent') THEN
    v_transition_guard := v_guard_reason;
    v_amount_guard     := v_guard_reason;

  ELSIF v_guard_reason = 'historical_conflict' THEN
    -- Never mutate historical status; amount update also blocked
    -- to avoid drifting canceled/lead orders.
    v_transition_guard := 'historical_conflict';
    v_amount_guard     := 'historical_conflict';

  ELSIF p_reason = 'manual_repair' THEN
    v_transition_ok := (v_recommended IS NOT NULL);
    v_amount_ok     := (v_net_paid_num IS NOT NULL);
    IF NOT v_transition_ok THEN v_transition_guard := COALESCE(v_guard_reason,'no_recommendation'); END IF;
    IF NOT v_amount_ok     THEN v_amount_guard     := COALESCE(v_guard_reason,'no_net_paid'); END IF;

  ELSIF p_reason = 'payment_added' THEN
    -- Amount always safe to refresh.
    v_amount_ok := (v_net_paid_num IS NOT NULL);
    IF NOT v_amount_ok THEN v_amount_guard := COALESCE(v_guard_reason,'no_net_paid'); END IF;
    -- Status transition: only promote toward paid; never demote paid.
    IF v_recommended IS NULL THEN
      v_transition_guard := COALESCE(v_guard_reason,'no_recommendation');
    ELSIF v_before_status = 'paid' AND v_recommended IN ('partial','pending') THEN
      v_transition_guard := 'payment_added_no_demote';
    ELSIF v_recommended IN ('paid','partial_refund','refunded') THEN
      v_transition_ok := true;
    ELSIF v_recommended = 'partial' AND v_before_status IN ('pending','draft','partial') THEN
      v_transition_ok := true;
    ELSE
      v_transition_guard := 'payment_added_no_demote';
    END IF;

  ELSIF p_reason = 'payment_removed' THEN
    v_amount_ok := (v_net_paid_num IS NOT NULL);
    IF NOT v_amount_ok THEN v_amount_guard := COALESCE(v_guard_reason,'no_net_paid'); END IF;
    -- Removal must be able to demote paid → partial/pending AND net_paid → 0.
    IF v_recommended IS NOT NULL THEN
      v_transition_ok := true;
    ELSIF v_guard_reason = 'no_activity' AND COALESCE(v_net_paid_num,0) = 0 THEN
      -- Last payment removed → drop back to pending.
      v_new_status := 'pending'::order_status;
      v_transition_ok := true;
    ELSE
      v_transition_guard := COALESCE(v_guard_reason,'no_recommendation');
    END IF;

  ELSIF p_reason = 'refund_changed' THEN
    v_amount_ok := (v_net_paid_num IS NOT NULL);
    IF NOT v_amount_ok THEN v_amount_guard := COALESCE(v_guard_reason,'no_net_paid'); END IF;
    IF v_recommended IS NOT NULL THEN
      v_transition_ok := true;
    ELSE
      v_transition_guard := COALESCE(v_guard_reason,'no_recommendation');
    END IF;
  END IF;

  -- Apply recommendation into v_new_status if not already set (payment_removed no_activity path).
  IF v_transition_ok AND v_recommended IS NOT NULL THEN
    v_new_status := v_recommended::order_status;
  END IF;

  IF v_amount_ok THEN
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
    'status_transition_allowed', v_transition_ok,
    'amount_update_allowed', v_amount_ok,
    'transition_guard_reason', v_transition_guard,
    'amount_guard_reason', v_amount_guard,
    'guard_reason', v_guard_reason,
    'state', v_state
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_order_totals(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_order_totals(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.compute_order_financial_state(uuid) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1 C2R. Per-parent refund model with strict scope (order_id/provider/currency/status/deleted). Over-refund → net_paid=null guard_reason=refund_exceeds_parent. partial_refund status when had_refunds AND net_paid<final_price. Historical statuses & currency_mixed → no recommendation.';

COMMENT ON FUNCTION public.recalc_order_totals(uuid, text, uuid) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 1 C2R. Reason-aware transition matrix (payment_added|payment_removed|refund_changed|manual_repair). Affected-payment validated & locked (NULL only for manual_repair). Independent status_transition_allowed / amount_update_allowed with per-column guard reasons. payment_removed handles last-payment removal → pending.';
