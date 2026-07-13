
CREATE OR REPLACE FUNCTION public.admin_payment_delete_execute_v1(
  p_actor_user_id uuid,
  p_operation_id  uuid,
  p_checksum      text,
  p_version       int,
  p_reason        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_op            public.payment_delete_operations%ROWTYPE;
  v_ids           uuid[];
  v_recomputed    text;
  v_recalc        jsonb;
  v_recalc_all    jsonb := '[]'::jsonb;
  v_order_ids     uuid[];
  v_pair          record;
  v_audit_before  jsonb;
  v_audit_after   jsonb;
  v_audit_id      uuid;
BEGIN
  SELECT * INTO v_op
  FROM public.payment_delete_operations
  WHERE id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'operation_not_found');
  END IF;
  IF v_op.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'operation_actor_mismatch');
  END IF;
  IF v_op.status <> 'preview' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'operation_not_pending', 'status', v_op.status);
  END IF;
  IF v_op.expires_at < now() THEN
    UPDATE public.payment_delete_operations SET status='expired', updated_at=now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'operation_expired');
  END IF;
  IF v_op.version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_mismatch', 'expected', v_op.version);
  END IF;

  v_ids := v_op.payment_ids;
  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR UPDATE;

  v_recomputed := public._payment_delete_checksum(v_ids, v_op.order_id, v_op.version);
  IF v_recomputed IS DISTINCT FROM v_op.checksum OR v_recomputed IS DISTINCT FROM p_checksum THEN
    UPDATE public.payment_delete_operations SET status='failed', updated_at=now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'checksum_mismatch',
      'stored', v_op.checksum, 'recomputed', v_recomputed, 'client', p_checksum);
  END IF;

  IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE id = ANY(v_ids) AND is_deleted = true) THEN
    UPDATE public.payment_delete_operations SET status='failed', updated_at=now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'already_deleted');
  END IF;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_audit_before
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  INSERT INTO public.payment_tombstones(
    original_payment_id, provider, external_id, order_id, amount, currency,
    payload_snapshot, checksum, operation_id, deleted_by, deleted_reason
  )
  SELECT p.id, p.provider, p.provider_payment_id, p.order_id, p.amount, p.currency,
         to_jsonb(p), v_op.checksum, v_op.id, p_actor_user_id,
         coalesce(nullif(trim(p_reason), ''), 'admin_manual_delete')
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  -- Collect (payment_id, order_id) pairs BEFORE soft-delete (recalc guard checks order_id match)
  -- We iterate AFTER soft-delete so compute_order_financial_state ignores them.
  UPDATE public.payments_v2 p
    SET is_deleted       = true,
        deleted_at       = now(),
        deleted_by       = p_actor_user_id,
        deleted_reason   = coalesce(nullif(trim(p_reason), ''), 'admin_manual_delete'),
        deletion_context = jsonb_build_object(
          'operation_id',   v_op.id,
          'operation_type', v_op.operation_type,
          'checksum',       v_op.checksum,
          'version',        v_op.version
        )
  WHERE p.id = ANY(v_ids);

  -- Recalc per affected (order_id, payment_id) pair. order_id preserved on soft-deleted rows.
  FOR v_pair IN
    SELECT p.id AS pid, p.order_id AS oid
    FROM public.payments_v2 p
    WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL
    ORDER BY p.order_id, p.id
  LOOP
    v_recalc := public.recalc_order_totals(v_pair.oid, 'payment_removed', v_pair.pid);
    v_recalc_all := v_recalc_all || jsonb_build_array(v_recalc);
  END LOOP;

  SELECT array_agg(DISTINCT p.order_id) INTO v_order_ids
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_audit_after
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, meta)
  VALUES (
    p_actor_user_id, 'admin_payment_delete_executed', 'user', 'payment',
    jsonb_build_object(
      'operation_id', v_op.id,
      'operation_type', v_op.operation_type,
      'payment_ids', v_ids,
      'order_ids', v_order_ids,
      'before', v_audit_before,
      'after',  v_audit_after,
      'recalc', v_recalc_all,
      'access_decisions', v_op.access_decisions,
      'manual_review_required', v_op.manual_review_required,
      'reason', p_reason
    )
  ) RETURNING id INTO v_audit_id;

  UPDATE public.payment_delete_operations
    SET status='consumed', consumed_at=now(), updated_at=now(), version = version + 1
  WHERE id = v_op.id;

  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', v_op.id,
    'deleted_payment_ids', v_ids,
    'affected_order_ids', v_order_ids,
    'recalc', v_recalc_all,
    'audit_log_id', v_audit_id,
    'manual_review_required', v_op.manual_review_required
  );
END;
$$;
