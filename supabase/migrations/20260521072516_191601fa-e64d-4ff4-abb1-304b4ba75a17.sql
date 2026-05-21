CREATE OR REPLACE FUNCTION public.record_refund_atomic(p_order_id uuid, p_parent_payment_id uuid, p_refund_amount numeric, p_refund_uid text, p_refund_reason text, p_actor_user_id uuid, p_target_user_id uuid, p_bepaid_response jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_parent RECORD;
  v_paid_sum numeric := 0;
  v_prior_refunded numeric := 0;
  v_total_refunded numeric;
  v_is_full boolean;
  v_refund_status text;
  v_new_order_status text;
  v_existing_refund_id uuid;
  v_new_refund_id uuid;
  p RECORD;
  v_meta jsonb;
BEGIN
  -- Idempotency: if refund-row with same provider uid already exists, no-op
  SELECT id INTO v_existing_refund_id
  FROM payments_v2
  WHERE provider = 'bepaid'
    AND provider_payment_id = p_refund_uid
    AND COALESCE(transaction_type, '') = 'refund'
  LIMIT 1;

  IF v_existing_refund_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'refund_payment_id', v_existing_refund_id
    );
  END IF;

  -- Lock parent payment + order rows
  SELECT * INTO v_parent FROM payments_v2 WHERE id = p_parent_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_payment_not_found:%', p_parent_payment_id;
  END IF;

  SELECT * INTO v_order FROM orders_v2 WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found:%', p_order_id;
  END IF;

  -- Compute paid/refunded sums across order's payments
  FOR p IN SELECT * FROM payments_v2 WHERE order_id = p_order_id LOOP
    DECLARE
      pmeta_type text := lower(COALESCE(p.meta->>'type',''));
      ptx_type text := lower(COALESCE(p.transaction_type,''));
      -- PATCH-REFUND-SOT-RPC-RECOVERY-2026-05: cast enum -> text before COALESCE
      -- to avoid "invalid input value for enum payment_status: \"\"" during
      -- local variable initialization (Postgres infers COALESCE result type
      -- from first arg = enum, which forces cast of '' back to enum).
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

  -- Insert refund-row
  INSERT INTO payments_v2 (
    order_id, profile_id, user_id, amount, currency, status,
    transaction_type, provider, provider_payment_id, paid_at, meta
  ) VALUES (
    p_order_id, v_order.profile_id, v_order.user_id, -p_refund_amount,
    v_order.currency, 'refunded', 'refund', 'bepaid', p_refund_uid, now(),
    jsonb_build_object(
      'type','refund',
      'parent_payment_id', v_parent.id,
      'parent_payment_uid', v_parent.provider_payment_id,
      'reason', p_refund_reason,
      'refund_status', v_refund_status,
      'bepaid_response', p_bepaid_response
    )
  )
  RETURNING id INTO v_new_refund_id;

  -- Bump parent.refunded_amount
  UPDATE payments_v2
  SET refunded_amount = COALESCE(refunded_amount,0) + p_refund_amount,
      updated_at = now()
  WHERE id = v_parent.id;

  -- Update order
  v_meta := COALESCE(v_order.meta, '{}'::jsonb) || jsonb_build_object(
    'refund_amount', p_refund_amount,
    'refund_reason', p_refund_reason,
    'refunded_at', now(),
    'refunded_by', p_actor_user_id,
    'bepaid_refund', p_bepaid_response,
    'partial_refund_total', v_total_refunded,
    'paid_sum', v_paid_sum,
    'refund_status', v_refund_status
  );
  UPDATE orders_v2
  SET status = v_new_order_status,
      meta = v_meta,
      updated_at = now()
  WHERE id = p_order_id;

  -- Audit
  INSERT INTO audit_logs (
    actor_user_id, target_user_id, actor_type, actor_label, action, meta
  ) VALUES (
    p_actor_user_id, p_target_user_id, 'user',
    'subscription-admin-actions[refund]',
    'admin.subscription.refund_recorded',
    jsonb_build_object(
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
$function$;