
-- =====================================================================
-- PATCH-PAYMENTS-MANAGEMENT-V2 · Stage 4 · Payment Delete Engine
-- Schema + preview/execute RPCs + tombstone helper.
-- =====================================================================

BEGIN;

-- 1. payment_delete_operations ----------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_delete_operations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id          uuid NOT NULL,
  operation_type         text NOT NULL
                          CHECK (operation_type IN ('payment_only','order_with_all_linked_payments')),
  payment_ids            uuid[] NOT NULL,
  order_id               uuid NULL,
  version                int  NOT NULL DEFAULT 1,
  checksum               text NOT NULL,
  before_state           jsonb NOT NULL,
  predicted_after        jsonb NOT NULL,
  access_decisions       jsonb NOT NULL,
  manual_review_required boolean NOT NULL DEFAULT false,
  status                 text NOT NULL DEFAULT 'preview'
                          CHECK (status IN ('preview','consumed','expired','failed')),
  consumed_at            timestamptz NULL,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_delete_operations_actor_idx
  ON public.payment_delete_operations(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_delete_operations_status_idx
  ON public.payment_delete_operations(status, expires_at);

GRANT SELECT ON public.payment_delete_operations TO authenticated;
GRANT ALL    ON public.payment_delete_operations TO service_role;

ALTER TABLE public.payment_delete_operations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "actor reads own delete ops" ON public.payment_delete_operations;
CREATE POLICY "actor reads own delete ops"
  ON public.payment_delete_operations FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid());

COMMENT ON TABLE public.payment_delete_operations IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 4. Preview-cache for admin payment delete. '
  'Consumed by admin_payment_delete_execute_v1 with checksum/version/expiry gates.';

