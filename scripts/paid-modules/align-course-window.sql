-- Reviewed data operation, NOT a schema migration. Execute only via Lovable Cloud run_sql.
-- Dry-run the candidate SELECT first: four rows, matching the approved set hash below.
DO $repair$
DECLARE
  r record;
  candidates jsonb;
  applied integer := 0;
  changed integer;
  operation constant text := 'paid_modules.course_window_alignment_v1';
BEGIN
  -- Replay is a no-op only if every previously written result still matches.
  IF EXISTS (SELECT 1 FROM public.audit_logs WHERE action=operation) THEN
    IF (SELECT count(*) FROM public.audit_logs WHERE action=operation) <> 4
      OR EXISTS (SELECT 1 FROM public.audit_logs a
        LEFT JOIN public.entitlements e ON e.id=a.entity_id
        WHERE a.action=operation AND (e.id IS NULL
          OR e.expires_at IS DISTINCT FROM (a.meta->>'after_expires_at')::timestamptz
          OR e.meta->>'alignment_reason' IS DISTINCT FROM operation))
    THEN RAISE EXCEPTION 'paid_module_alignment_replay_drift'; END IF;
    RETURN;
  END IF;

  WITH locked AS (
    SELECT e.id, e.user_id, e.meta, e.updated_at, e.expires_at,
      base.id base_entitlement_id, base.expires_at base_expires_at, par.id base_order_id
    FROM public.entitlements e
    JOIN public.orders_v2 o ON o.id=e.order_id
    JOIN public.products_v2 product ON product.id=e.product_id
    JOIN public.orders_v2 par ON par.id::text=o.meta->>'group_primary_order_id'
    JOIN public.entitlements base ON base.order_id=par.id AND base.user_id=e.user_id
      AND base.product_id=par.product_id
    JOIN public.order_group_items item ON item.order_id=o.id AND item.product_id=o.product_id
      AND item.order_group_id::text=o.meta->>'order_group_id' AND item.role='addon'
    JOIN public.payments_v2 payment ON payment.id::text=o.meta->>'group_payment_id'
      AND payment.order_id=par.id
    JOIN public.order_groups grp ON grp.id=item.order_group_id
      AND grp.primary_order_id=par.id AND grp.user_id=e.user_id
    WHERE e.user_id=o.user_id AND e.user_id=par.user_id AND e.product_id=o.product_id
      AND (left(product.code,10)='cb_module_' OR product.code='prd_08a84b2b7223')
      AND e.status='active' AND e.expires_at>now()
      AND e.meta->>'granted_by'='primary_order_fulfillment'
      AND NOT (e.meta ? 'manual_access_edit_last_at')
      AND o.status::text='paid' AND NOT o.is_deleted AND o.final_price>0 AND o.paid_amount>0
      AND o.meta->>'group_child_order'='true'
      AND par.product_id='3e43fb28-8322-41bc-bfee-714731bdc630'::uuid
      AND par.status::text IN ('paid','partial_refund') AND NOT par.is_deleted
      AND grp.status::text IN ('paid','partial_refund')
      AND base.status='active' AND base.expires_at>now() AND e.expires_at<base.expires_at
      AND payment.status::text IN ('succeeded','partially_refunded')
      AND payment.amount>coalesce(payment.refunded_amount,0)
      AND payment.user_id=e.user_id AND NOT payment.is_deleted
      AND NOT EXISTS (SELECT 1 FROM public.payments_v2 p WHERE p.order_id=par.id
        AND (p.status::text='refunded' OR (p.amount>0 AND p.refunded_amount>=p.amount)))
      AND NOT EXISTS (SELECT 1 FROM public.payment_refund_requests q
        WHERE q.order_group_item_id=item.id AND q.state<>'failed' AND q.access_action IN ('revoke','reduce'))
      AND NOT EXISTS (SELECT 1 FROM public.composable_refund_intents q
        WHERE q.order_group_item_id=item.id AND q.status NOT IN ('failed','cancelled') AND q.access_action IN ('revoke','reduce'))
    ORDER BY e.id
    FOR UPDATE OF e, base, o, par, payment, item, grp
  ) SELECT jsonb_agg(to_jsonb(locked) ORDER BY id) INTO candidates FROM locked;

  IF jsonb_array_length(coalesce(candidates,'[]')) <> 4
    OR md5((SELECT string_agg(value->>'id',',' ORDER BY value->>'id') FROM jsonb_array_elements(candidates)))
      <> /* EXPECTED_ENTITLEMENT_SET_MD5 */ '711a94d56021ec95b9873f46a63cc572'
  THEN RAISE EXCEPTION 'paid_module_alignment_candidate_set_changed'; END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(candidates) AS x(
    id uuid,user_id uuid,meta jsonb,updated_at timestamptz,expires_at timestamptz,
    base_entitlement_id uuid,base_expires_at timestamptz,base_order_id uuid)
  LOOP
    INSERT INTO public.audit_logs(action,actor_type,actor_label,entity_type,entity_id,target_user_id,meta)
    VALUES(operation,'system','reviewed_paid_module_course_window_repair','entitlement',r.id,r.user_id,
      jsonb_build_object('before_expires_at',r.expires_at,'before_meta',r.meta,'before_updated_at',r.updated_at,
        'after_expires_at',r.base_expires_at,'base_entitlement_id',r.base_entitlement_id,'base_order_id',r.base_order_id));
    UPDATE public.entitlements SET expires_at=r.base_expires_at,updated_at=now(),
      meta=coalesce(r.meta,'{}') || jsonb_build_object('previous_expires_at',r.expires_at,
        'aligned_with_base_entitlement_id',r.base_entitlement_id,'aligned_with_base_order_id',r.base_order_id,
        'aligned_at',now(),'alignment_reason',operation)
    WHERE id=r.id AND status='active' AND expires_at=r.expires_at;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'paid_module_alignment_concurrent_change'; END IF;
    applied:=applied+changed;
  END LOOP;
  IF applied<>4 THEN RAISE EXCEPTION 'paid_module_alignment_rowcount_changed'; END IF;
END;
$repair$;
