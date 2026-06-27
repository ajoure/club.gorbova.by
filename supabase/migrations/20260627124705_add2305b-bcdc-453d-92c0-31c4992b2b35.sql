
CREATE OR REPLACE FUNCTION public.convert_preorder_on_pay_atomic(p_paid_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid        record;
  v_preorder    record;
  v_matched_by  text;
  v_others_cnt  integer := 0;
  v_prereg_id   uuid;
  v_prereg_res  text := 'not_found';
  v_window      interval := interval '90 days';
BEGIN
  -- 1. Load paid order with lock
  SELECT id, status, customer_email, user_id, product_id, meta, created_at
    INTO v_paid
    FROM public.orders_v2
   WHERE id = p_paid_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_order_not_found');
  END IF;

  IF v_paid.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_order_not_paid');
  END IF;

  IF COALESCE(v_paid.meta->>'is_preorder','false') = 'true' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_order_is_preorder');
  END IF;

  IF v_paid.product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_order_no_product');
  END IF;

  IF v_paid.customer_email IS NULL AND v_paid.user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'paid_order_no_identity');
  END IF;

  -- 2. Idempotency early exit
  IF v_paid.meta ? 'converted_from_preorder_id' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'noop', true,
      'reason', 'already_converted',
      'preorder_order_id', v_paid.meta->>'converted_from_preorder_id'
    );
  END IF;

  -- 3. Find preorder: user_id first
  IF v_paid.user_id IS NOT NULL THEN
    SELECT id, meta, created_at
      INTO v_preorder
      FROM public.orders_v2
     WHERE status = 'draft'
       AND product_id = v_paid.product_id
       AND COALESCE(meta->>'is_preorder','false') = 'true'
       AND NOT (meta ? 'converted_to_order_id')
       AND user_id = v_paid.user_id
       AND created_at <= v_paid.created_at
       AND created_at >= v_paid.created_at - v_window
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
      v_matched_by := 'user_id';
    END IF;
  END IF;

  -- fallback: email
  IF v_matched_by IS NULL AND v_paid.customer_email IS NOT NULL THEN
    SELECT id, meta, created_at
      INTO v_preorder
      FROM public.orders_v2
     WHERE status = 'draft'
       AND product_id = v_paid.product_id
       AND COALESCE(meta->>'is_preorder','false') = 'true'
       AND NOT (meta ? 'converted_to_order_id')
       AND lower(customer_email) = lower(v_paid.customer_email)
       AND created_at <= v_paid.created_at
       AND created_at >= v_paid.created_at - v_window
     ORDER BY created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  IF v_matched_by IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'reason', 'no_matching_preorder');
  END IF;

  -- 4. Race-guard
  IF v_preorder.meta ? 'converted_to_order_id' THEN
    RETURN jsonb_build_object('ok', true, 'noop', true, 'reason', 'preorder_already_converted');
  END IF;

  -- count other matching preorders (informational, not modified)
  SELECT count(*)::int INTO v_others_cnt
    FROM public.orders_v2
   WHERE status = 'draft'
     AND product_id = v_paid.product_id
     AND COALESCE(meta->>'is_preorder','false') = 'true'
     AND NOT (meta ? 'converted_to_order_id')
     AND id <> v_preorder.id
     AND (
       (v_paid.user_id IS NOT NULL AND user_id = v_paid.user_id)
       OR (v_paid.customer_email IS NOT NULL AND lower(customer_email) = lower(v_paid.customer_email))
     )
     AND created_at <= v_paid.created_at
     AND created_at >= v_paid.created_at - v_window;

  -- 5. Atomic linkage writes
  UPDATE public.orders_v2
     SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                  'converted_to_order_id', p_paid_order_id::text,
                  'converted_at', to_jsonb(now())
                ),
         updated_at = now()
   WHERE id = v_preorder.id;

  UPDATE public.orders_v2
     SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                  'converted_from_preorder_id', v_preorder.id::text,
                  'converted_at', to_jsonb(now())
                ),
         updated_at = now()
   WHERE id = p_paid_order_id;

  -- 6. Best-effort course_preregistrations update
  v_prereg_id := NULLIF(v_preorder.meta->>'preregistration_id','')::uuid;
  IF v_prereg_id IS NOT NULL THEN
    BEGIN
      UPDATE public.course_preregistrations
         SET status = 'converted',
             updated_at = now(),
             meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
                      'converted_to_order_id', p_paid_order_id::text,
                      'converted_at', to_jsonb(now())
                    )
       WHERE id = v_prereg_id
         AND status <> 'converted';

      IF FOUND THEN
        v_prereg_res := 'ok';
      ELSE
        v_prereg_res := 'noop_or_missing';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_prereg_res := 'failed';
      BEGIN
        INSERT INTO public.audit_logs (action, actor_id, meta)
        VALUES (
          'preorder.convert_on_pay.preregistration_update_failed',
          NULL,
          jsonb_build_object(
            'paid_order_id', p_paid_order_id,
            'preorder_order_id', v_preorder.id,
            'preregistration_id', v_prereg_id,
            'error', SQLERRM
          )
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END IF;

  -- 7. Audit on first successful conversion
  BEGIN
    INSERT INTO public.audit_logs (action, actor_id, meta)
    VALUES (
      'preorder.convert_on_pay',
      NULL,
      jsonb_build_object(
        'paid_order_id', p_paid_order_id,
        'preorder_order_id', v_preorder.id,
        'matched_by', v_matched_by,
        'preregistration_update', v_prereg_res,
        'other_matching_preorders_count', v_others_cnt,
        'window_days', 90
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'noop', false,
    'preorder_order_id', v_preorder.id,
    'paid_order_id', p_paid_order_id,
    'matched_by', v_matched_by,
    'preregistration_update', v_prereg_res,
    'other_matching_preorders_count', v_others_cnt
  );
END;
$$;

-- Lock down execution
REVOKE ALL ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.convert_preorder_on_pay_atomic(uuid) TO service_role;

-- Indices to keep the matcher fast
CREATE INDEX IF NOT EXISTS idx_orders_v2_preorder_match_user
  ON public.orders_v2 (product_id, user_id, created_at)
  WHERE status = 'draft' AND (meta->>'is_preorder') = 'true';

CREATE INDEX IF NOT EXISTS idx_orders_v2_preorder_match_email
  ON public.orders_v2 (product_id, lower(customer_email), created_at)
  WHERE status = 'draft' AND (meta->>'is_preorder') = 'true';