-- 2. payment_tombstones (immutable) -----------------------------------
CREATE TABLE IF NOT EXISTS public.payment_tombstones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_payment_id uuid NOT NULL UNIQUE,
  provider            text NOT NULL,
  external_id         text NULL,
  order_id            uuid NULL,
  amount              numeric NULL,
  currency            text NULL,
  payload_snapshot    jsonb NOT NULL,
  checksum            text NOT NULL,
  operation_id        uuid NULL REFERENCES public.payment_delete_operations(id) ON DELETE SET NULL,
  deleted_by          uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at          timestamptz NOT NULL DEFAULT now(),
  deleted_reason      text NULL
);
CREATE INDEX IF NOT EXISTS payment_tombstones_provider_ext_idx
  ON public.payment_tombstones(provider, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_tombstones_order_idx
  ON public.payment_tombstones(order_id);

REVOKE ALL ON TABLE public.payment_tombstones FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_tombstones FROM anon;
REVOKE ALL ON TABLE public.payment_tombstones FROM authenticated;
GRANT SELECT         ON public.payment_tombstones TO authenticated;
GRANT SELECT, INSERT ON public.payment_tombstones TO service_role;

ALTER TABLE public.payment_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_tombstones FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read tombstones" ON public.payment_tombstones;
CREATE POLICY "admins read tombstones"
  ON public.payment_tombstones FOR SELECT TO authenticated
  USING (public.has_admin_section_access(auth.uid(), 'payments', 'view'));

COMMENT ON TABLE public.payment_tombstones IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 4. Immutable tombstone per soft-deleted payment. '
  'Webhook/reconcile writers MUST call is_payment_tombstoned(provider, external_id) before insert.';

-- 3. tombstone check helper --------------------------------------------
CREATE OR REPLACE FUNCTION public.is_payment_tombstoned(p_provider text, p_external_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_external_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.payment_tombstones
    WHERE provider = p_provider AND external_id = p_external_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_payment_tombstoned(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payment_tombstoned(text, text) TO service_role, authenticated;

-- 4. checksum helper ---------------------------------------------------
CREATE OR REPLACE FUNCTION public._payment_delete_checksum(
  p_payment_ids uuid[], p_order_id uuid, p_version int
) RETURNS text
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agg text;
BEGIN
  SELECT string_agg(
    p.id::text || ':' || p.is_deleted::text || ':' || coalesce(p.amount::text,'') || ':' ||
    coalesce(p.status::text,'') || ':' || coalesce(p.order_id::text,''),
    '|' ORDER BY p.id
  )
  INTO v_agg
  FROM public.payments_v2 p
  WHERE p.id = ANY(p_payment_ids);
  RETURN md5(coalesce(v_agg,'') || '||' || coalesce(p_order_id::text,'') || '||v' || p_version::text);
END;
$$;

-- 5. PREVIEW RPC -------------------------------------------------------
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

  -- Share-lock rows to snapshot state
  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR SHARE;

  -- Before-state
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id', p.id,
    'provider',   p.provider,
    'origin',     p.origin,
    'status',     p.status,
    'amount',     p.amount,
    'currency',   p.currency,
    'order_id',   p.order_id,
    'profile_id', p.profile_id,
    'external_id', p.external_id,
    'paid_at',    p.paid_at
  ) ORDER BY p.id)
  INTO v_before
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids);

  -- Access lineage per-payment (safe default: never auto-revoke; manual review if ledger has grants on the order)
  SELECT jsonb_agg(jsonb_build_object(
    'payment_id',             p.id,
    'order_id',               p.order_id,
    'access_revoke',          false,
    'manual_review_required', (l_count > 0),
    'ledger_rows',            l_count,
    'reason',                 CASE
                                WHEN p.order_id IS NULL          THEN 'no_order_no_lineage'
                                WHEN l_count = 0                 THEN 'no_ledger_grants'
                                ELSE                                  'ambiguous_lineage_manual_review'
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

  -- Predicted after (per affected order)
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
REVOKE ALL ON FUNCTION public.admin_payment_delete_preview_v1(uuid, text, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_delete_preview_v1(uuid, text, uuid[], uuid) TO service_role;

-- 6. EXECUTE RPC -------------------------------------------------------
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
  -- Lock operation row
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

  -- Re-lock exact graph FOR UPDATE
  PERFORM 1 FROM public.payments_v2 WHERE id = ANY(v_ids) FOR UPDATE;

  -- Recompute checksum; fail closed on any mismatch
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

  -- Guard: already deleted (race)
  IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE id = ANY(v_ids) AND is_deleted = true) THEN
    UPDATE public.payment_delete_operations
      SET status = 'failed', updated_at = now()
    WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'error', 'already_deleted');
  END IF;

  -- Capture before-audit
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) INTO v_audit_before
  FROM public.payments_v2 p WHERE p.id = ANY(v_ids);

  -- Insert tombstones BEFORE soft-delete (preserves original external_id/provider values)
  INSERT INTO public.payment_tombstones(
    original_payment_id, provider, external_id, order_id, amount, currency,
    payload_snapshot, checksum, operation_id, deleted_by, deleted_reason
  )
  SELECT p.id, p.provider, p.external_id, p.order_id, p.amount, p.currency,
         to_jsonb(p),
         v_op.checksum, v_op.id, p_actor_user_id,
         coalesce(nullif(trim(p_reason), ''), 'admin_manual_delete')
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids);

  -- Soft-delete
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

  -- Recalc each affected order (payment_removed) — only AFTER soft-delete
  SELECT array_agg(DISTINCT p.order_id) INTO v_order_ids
  FROM public.payments_v2 p
  WHERE p.id = ANY(v_ids) AND p.order_id IS NOT NULL;

  IF v_order_ids IS NOT NULL THEN
    FOREACH v_oid IN ARRAY v_order_ids LOOP
      v_recalc     := public.recalc_order_totals(v_oid, 'payment_removed', NULL);
      v_recalc_all := v_recalc_all || jsonb_build_array(v_recalc);
    END LOOP;
  END IF;

  -- After-audit snapshot
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
REVOKE ALL ON FUNCTION public.admin_payment_delete_execute_v1(uuid, uuid, text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_payment_delete_execute_v1(uuid, uuid, text, int, text) TO service_role;

COMMENT ON FUNCTION public.admin_payment_delete_preview_v1(uuid, text, uuid[], uuid) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 4. Preview payment delete. Modes: payment_only | order_with_all_linked_payments. '
  'Locks FOR SHARE, computes checksum, TTL 10 minutes, no data change.';
COMMENT ON FUNCTION public.admin_payment_delete_execute_v1(uuid, uuid, text, int, text) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 4. Single-transaction execute: re-lock FOR UPDATE → checksum recheck → tombstone → soft-delete → recalc_order_totals(payment_removed) → audit before/after → operation.status=consumed. Batch atomic: any failure rolls back the entire delete.';
COMMENT ON FUNCTION public.is_payment_tombstoned(text, text) IS
  'PATCH-PAYMENTS-MANAGEMENT-V2 Stage 4. Guard for webhook/reconcile writers. Returns true if a soft-deleted payment already exists for (provider, external_id). Writers MUST skip insert when true.';

COMMIT;
