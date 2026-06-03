
CREATE OR REPLACE FUNCTION public.record_refund_atomic_multi(
  p_order_id uuid,
  p_parent_payment_id uuid,
  p_refund_amount numeric,
  p_refund_uid text,
  p_provider text,
  p_refund_reason text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL,
  p_provider_response jsonb DEFAULT '{}'::jsonb,
  p_meta_extra jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_parent RECORD;
  v_paid_sum numeric := 0;
  v_prior_refunded numeric := 0;
  v_total_refunded numeric;
  v_is_full boolean;
  v_refund_status text;
  v_new_order_status text;
  v_existing_refund RECORD;
  v_new_refund_id uuid;
  p RECORD;
  v_meta jsonb;
BEGIN
  -- Idempotency: scoped by (provider, provider_payment_id)
  SELECT id, order_id, amount, status, transaction_type
    INTO v_existing_refund
  FROM payments_v2
  WHERE provider = p_provider
    AND provider_payment_id = p_refund_uid
  LIMIT 1;

  IF v_existing_refund.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'refund_payment_id', v_existing_refund.id
    );
  END IF;

  SELECT * INTO v_parent FROM payments_v2 WHERE id = p_parent_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'parent_payment_not_found:%', p_parent_payment_id; END IF;

  SELECT * INTO v_order FROM orders_v2 WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found:%', p_order_id; END IF;

  FOR p IN SELECT * FROM payments_v2 WHERE order_id = p_order_id LOOP
    DECLARE
      pmeta_type text := lower(COALESCE(p.meta->>'type',''));
      ptx_type text := lower(COALESCE(p.transaction_type,''));
      pstatus text := lower(COALESCE(p.status::text,''));
      is_refund_row boolean;
    BEGIN
      is_refund_row := (ptx_type LIKE '%refund%' OR ptx_type LIKE '%возврат%'
        OR pmeta_type = 'refund' OR COALESCE(p.amount,0) < 0);
      IF NOT is_refund_row AND COALESCE(p.amount,0) > 0
         AND pstatus IN ('succeeded','paid','refunded') THEN
        v_paid_sum := v_paid_sum + p.amount;
      END IF;
      v_prior_refunded := v_prior_refunded + COALESCE(p.refunded_amount, 0);
      IF is_refund_row THEN
        v_prior_refunded := v_prior_refunded + ABS(COALESCE(p.amount,0));
      END IF;
    END;
  END LOOP;

  v_total_refunded := v_prior_refunded + p_refund_amount;
  v_is_full := CASE WHEN v_paid_sum > 0 THEN (v_total_refunded + 0.01 >= v_paid_sum) ELSE TRUE END;
  v_refund_status := CASE WHEN v_is_full THEN 'full' ELSE 'partial' END;
  v_new_order_status := CASE WHEN v_is_full THEN 'refunded' ELSE 'paid' END;

  INSERT INTO payments_v2 (
    order_id, profile_id, user_id, amount, currency, status,
    transaction_type, provider, provider_payment_id, paid_at, meta
  ) VALUES (
    p_order_id, v_order.profile_id, v_order.user_id, -p_refund_amount,
    v_order.currency, 'refunded', 'refund', p_provider, p_refund_uid, now(),
    jsonb_build_object(
      'type','refund',
      'parent_payment_id', v_parent.id,
      'parent_payment_uid', v_parent.provider_payment_id,
      'reason', p_refund_reason,
      'refund_status', v_refund_status,
      'provider', p_provider,
      'provider_response', p_provider_response
    ) || COALESCE(p_meta_extra, '{}'::jsonb)
  )
  RETURNING id INTO v_new_refund_id;

  UPDATE payments_v2
  SET refunded_amount = COALESCE(refunded_amount,0) + p_refund_amount,
      updated_at = now()
  WHERE id = v_parent.id;

  v_meta := COALESCE(v_order.meta, '{}'::jsonb) || jsonb_build_object(
    'refund_amount', p_refund_amount,
    'refund_reason', p_refund_reason,
    'refunded_at', now(),
    'refunded_by', p_actor_user_id,
    'provider', p_provider,
    'provider_refund', p_provider_response,
    'partial_refund_total', v_total_refunded,
    'paid_sum', v_paid_sum,
    'refund_status', v_refund_status
  );
  UPDATE orders_v2
  SET status = v_new_order_status::order_status,
      meta = v_meta,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO audit_logs (
    actor_user_id, target_user_id, actor_type, actor_label, action, meta
  ) VALUES (
    p_actor_user_id, p_target_user_id, 'system',
    'record_refund_atomic_multi[' || p_provider || ']',
    'payment.refund_recorded',
    jsonb_build_object(
      'provider', p_provider,
      'order_id', p_order_id,
      'order_number', v_order.order_number,
      'refund_amount', p_refund_amount,
      'refund_status', v_refund_status,
      'paid_sum', v_paid_sum,
      'total_refunded_after', v_total_refunded,
      'parent_payment_id', v_parent.id,
      'refund_uid', p_refund_uid,
      'new_order_status', v_new_order_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'refund_payment_id', v_new_refund_id,
    'refund_status', v_refund_status,
    'new_order_status', v_new_order_status,
    'paid_sum', v_paid_sum,
    'total_refunded_after', v_total_refunded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_refund_atomic_multi(uuid,uuid,numeric,text,text,text,uuid,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund_atomic_multi(uuid,uuid,numeric,text,text,text,uuid,uuid,jsonb,jsonb) TO service_role;

-- Backfill: уже-выпущенный Stripe refund re_3TeK3w6UYJj2vm0G1edu7CVV (EUR €2 на ORD-26-00141)
-- idempotent via lookup на provider+provider_payment_id внутри RPC
SELECT public.record_refund_atomic_multi(
  '0feb0660-c6da-47ac-9b1c-741d65f1aef4'::uuid,
  '5e47d99a-a25c-4119-8fed-85e03bc06857'::uuid,
  2.00::numeric,
  're_3TeK3w6UYJj2vm0G1edu7CVV',
  'stripe',
  'phase_2_runtime_partial_refund_test',
  NULL, NULL,
  jsonb_build_object('stripe', jsonb_build_object('charge_id','ch_phase2','account_code','stripe_poland','backfill_2026_06_03', true)),
  '{}'::jsonb
);
