-- ============================================================
-- Stage 4R — canonical delete engine closure
-- ============================================================

-- 1. Canonical order soft-delete columns ---------------------------------
ALTER TABLE public.orders_v2
  ADD COLUMN IF NOT EXISTS is_deleted        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at        timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by        uuid,
  ADD COLUMN IF NOT EXISTS deleted_reason    text,
  ADD COLUMN IF NOT EXISTS deletion_context  jsonb;

CREATE INDEX IF NOT EXISTS orders_v2_active_idx
  ON public.orders_v2 (id) WHERE is_deleted = false;

-- 2. Extend payment_delete_operations for graph checksum / exact lineage
ALTER TABLE public.payment_delete_operations
  ADD COLUMN IF NOT EXISTS order_ids            uuid[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS graph_checksum       text,
  ADD COLUMN IF NOT EXISTS access_ledger_ids    uuid[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS predicted_after_full jsonb   NOT NULL DEFAULT '[]'::jsonb;

-- 3. Canonical single-row checksum (extended coverage) -------------------
CREATE OR REPLACE FUNCTION public._payment_delete_checksum(
  p_payment_ids uuid[], p_order_id uuid, p_version integer
) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_agg text;
BEGIN
  SELECT string_agg(
    p.id::text
    || ':' || p.is_deleted::text
    || ':' || coalesce(p.amount::text,'')
    || ':' || coalesce(upper(p.currency),'')
    || ':' || coalesce(p.status::text,'')
    || ':' || coalesce(lower(trim(p.provider)),'')
    || ':' || coalesce(p.transaction_type,'')
    || ':' || coalesce(p.reference_payment_id::text,'')
    || ':' || coalesce(p.order_id::text,'')
    || ':' || coalesce(p.profile_id::text,'')
    || ':' || coalesce(p.refunded_amount::text,''),
    '|' ORDER BY p.id
  )
  INTO v_agg
  FROM public.payments_v2 p
  WHERE p.id = ANY(p_payment_ids);
  RETURN encode(
    digest(coalesce(v_agg,'') || '||' || coalesce(p_order_id::text,'') || '||v' || p_version::text, 'sha256'),
    'hex'
  );
END $$;

-- 4. Full-graph checksum (order + active graph + access ledger) ----------
CREATE OR REPLACE FUNCTION public._payment_delete_graph_checksum(
  p_order_ids uuid[], p_selected_payment_ids uuid[]
) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_pay   text;
  v_ord   text;
  v_led   text;
  v_sel   text;
BEGIN
  SELECT string_agg(
    p.id::text
    || ':' || p.is_deleted::text
    || ':' || coalesce(p.amount::text,'')
    || ':' || coalesce(upper(p.currency),'')
    || ':' || coalesce(p.status::text,'')
    || ':' || coalesce(lower(trim(p.provider)),'')
    || ':' || coalesce(p.transaction_type,'')
    || ':' || coalesce(p.reference_payment_id::text,'')
    || ':' || coalesce(p.order_id::text,'')
    || ':' || coalesce(p.profile_id::text,'')
    || ':' || coalesce(p.refunded_amount::text,''),
    '|' ORDER BY p.id
  )
  INTO v_pay
  FROM public.payments_v2 p
  WHERE p.order_id = ANY(p_order_ids)
    AND p.is_deleted = false;

  SELECT string_agg(
    o.id::text
    || ':' || coalesce(o.status::text,'')
    || ':' || coalesce(o.paid_amount::text,'')
    || ':' || coalesce(o.final_price::text,'')
    || ':' || coalesce(upper(o.currency),'')
    || ':' || o.is_deleted::text,
    '|' ORDER BY o.id
  )
  INTO v_ord
  FROM public.orders_v2 o
  WHERE o.id = ANY(p_order_ids);

  SELECT string_agg(l.id::text || ':' || coalesce(l.status,'') || ':' || coalesce(l.action_type,''),
                    '|' ORDER BY l.id)
  INTO v_led
  FROM public.access_grant_ledger l
  WHERE l.order_id = ANY(p_order_ids);

  SELECT string_agg(x::text, ',' ORDER BY x)
  INTO v_sel
  FROM unnest(p_selected_payment_ids) x;

  RETURN encode(
    digest(
      'PAY:' || coalesce(v_pay,'')
      || '||ORD:' || coalesce(v_ord,'')
      || '||LED:' || coalesce(v_led,'')
      || '||SEL:' || coalesce(v_sel,''),
      'sha256'
    ),
    'hex'
  );
END $$;

-- 5. Preview v2 ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_payment_delete_preview_v1(
  p_actor_user_id uuid,
  p_mode text,
  p_payment_ids uuid[],
  p_order_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_ids            uuid[];
  v_order_ids      uuid[];
  v_before         jsonb;
  v_predicted      jsonb;
  v_predicted_full jsonb := '[]'::jsonb;
  v_access         jsonb;
  v_op_id          uuid;
  v_checksum       text;
  v_graph_checksum text;
  v_expires        timestamptz;
  v_manual         boolean := false;
  v_ledger_ids     uuid[] := '{}';
  v_row_ledger_ids uuid[];
  v_all_access     jsonb := '[]'::jsonb;
  v_pay            record;
  v_ord            record;
  v_removed_paid   numeric(14,2);
  v_removed_refund numeric(14,2);
  v_pred_paid      numeric(14,2);
  v_pred_refund    numeric(14,2);
  v_pred_status    text;
  v_remaining_succ int;
  v_row_exact      boolean;
  v_row_revoke     boolean;
  v_row_reason     text;
  v_row_ledger_cnt int;
  v_row_json       jsonb;
BEGIN
  IF p_mode NOT IN ('payment_only','order_with_all_linked_payments') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;

  IF p_mode = 'order_with_all_linked_payments' THEN
    IF p_order_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'order_id_required');
    END IF;
    SELECT array_agg(p.id ORDER BY p.id) INTO v_ids
    FROM public.payments_v2 p
    WHERE p.order_id = p_order_id AND p.is_deleted = false;
    IF v_ids IS NULL OR array_length(v_ids,1) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'no_payments_for_order');
    END IF;
  ELSE
    IF p_payment_ids IS NULL OR array_length(p_payment_ids,1) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'payment_ids_required');
    END IF;
    SELECT array_agg(id ORDER BY id) INTO v_ids
    FROM public.payments_v2
    WHERE id = ANY(p_payment_ids) AND is_deleted = false;
    IF v_ids IS NULL OR array_length(v_ids,1) IS DISTINCT FROM array_length(p_payment_ids,1) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'some_payments_missing_or_deleted');
    END IF;
  END IF;

  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR SHARE;

  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id, 'provider', p.provider, 'origin', p.origin,
    'status', p.status, 'amount', p.amount, 'currency', p.currency,
    'order_id', p.order_id, 'profile_id', p.profile_id,
    'provider_payment_id', p.provider_payment_id, 'paid_at', p.paid_at,
    'transaction_type', p.transaction_type,
    'reference_payment_id', p.reference_payment_id
  ) ORDER BY p.id) INTO v_before
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  SELECT array_agg(DISTINCT p.order_id) INTO v_order_ids
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL;
  v_order_ids := coalesce(v_order_ids, '{}');

  -- Predicted after-state per order, without mutation.
  FOR v_ord IN
    SELECT o.* FROM public.orders_v2 o WHERE o.id = ANY(v_order_ids)
  LOOP
    SELECT
      coalesce(sum(CASE WHEN p.status='succeeded' AND coalesce(p.transaction_type,'payment')<>'refund'
                        THEN p.amount ELSE 0 END),0),
      coalesce(sum(CASE WHEN p.status='succeeded' AND p.transaction_type='refund'
                        THEN p.amount ELSE 0 END),0)
    INTO v_removed_paid, v_removed_refund
    FROM public.payments_v2 p
    WHERE p.id = ANY(v_ids) AND p.order_id = v_ord.id;

    v_pred_paid   := greatest(coalesce(v_ord.paid_amount,0) - v_removed_paid + v_removed_refund, 0);
    v_pred_refund := 0;

    SELECT count(*) INTO v_remaining_succ
    FROM public.payments_v2 p
    WHERE p.order_id = v_ord.id
      AND p.is_deleted = false
      AND p.status = 'succeeded'
      AND coalesce(p.transaction_type,'payment') <> 'refund'
      AND p.id <> ALL(v_ids);

    v_pred_status := CASE
      WHEN v_pred_paid <= 0 AND v_remaining_succ = 0 THEN 'pending'
      WHEN v_pred_paid >= coalesce(v_ord.final_price,0) THEN 'paid'
      WHEN v_pred_paid > 0 THEN 'partial'
      ELSE v_ord.status::text
    END;

    v_predicted_full := v_predicted_full || jsonb_build_array(jsonb_build_object(
      'order_id', v_ord.id,
      'before_status', v_ord.status::text,
      'before_paid_amount', v_ord.paid_amount,
      'predicted_status', v_pred_status,
      'predicted_paid_amount', v_pred_paid,
      'predicted_refunded_amount', v_pred_refund,
      'currency', v_ord.currency,
      'final_price', v_ord.final_price
    ));
  END LOOP;
  v_predicted := v_predicted_full;

  -- Exact-lineage detection: for each payment on an order that becomes zero-active,
  -- if there are granted ledger rows we can revoke exactly those.
  FOR v_pay IN
    SELECT p.id AS pid, p.order_id AS oid
    FROM public.payments_v2 p WHERE p.id = ANY(v_ids)
  LOOP
    v_row_exact := false; v_row_revoke := false; v_row_ledger_ids := '{}';
    v_row_ledger_cnt := 0;
    IF v_pay.oid IS NULL THEN
      v_row_reason := 'no_order_no_lineage';
    ELSE
      SELECT count(*) INTO v_row_ledger_cnt
      FROM public.access_grant_ledger l WHERE l.order_id = v_pay.oid;

      IF v_row_ledger_cnt = 0 THEN
        v_row_reason := 'no_ledger_grants';
      ELSE
        -- Order becomes zero-active-succeeded after removing all selected payments on it?
        SELECT count(*) INTO v_remaining_succ
        FROM public.payments_v2 p2
        WHERE p2.order_id = v_pay.oid
          AND p2.is_deleted = false
          AND p2.status = 'succeeded'
          AND coalesce(p2.transaction_type,'payment') <> 'refund'
          AND p2.id <> ALL(v_ids);
        IF v_remaining_succ = 0 THEN
          SELECT array_agg(l.id ORDER BY l.id) INTO v_row_ledger_ids
          FROM public.access_grant_ledger l
          WHERE l.order_id = v_pay.oid
            AND coalesce(l.status,'granted') = 'granted'
            AND coalesce(l.action_type,'grant') NOT IN ('revoked_by_payment_delete','revoked');
          v_row_ledger_ids := coalesce(v_row_ledger_ids, '{}');
          IF array_length(v_row_ledger_ids,1) > 0 THEN
            v_row_exact := true;
            v_row_revoke := true;
            v_row_reason := 'exact_lineage_single_source';
          ELSE
            v_row_reason := 'ledger_already_revoked';
          END IF;
        ELSE
          v_row_reason := 'ambiguous_lineage_manual_review';
        END IF;
      END IF;
    END IF;

    v_row_json := jsonb_build_object(
      'payment_id', v_pay.pid,
      'order_id',   v_pay.oid,
      'access_revoke', v_row_revoke,
      'exact_lineage', v_row_exact,
      'manual_review_required', (v_row_ledger_cnt > 0 AND NOT v_row_exact),
      'ledger_rows', v_row_ledger_cnt,
      'exact_ledger_ids', coalesce(to_jsonb(v_row_ledger_ids), '[]'::jsonb),
      'reason', v_row_reason
    );
    v_all_access := v_all_access || jsonb_build_array(v_row_json);
    v_ledger_ids := v_ledger_ids || v_row_ledger_ids;
    IF v_row_ledger_cnt > 0 AND NOT v_row_exact THEN
      v_manual := true;
    END IF;
  END LOOP;

  v_checksum       := public._payment_delete_checksum(v_ids, p_order_id, 1);
  v_graph_checksum := public._payment_delete_graph_checksum(v_order_ids, v_ids);
  v_expires        := now() + interval '10 minutes';

  INSERT INTO public.payment_delete_operations(
    actor_user_id, operation_type, payment_ids, order_id, order_ids,
    version, checksum, graph_checksum,
    before_state, predicted_after, predicted_after_full,
    access_decisions, access_ledger_ids,
    manual_review_required, status, expires_at
  ) VALUES (
    p_actor_user_id, p_mode, v_ids, p_order_id, v_order_ids,
    1, v_checksum, v_graph_checksum,
    v_before, v_predicted_full, v_predicted_full,
    v_all_access, v_ledger_ids,
    v_manual, 'preview', v_expires
  ) RETURNING id INTO v_op_id;

  RETURN jsonb_build_object(
    'ok', true,
    'operation_id', v_op_id,
    'operation_type', p_mode,
    'version', 1,
    'checksum', v_checksum,
    'graph_checksum', v_graph_checksum,
    'expires_at', v_expires,
    'payment_ids', v_ids,
    'order_id', p_order_id,
    'order_ids', v_order_ids,
    'before_state', v_before,
    'predicted_after', v_predicted_full,
    'access_decisions', v_all_access,
    'manual_review_required', v_manual
  );
