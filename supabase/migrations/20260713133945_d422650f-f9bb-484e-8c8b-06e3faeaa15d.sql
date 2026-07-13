
-- Only change: drop parent_event_key from the compensating INSERT to satisfy chk_parent_keys_pair.
CREATE OR REPLACE FUNCTION public.admin_payment_delete_execute_v1(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_checksum text,
  p_version integer,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_op            public.payment_delete_operations%ROWTYPE;
  v_ids           uuid[];
  v_current_ids   uuid[];
  v_order_ids     uuid[];
  v_recomputed    text;
  v_recomputed_gr text;
  v_recalc        jsonb;
  v_recalc_all    jsonb := '[]'::jsonb;
  v_audit_before  jsonb;
  v_audit_after   jsonb;
  v_audit_id      uuid;
  v_pair          record;
  v_dec           jsonb;
  v_ledger_id     uuid;
  v_processed     uuid[] := '{}';
  v_revoked_ids   uuid[] := '{}';
  v_order_deleted uuid[] := '{}';
  v_reason        text;
BEGIN
  v_reason := coalesce(nullif(trim(p_reason),''), 'admin_manual_delete');
  SELECT * INTO v_op FROM public.payment_delete_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'operation_not_found'); END IF;
  IF v_op.actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'operation_actor_mismatch'); END IF;
  IF v_op.status <> 'preview' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'operation_not_pending', 'status', v_op.status); END IF;
  IF v_op.expires_at < now() THEN
    UPDATE public.payment_delete_operations SET status='expired', updated_at=now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'operation_expired'); END IF;
  IF v_op.version IS DISTINCT FROM p_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'version_mismatch', 'expected', v_op.version); END IF;

  v_ids       := v_op.payment_ids;
  v_order_ids := coalesce(v_op.order_ids, '{}');

  PERFORM 1 FROM public.orders_v2 WHERE id = ANY(v_order_ids) FOR UPDATE;
  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR UPDATE;

  IF v_op.operation_type = 'order_with_all_linked_payments' THEN
    SELECT array_agg(p.id ORDER BY p.id) INTO v_current_ids
    FROM public.payments_v2 p WHERE p.order_id = v_op.order_id AND p.is_deleted = false;
    IF coalesce(v_current_ids,'{}') <> coalesce(v_ids,'{}') THEN
      UPDATE public.payment_delete_operations SET status='failed', updated_at=now() WHERE id = v_op.id;
      RETURN jsonb_build_object('ok', false, 'error', 'graph_changed',
        'preview_payment_ids', v_ids, 'current_payment_ids', v_current_ids);
    END IF;
  END IF;

  v_recomputed    := public._payment_delete_checksum(v_ids, v_op.order_id, v_op.version);
  v_recomputed_gr := public._payment_delete_graph_checksum(v_order_ids, v_ids);
  IF v_recomputed IS DISTINCT FROM v_op.checksum OR v_recomputed IS DISTINCT FROM p_checksum THEN
    UPDATE public.payment_delete_operations SET status='failed', updated_at=now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'checksum_mismatch',
      'stored', v_op.checksum, 'recomputed', v_recomputed, 'client', p_checksum);
  END IF;
  IF v_op.graph_checksum IS NOT NULL AND v_recomputed_gr IS DISTINCT FROM v_op.graph_checksum THEN
    UPDATE public.payment_delete_operations SET status='failed', updated_at=now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'graph_checksum_mismatch',
      'stored', v_op.graph_checksum, 'recomputed', v_recomputed_gr);
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
  SELECT p.id, lower(trim(p.provider)), p.provider_payment_id, p.order_id, p.amount, p.currency,
         to_jsonb(p), v_op.checksum, v_op.id, p_actor_user_id, v_reason
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  UPDATE public.payments_v2 p
    SET is_deleted=true, deleted_at=now(), deleted_by=p_actor_user_id, deleted_reason=v_reason,
        deletion_context=jsonb_build_object(
          'operation_id',v_op.id,'operation_type',v_op.operation_type,
          'checksum',v_op.checksum,'graph_checksum',v_op.graph_checksum,'version',v_op.version)
  WHERE p.id = ANY(v_ids);

  FOR v_pair IN
    SELECT p.id AS pid, p.order_id AS oid FROM public.payments_v2 p
    WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL ORDER BY p.order_id, p.id
  LOOP
    v_recalc := public.recalc_order_totals(v_pair.oid, 'payment_removed', v_pair.pid);
    v_recalc_all := v_recalc_all || jsonb_build_array(v_recalc);
    IF coalesce((v_recalc->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'recalc_failed: order=% payment=% detail=%', v_pair.oid, v_pair.pid, v_recalc::text
        USING ERRCODE = 'P0001', HINT = 'batch rollback';
    END IF;
  END LOOP;

  IF v_op.operation_type = 'order_with_all_linked_payments' AND v_op.order_id IS NOT NULL THEN
    UPDATE public.orders_v2 SET is_deleted=true, deleted_at=now(), deleted_by=p_actor_user_id,
      deleted_reason=v_reason,
      deletion_context=jsonb_build_object('operation_id',v_op.id,'operation_type',v_op.operation_type,
        'checksum',v_op.checksum,'graph_checksum',v_op.graph_checksum,'reason',v_reason),
      status='canceled', updated_at=now()
    WHERE id = v_op.order_id AND is_deleted = false;
    v_order_deleted := array_append(v_order_deleted, v_op.order_id);
  END IF;

  IF v_op.access_decisions IS NOT NULL THEN
    FOR v_dec IN SELECT jsonb_array_elements(v_op.access_decisions)
    LOOP
      IF coalesce((v_dec->>'access_revoke')::boolean, false)
         AND coalesce((v_dec->>'exact_lineage')::boolean, false) THEN
        FOR v_ledger_id IN
          SELECT (elem)::uuid FROM jsonb_array_elements_text(v_dec->'exact_ledger_ids') elem
        LOOP
          IF v_ledger_id = ANY(v_processed) THEN CONTINUE; END IF;
          v_processed := array_append(v_processed, v_ledger_id);
          PERFORM 1 FROM public.access_grant_ledger
          WHERE id = v_ledger_id
            AND coalesce(status,'granted')='granted'
            AND coalesce(action_type,'grant') NOT IN ('revoke','revoked')
          FOR UPDATE;
          IF FOUND THEN
            INSERT INTO public.access_grant_ledger(
              source_event_key, execution_key,
              action_type, status, reason_code,
              source_event_type, source_subject_type, source_subject_ref,
              target_type, target_key, target_ref,
              user_id, profile_id, order_id, source_order_id,
              metadata
            )
            SELECT
              'payment_delete:' || v_op.id::text || ':' || l.id::text,
              'payment_delete:' || v_op.id::text || ':' || l.id::text,
              'revoke', 'revoked', 'admin_revoke',
              'admin', 'admin_action', l.source_subject_ref,
              l.target_type, l.target_key, l.target_ref,
              l.user_id, l.profile_id, l.order_id, l.source_order_id,
              jsonb_build_object(
                'operation_id',       v_op.id,
                'reverted_ledger_id', l.id,
                'reverted_source_event_key', l.source_event_key,
                'order_id',           v_dec->>'order_id',
                'source_payment_ids', v_dec->'source_payment_ids',
                'reason',             v_reason,
                'action_note',        'revoked_by_payment_delete'
              )
            FROM public.access_grant_ledger l WHERE l.id = v_ledger_id;
            v_revoked_ids := array_append(v_revoked_ids, v_ledger_id);
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_audit_after
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  INSERT INTO public.audit_logs(actor_user_id, action, actor_type, entity_type, meta)
  VALUES (p_actor_user_id, 'admin_payment_delete_executed', 'user', 'payment',
    jsonb_build_object('operation_id',v_op.id,'operation_type',v_op.operation_type,
      'payment_ids',v_ids,'order_ids',v_order_ids,'orders_deleted',v_order_deleted,
      'ledger_revoked_ids',v_revoked_ids,'before',v_audit_before,'after',v_audit_after,
      'recalc',v_recalc_all,'access_decisions',v_op.access_decisions,
      'manual_review_required',v_op.manual_review_required,
      'checksum',v_op.checksum,'graph_checksum',v_op.graph_checksum,'reason',v_reason))
  RETURNING id INTO v_audit_id;

  UPDATE public.payment_delete_operations
    SET status='consumed', consumed_at=now(), updated_at=now(), version=version+1
  WHERE id = v_op.id;

  RETURN jsonb_build_object('ok', true, 'operation_id', v_op.id,
    'deleted_payment_ids', v_ids, 'affected_order_ids', v_order_ids,
    'orders_deleted', v_order_deleted, 'ledger_revoked_ids', v_revoked_ids,
    'recalc', v_recalc_all, 'audit_log_id', v_audit_id,
    'manual_review_required', v_op.manual_review_required);
END $$;
