
-- Stage 4 hotfix: rename external_id → provider_payment_id in preview & tombstone insert.
CREATE OR REPLACE FUNCTION public.admin_payment_delete_preview_v1(
  p_actor_user_id uuid,
  p_mode          text,
  p_payment_ids   uuid[],
  p_order_id      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids          uuid[];
  v_order_id     uuid := p_order_id;
  v_before       jsonb;
  v_predicted    jsonb;
  v_access       jsonb;
  v_op_id        uuid;
  v_checksum     text;
  v_expires      timestamptz;
  v_manual       boolean := false;
  v_ledger_total int;
BEGIN
  IF p_mode NOT IN ('payment_only','order_with_all_linked_payments') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;

  IF p_mode = 'order_with_all_linked_payments' THEN
    IF v_order_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'order_id_required');
    END IF;
    SELECT array_agg(p.id ORDER BY p.id) INTO v_ids
    FROM public.payments_v2 p
    WHERE p.order_id = v_order_id AND p.is_deleted = false;
    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_payments_for_order');
    END IF;
  ELSE
    IF p_payment_ids IS NULL OR array_length(p_payment_ids, 1) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_ids_required');
    END IF;
    SELECT array_agg(id ORDER BY id) INTO v_ids
    FROM public.payments_v2
    WHERE id = ANY(p_payment_ids) AND is_deleted = false;
    IF v_ids IS NULL
       OR array_length(v_ids, 1) IS DISTINCT FROM array_length(p_payment_ids, 1)
    THEN
      RETURN jsonb_build_object('ok', false, 'error', 'some_payments_missing_or_deleted');
    END IF;
  END IF;

  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR SHARE;

  SELECT jsonb_agg(jsonb_build_object(
    'payment_id',          p.id,
    'provider',            p.provider,
    'origin',              p.origin,
    'status',              p.status,
    'amount',              p.amount,
    'currency',            p.currency,
    'order_id',            p.order_id,
    'profile_id',          p.profile_id,
    'provider_payment_id', p.provider_payment_id,
    'paid_at',             p.paid_at
  ) ORDER BY p.id)
  INTO v_before
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids);

  SELECT jsonb_agg(jsonb_build_object(
    'payment_id',             p.id,
    'order_id',               p.order_id,
    'access_revoke',          false,
    'manual_review_required', (l_count > 0),
    'ledger_rows',            l_count,
    'reason',                 CASE
                                WHEN p.order_id IS NULL THEN 'no_order_no_lineage'
                                WHEN l_count = 0        THEN 'no_ledger_grants'
                                ELSE                         'ambiguous_lineage_manual_review'
                              END
  ) ORDER BY p.id)
  INTO v_access
  FROM public.payments_v2 p
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS l_count
    FROM public.access_grant_ledger l
    WHERE l.order_id = p.order_id
  ) lc ON true
  WHERE p.id = ANY(v_ids);

  SELECT count(*) INTO v_ledger_total
  FROM public.access_grant_ledger l
  WHERE l.order_id IN (
    SELECT DISTINCT p.order_id FROM public.payments_v2 p
    WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL
  );
  v_manual := v_ledger_total > 0;

  SELECT jsonb_agg(jsonb_build_object(
    'order_id',           o.id,
    'before_status',      o.status::text,
    'before_paid_amount', o.paid_amount,
    'currency',           o.currency,
    'note',               'exact after-state computed at execute time via recalc_order_totals(payment_removed)'
  ) ORDER BY o.id)
  INTO v_predicted
  FROM public.orders_v2 o
  WHERE o.id IN (
    SELECT DISTINCT p.order_id FROM public.payments_v2 p
    WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL
  );

  v_checksum := public._payment_delete_checksum(v_ids, v_order_id, 1);
  v_expires  := now() + interval '10 minutes';

  INSERT INTO public.payment_delete_operations(
    actor_user_id, operation_type, payment_ids, order_id,
    version, checksum, before_state, predicted_after, access_decisions,
    manual_review_required, status, expires_at
  ) VALUES (
    p_actor_user_id, p_mode, v_ids, v_order_id,
    1, v_checksum, v_before,
    coalesce(v_predicted, '[]'::jsonb),
    coalesce(v_access,    '[]'::jsonb),
    v_manual, 'preview', v_expires
  ) RETURNING id INTO v_op_id;

  RETURN jsonb_build_object(
    'ok',                     true,
    'operation_id',           v_op_id,
    'operation_type',         p_mode,
    'version',                1,
    'checksum',               v_checksum,
    'expires_at',             v_expires,
    'payment_ids',            v_ids,
    'order_id',               v_order_id,
    'before_state',           v_before,
    'predicted_after',        coalesce(v_predicted, '[]'::jsonb),
    'access_decisions',       coalesce(v_access,    '[]'::jsonb),
    'manual_review_required', v_manual
  );