END $$;

-- 6. Execute v2 ---------------------------------------------------------
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
  v_revoked_ids   uuid[] := '{}';
  v_order_deleted uuid[] := '{}';
  v_reason        text;
BEGIN
  v_reason := coalesce(nullif(trim(p_reason),''), 'admin_manual_delete');

  SELECT * INTO v_op FROM public.payment_delete_operations WHERE id = p_operation_id FOR UPDATE;
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

  v_ids       := v_op.payment_ids;
  v_order_ids := coalesce(v_op.order_ids, '{}');

  -- Lock target orders first (deadlock-safe order-then-payments).
  PERFORM 1 FROM public.orders_v2 WHERE id = ANY(v_order_ids) FOR UPDATE;
  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR UPDATE;

  -- Re-derive current active payment graph per order; compare with preview snapshot.
  IF v_op.operation_type = 'order_with_all_linked_payments' THEN
    SELECT array_agg(p.id ORDER BY p.id) INTO v_current_ids
    FROM public.payments_v2 p
    WHERE p.order_id = v_op.order_id AND p.is_deleted = false;
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

  -- Insert tombstones.
  INSERT INTO public.payment_tombstones(
    original_payment_id, provider, external_id, order_id, amount, currency,
    payload_snapshot, checksum, operation_id, deleted_by, deleted_reason
  )
  SELECT p.id, lower(trim(p.provider)), p.provider_payment_id, p.order_id, p.amount, p.currency,
         to_jsonb(p), v_op.checksum, v_op.id, p_actor_user_id, v_reason
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  -- Soft-delete payments.
  UPDATE public.payments_v2 p
    SET is_deleted       = true,
        deleted_at       = now(),
        deleted_by       = p_actor_user_id,
        deleted_reason   = v_reason,
        deletion_context = jsonb_build_object(
          'operation_id',   v_op.id,
          'operation_type', v_op.operation_type,
          'checksum',       v_op.checksum,
          'graph_checksum', v_op.graph_checksum,
          'version',        v_op.version
        )
  WHERE p.id = ANY(v_ids);

  -- Recalc per affected pair; RAISE on any failure to trigger full rollback.
  FOR v_pair IN
    SELECT p.id AS pid, p.order_id AS oid
    FROM public.payments_v2 p
    WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL
    ORDER BY p.order_id, p.id
  LOOP
    v_recalc := public.recalc_order_totals(v_pair.oid, 'payment_removed', v_pair.pid);
    v_recalc_all := v_recalc_all || jsonb_build_array(v_recalc);
    IF coalesce((v_recalc->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'recalc_failed: order=% payment=% detail=%',
        v_pair.oid, v_pair.pid, v_recalc::text
        USING ERRCODE = 'P0001',
              HINT    = 'batch rollback — payments soft-delete, tombstones, ledger revokes reverted';
    END IF;
  END LOOP;

  -- Order-mode: soft-delete the order canonically (status=canceled + flags).
  IF v_op.operation_type = 'order_with_all_linked_payments' AND v_op.order_id IS NOT NULL THEN
    UPDATE public.orders_v2
      SET is_deleted       = true,
          deleted_at       = now(),
          deleted_by       = p_actor_user_id,
          deleted_reason   = v_reason,
          deletion_context = jsonb_build_object(
            'operation_id',   v_op.id,
            'operation_type', v_op.operation_type,
            'checksum',       v_op.checksum,
            'graph_checksum', v_op.graph_checksum,
            'reason',         v_reason
          ),
          status = 'canceled',
          updated_at = now()
    WHERE id = v_op.order_id AND is_deleted = false;
    v_order_deleted := array_append(v_order_deleted, v_op.order_id);
  END IF;

  -- Exact-lineage access revocation: insert compensating ledger rows.
  IF v_op.access_decisions IS NOT NULL THEN
    FOR v_dec IN SELECT jsonb_array_elements(v_op.access_decisions)
    LOOP
      IF coalesce((v_dec->>'access_revoke')::boolean, false)
         AND coalesce((v_dec->>'exact_lineage')::boolean, false) THEN
        FOR v_ledger_id IN
          SELECT (elem)::uuid FROM jsonb_array_elements_text(v_dec->'exact_ledger_ids') elem
        LOOP
          -- Re-lock and re-validate the ledger row is still granted / not already revoked.
          PERFORM 1 FROM public.access_grant_ledger
          WHERE id = v_ledger_id
            AND coalesce(status,'granted') = 'granted'
            AND coalesce(action_type,'grant') NOT IN ('revoked_by_payment_delete','revoked')
          FOR UPDATE;
          IF FOUND THEN
            INSERT INTO public.access_grant_ledger(
              source_event_key, execution_key, parent_event_key,
              action_type, status, reason_code,
              source_event_type, source_subject_type, source_subject_ref,
              target_type, target_key, target_ref,
              user_id, profile_id, order_id, source_order_id,
              metadata
            )
            SELECT
              'payment_delete:' || v_op.id::text || ':' || l.id::text,
              'payment_delete:' || v_op.id::text || ':' || l.id::text,
              l.source_event_key,
              'revoked_by_payment_delete', 'revoked', 'admin_manual_delete',
              'admin_payment_delete', l.source_subject_type, l.source_subject_ref,
              l.target_type, l.target_key, l.target_ref,
              l.user_id, l.profile_id, l.order_id, l.source_order_id,
              jsonb_build_object('operation_id', v_op.id, 'reverted_ledger_id', l.id,
                                 'payment_id', v_dec->>'payment_id', 'reason', v_reason)
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
  VALUES (
    p_actor_user_id, 'admin_payment_delete_executed', 'user', 'payment',
    jsonb_build_object(
      'operation_id',           v_op.id,
      'operation_type',         v_op.operation_type,
      'payment_ids',            v_ids,
      'order_ids',              v_order_ids,
      'orders_deleted',         v_order_deleted,
      'ledger_revoked_ids',     v_revoked_ids,
      'before',                 v_audit_before,
      'after',                  v_audit_after,
      'recalc',                 v_recalc_all,
      'access_decisions',       v_op.access_decisions,
      'manual_review_required', v_op.manual_review_required,
      'checksum',               v_op.checksum,
      'graph_checksum',         v_op.graph_checksum,
      'reason',                 v_reason
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
    'orders_deleted', v_order_deleted,
    'ledger_revoked_ids', v_revoked_ids,
    'recalc', v_recalc_all,
    'audit_log_id', v_audit_id,
    'manual_review_required', v_op.manual_review_required
  );
END $$;

-- 7. Tombstone INSERT guard with normalised provider ---------------------
CREATE OR REPLACE FUNCTION public.payments_v2_reject_tombstoned()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF NEW.provider_payment_id IS NOT NULL
     AND NEW.provider IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.payment_tombstones t
       WHERE lower(trim(t.provider)) = lower(trim(NEW.provider))
         AND t.external_id = NEW.provider_payment_id
     )
  THEN
    RAISE EXCEPTION
      'payments_v2 insert blocked: payment (%, %) is tombstoned', NEW.provider, NEW.provider_payment_id
      USING ERRCODE = 'P0001',
            HINT = 'A prior admin delete created a tombstone. Webhook/reconcile/manual writers MUST skip this payment.';
  END IF;
  RETURN NEW;
END $$;

-- 8. Tombstone UPDATE reactivation guard ---------------------------------
CREATE OR REPLACE FUNCTION public.payments_v2_reject_tombstoned_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE v_is_tombstoned boolean;
BEGIN
  -- Look up by BOTH old and new (provider, external_id) — attacker may try to swap identity.
  SELECT EXISTS (
    SELECT 1 FROM public.payment_tombstones t
    WHERE ( (OLD.provider IS NOT NULL AND OLD.provider_payment_id IS NOT NULL
             AND lower(trim(t.provider)) = lower(trim(OLD.provider))
             AND t.external_id = OLD.provider_payment_id)
         OR (NEW.provider IS NOT NULL AND NEW.provider_payment_id IS NOT NULL
             AND lower(trim(t.provider)) = lower(trim(NEW.provider))
             AND t.external_id = NEW.provider_payment_id)
         OR (t.original_payment_id = NEW.id)
          )
  ) INTO v_is_tombstoned;

  IF v_is_tombstoned
     AND (
       (OLD.is_deleted = true  AND NEW.is_deleted = false) OR
       (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
     )
  THEN
    RAISE EXCEPTION
      'tombstoned_payment_reactivation_blocked: payment % may not be un-deleted', NEW.id
      USING ERRCODE = 'P0001',
            HINT = 'This payment has a tombstone. Reactivation is permanently forbidden.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_v2_reject_tombstoned_update_trg ON public.payments_v2;
CREATE TRIGGER payments_v2_reject_tombstoned_update_trg
BEFORE UPDATE OF is_deleted, deleted_at, provider, provider_payment_id
ON public.payments_v2
FOR EACH ROW EXECUTE FUNCTION public.payments_v2_reject_tombstoned_update();