END;
$$;

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
  v_oid           uuid;
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
    UPDATE public.payment_delete_operations
      SET status = 'expired', updated_at = now()
    WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'operation_expired');
  END IF;
  IF v_op.version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_mismatch', 'expected', v_op.version);
  END IF;

  v_ids := v_op.payment_ids;

  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR UPDATE;

  v_recomputed := public._payment_delete_checksum(v_ids, v_op.order_id, v_op.version);
  IF v_recomputed IS DISTINCT FROM v_op.checksum
     OR v_recomputed IS DISTINCT FROM p_checksum
  THEN
    UPDATE public.payment_delete_operations
      SET status = 'failed', updated_at = now()
    WHERE id = v_op.id;
    RETURN jsonb_build_object(
      'ok', false, 'error', 'checksum_mismatch',
      'stored', v_op.checksum, 'recomputed', v_recomputed, 'client', p_checksum
    );
  END IF;

  IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE id = ANY(v_ids) AND is_deleted = true) THEN
    UPDATE public.payment_delete_operations
      SET status = 'failed', updated_at = now()
    WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'already_deleted');
  END IF;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_audit_before
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  INSERT INTO public.payment_tombstones(
    original_payment_id, provider, external_id, order_id, amount, currency,
    payload_snapshot, checksum, operation_id, deleted_by, deleted_reason
  )
  SELECT p.id, p.provider, p.provider_payment_id, p.order_id, p.amount, p.currency,
         to_jsonb(p),
         v_op.checksum, v_op.id, p_actor_user_id,
         coalesce(nullif(trim(p_reason), ''), 'admin_manual_delete')
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids);

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

  SELECT array_agg(DISTINCT p.order_id) INTO v_order_ids
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL;

  IF v_order_ids IS NOT NULL THEN
    FOREACH v_oid IN ARRAY v_order_ids LOOP
      v_recalc     := public.recalc_order_totals(v_oid, 'payment_removed', NULL);
      v_recalc_all := v_recalc_all || jsonb_build_array(v_recalc);
    END LOOP;
  END IF;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_audit_after
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, meta)
  VALUES (
    p_actor_user_id,
    'admin_payment_delete_executed',
    'user',
    'payment',
    jsonb_build_object(
      'operation_id',           v_op.id,
      'operation_type',         v_op.operation_type,
      'payment_ids',            v_ids,
      'order_ids',              v_order_ids,
      'before',                 v_audit_before,
      'after',                  v_audit_after,
      'recalc',                 v_recalc_all,
      'access_decisions',       v_op.access_decisions,
      'manual_review_required', v_op.manual_review_required,
      'reason',                 p_reason
    )
  ) RETURNING id INTO v_audit_id;

  UPDATE public.payment_delete_operations
    SET status = 'consumed', consumed_at = now(), updated_at = now(),
        version = version + 1
  WHERE id = v_op.id;

  RETURN jsonb_build_object(
    'ok',                     true,
    'operation_id',           v_op.id,
    'deleted_payment_ids',    v_ids,
    'affected_order_ids',     v_order_ids,
    'recalc',                 v_recalc_all,
    'audit_log_id',           v_audit_id,
    'manual_review_required', v_op.manual_review_required
  );
END;
$$;
