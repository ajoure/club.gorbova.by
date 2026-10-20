-- Reviewed ONE-row data operation, not a migration or public RPC.
-- Lovable Cloud only, after canonical exact dry-run and fresh provider GET.
-- In the SAME transaction, bind the approved protected input with:
-- SELECT set_config('app.bepaid_schedule_repair', <escaped JSON>, true);
-- Required keys are documented in the release runbook. Never commit the input.
DO $repair$
DECLARE
  v jsonb := nullif(current_setting('app.bepaid_schedule_repair', true),'')::jsonb;
  t public.subscriptions_v2%ROWTYPE;
  s public.subscriptions_v2%ROWTYPE;
  ps public.provider_subscriptions%ROWTYPE;
  q public.payment_reconcile_queue%ROWTYPE;
  p public.payments_v2%ROWTYPE;
  prior public.payments_v2%ROWTYPE;
  o public.orders_v2%ROWTYPE;
  parent_order public.orders_v2%ROWTYPE;
  source_order public.orders_v2%ROWTYPE;
  receipt jsonb;
  protected_before text;
  protected_after text;
  after_next timestamptz;
  n integer;
  actor uuid;
  correction constant text := 'bepaid.paid_continuation.schedule_corrected';
BEGIN
  IF v IS NULL OR jsonb_typeof(v)<>'object' OR
    (SELECT count(*) FROM jsonb_object_keys(v))<>14 OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN
      ('target_id','source_id','provider_row_id','queue_id','payment_uid','previous_payment_uid',
       'target_updated_at','source_updated_at','provider_updated_at','queue_updated_at',
       'protected_target_md5','before_next_charge_at','verified_next_charge_at','verified_at')) OR
    EXISTS(SELECT 1 FROM jsonb_each(v) e WHERE jsonb_typeof(e.value)<>'string' OR e.value='""'::jsonb)
  THEN RAISE EXCEPTION 'schedule_repair_invalid_input'; END IF;
  IF (v->>'verified_at')::timestamptz < clock_timestamp()-interval '5 minutes' OR
     (v->>'verified_at')::timestamptz > clock_timestamp()+interval '5 seconds' OR
     (v->>'verified_next_charge_at')::timestamptz <= clock_timestamp()
  THEN RAISE EXCEPTION 'schedule_repair_stale_provider_proof'; END IF;

  SELECT * INTO STRICT t FROM public.subscriptions_v2 WHERE id=(v->>'target_id')::uuid FOR UPDATE;
  SELECT * INTO STRICT s FROM public.subscriptions_v2 WHERE id=(v->>'source_id')::uuid FOR UPDATE;
  SELECT * INTO STRICT ps FROM public.provider_subscriptions WHERE id=(v->>'provider_row_id')::uuid FOR UPDATE;
  SELECT * INTO STRICT q FROM public.payment_reconcile_queue WHERE id=(v->>'queue_id')::uuid FOR UPDATE;
  receipt := ps.meta->'paid_continuation_repair';
  protected_before := md5((to_jsonb(t)-'next_charge_at'-'updated_at')::text);
  IF protected_before IS DISTINCT FROM v->>'protected_target_md5' OR
     s.updated_at IS DISTINCT FROM (v->>'source_updated_at')::timestamptz OR
     ps.updated_at IS DISTINCT FROM (v->>'provider_updated_at')::timestamptz OR
     q.updated_at IS DISTINCT FROM (v->>'queue_updated_at')::timestamptz OR
     q.status::text IS DISTINCT FROM 'completed' OR q.attempts IS DISTINCT FROM 7 OR
     q.bepaid_uid IS DISTINCT FROM v->>'payment_uid' OR
     q.processed_order_id IS NULL OR q.processed_order_id IS DISTINCT FROM q.matched_order_id OR
     t.status::text IS DISTINCT FROM 'active' OR t.billing_type IS DISTINCT FROM 'provider_managed' OR
     t.auto_renew IS DISTINCT FROM false OR t.canceled_at IS NOT NULL OR t.cancel_at IS NOT NULL OR t.auto_renew_disabled_at IS NOT NULL OR
     t.access_end_at IS NULL OR t.access_end_at<=clock_timestamp() OR
     s.status::text IS DISTINCT FROM 'superseded' OR s.canceled_at IS NOT NULL OR s.cancel_at IS NOT NULL OR s.auto_renew_disabled_at IS NOT NULL OR
     t.id=s.id OR t.user_id IS NULL OR t.profile_id IS NULL OR t.product_id IS NULL OR t.tariff_id IS NULL OR
     s.user_id IS DISTINCT FROM t.user_id OR s.product_id IS DISTINCT FROM t.product_id OR s.tariff_id IS DISTINCT FROM t.tariff_id OR
     ps.provider IS DISTINCT FROM 'bepaid' OR ps.state IS DISTINCT FROM 'active' OR
     ps.subscription_v2_id IS DISTINCT FROM t.id OR ps.user_id IS DISTINCT FROM t.user_id OR
     ps.next_charge_at IS DISTINCT FROM (v->>'verified_next_charge_at')::timestamptz OR
     t.meta->>'bepaid_subscription_id' IS DISTINCT FROM ps.provider_subscription_id OR
     receipt->>'source_subscription_id' IS DISTINCT FROM s.id::text OR
     receipt->>'target_subscription_id' IS DISTINCT FROM t.id::text OR
     receipt->>'payment_uid' IS DISTINCT FROM q.bepaid_uid OR receipt->>'queue_id' IS DISTINCT FROM q.id::text OR
     receipt->>'billing_review_required' IS DISTINCT FROM 'true' OR
     receipt->>'billing_policy' IS DISTINCT FROM 'preserve_local_auto_renew' OR
     receipt->>'operator_user_id' IS NULL
  THEN RAISE EXCEPTION 'schedule_repair_snapshot_changed'; END IF;
  actor := (receipt->>'operator_user_id')::uuid;

  SELECT * INTO STRICT p FROM public.payments_v2
    WHERE provider='bepaid' AND provider_payment_id=q.bepaid_uid FOR UPDATE;
  SELECT * INTO STRICT o FROM public.orders_v2 WHERE id=q.processed_order_id FOR UPDATE;
  SELECT * INTO STRICT prior FROM public.payments_v2 WHERE provider='bepaid'
    AND provider_payment_id=v->>'previous_payment_uid' FOR UPDATE;
  SELECT * INTO STRICT parent_order FROM public.orders_v2 WHERE id=prior.order_id FOR UPDATE;
  SELECT * INTO STRICT source_order FROM public.orders_v2 WHERE id=s.order_id FOR UPDATE;
  PERFORM 1 FROM public.entitlements e WHERE e.user_id=t.user_id AND e.product_id=t.product_id FOR UPDATE;
  PERFORM 1 FROM public.access_grant_ledger l WHERE l.source_order_id=o.id FOR SHARE;
  PERFORM 1 FROM public.audit_logs a WHERE a.meta->>'queue_id'=q.id::text FOR SHARE;
  PERFORM 1 FROM public.payments_v2 r WHERE r.provider_payment_id IN(q.bepaid_uid,v->>'previous_payment_uid')
    OR r.meta->>'parent_payment_uid' IN(q.bepaid_uid,v->>'previous_payment_uid') FOR UPDATE;
  IF p.status::text IS DISTINCT FROM 'succeeded' OR p.is_deleted IS DISTINCT FROM false OR
     p.amount IS NULL OR p.amount<=0 OR coalesce(p.refunded_amount,0)<>0 OR
     p.order_id IS DISTINCT FROM o.id OR p.user_id IS DISTINCT FROM t.user_id OR p.profile_id IS DISTINCT FROM t.profile_id OR
     o.status::text IS DISTINCT FROM 'paid' OR o.is_deleted IS DISTINCT FROM false OR
     o.provider_payment_id IS DISTINCT FROM q.bepaid_uid OR
     o.user_id IS DISTINCT FROM t.user_id OR o.profile_id IS DISTINCT FROM t.profile_id OR
     o.product_id IS DISTINCT FROM t.product_id OR o.tariff_id IS DISTINCT FROM t.tariff_id OR
     o.final_price IS DISTINCT FROM p.amount OR o.currency IS DISTINCT FROM p.currency OR
     q.amount IS DISTINCT FROM p.amount OR q.currency IS DISTINCT FROM p.currency OR
     coalesce(o.meta->>'do_not_grant_access','false')<>'false' OR
     coalesce(o.meta->>'refund_candidate','false')<>'false' OR
     o.meta->>'grant_status'='suppressed_post_cancel_charge' OR
     prior.provider_payment_id=q.bepaid_uid OR prior.status::text IS DISTINCT FROM 'succeeded' OR
     prior.is_deleted IS DISTINCT FROM false OR coalesce(prior.refunded_amount,0)<>0 OR
     prior.amount IS DISTINCT FROM p.amount OR prior.currency IS DISTINCT FROM p.currency OR
     prior.user_id IS DISTINCT FROM t.user_id OR prior.profile_id IS DISTINCT FROM t.profile_id OR
     t.order_id IS DISTINCT FROM parent_order.id OR t.meta->>'initial_order_id' IS DISTINCT FROM parent_order.id::text OR
     parent_order.status::text IS DISTINCT FROM 'paid' OR parent_order.is_deleted IS DISTINCT FROM false OR
     parent_order.user_id IS DISTINCT FROM t.user_id OR parent_order.profile_id IS DISTINCT FROM t.profile_id OR
     parent_order.product_id IS DISTINCT FROM t.product_id OR parent_order.tariff_id IS DISTINCT FROM t.tariff_id OR
     parent_order.final_price IS DISTINCT FROM prior.amount OR parent_order.currency IS DISTINCT FROM prior.currency OR
     source_order.status::text IS DISTINCT FROM 'paid' OR source_order.is_deleted IS DISTINCT FROM false OR
     source_order.user_id IS DISTINCT FROM t.user_id OR source_order.product_id IS DISTINCT FROM t.product_id OR
     source_order.tariff_id IS DISTINCT FROM t.tariff_id OR
     EXISTS(SELECT 1 FROM public.orders_v2 h WHERE h.id IN(parent_order.id,source_order.id) AND
       (coalesce(h.meta->>'do_not_grant_access','false')<>'false' OR coalesce(h.meta->>'refund_candidate','false')<>'false'
        OR h.meta->>'grant_status'='suppressed_post_cancel_charge')) OR
     NOT EXISTS(SELECT 1 FROM public.entitlements e WHERE e.user_id=t.user_id AND e.product_id=t.product_id
       AND e.status='active' AND e.expires_at>=t.access_end_at) OR
     NOT EXISTS(SELECT 1 FROM public.access_grant_ledger l WHERE l.source_order_id=o.id) OR
     EXISTS(SELECT 1 FROM public.payments_v2 r WHERE (r.provider_payment_id IN(q.bepaid_uid,v->>'previous_payment_uid') OR
       r.meta->>'parent_payment_uid' IN(q.bepaid_uid,v->>'previous_payment_uid'))
       AND (r.amount<0 OR r.status::text='refunded' OR coalesce(r.refunded_amount,0)>0))
  THEN RAISE EXCEPTION 'schedule_repair_paid_proof_changed'; END IF;
  IF (SELECT count(*) FROM public.audit_logs a WHERE a.action='bepaid.paid_continuation.relinked'
      AND a.actor_user_id=actor
      AND a.meta @> jsonb_build_object('queue_id',q.id,'payment_uid',q.bepaid_uid,'target_subscription_id',t.id,'source_subscription_id',s.id))<>1 OR
     (SELECT count(*) FROM public.audit_logs a WHERE a.action='bepaid.paid_continuation.billing_synced'
      AND a.actor_user_id=actor AND a.meta @> jsonb_build_object('queue_id',q.id,'payment_uid',q.bepaid_uid,'target_subscription_id',t.id,
        'preserved_auto_renew',false,'billing_review_required',true))<>1
  THEN RAISE EXCEPTION 'schedule_repair_audit_proof_changed'; END IF;

  SELECT count(*) INTO n FROM public.audit_logs a WHERE a.action=correction AND a.meta->>'queue_id'=q.id::text;
  IF t.next_charge_at=(v->>'verified_next_charge_at')::timestamptz THEN
    IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.action=correction AND a.actor_user_id=actor
      AND a.meta @> jsonb_build_object('queue_id',q.id,'target_subscription_id',t.id,'payment_uid',q.bepaid_uid,
        'protected_target_md5',protected_before)
      AND (a.meta->>'after_next_charge_at')::timestamptz=t.next_charge_at)
    THEN RAISE EXCEPTION 'schedule_repair_replay_drift'; END IF;
    RETURN;
  END IF;
  IF n<>0 OR t.updated_at IS DISTINCT FROM (v->>'target_updated_at')::timestamptz OR
     t.next_charge_at IS DISTINCT FROM (v->>'before_next_charge_at')::timestamptz OR
     t.next_charge_at IS DISTINCT FROM t.access_end_at
  THEN RAISE EXCEPTION 'schedule_repair_target_conflict'; END IF;
  UPDATE public.subscriptions_v2 SET next_charge_at=(v->>'verified_next_charge_at')::timestamptz
    WHERE id=t.id AND updated_at=t.updated_at AND next_charge_at=t.next_charge_at;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'schedule_repair_rowcount_changed'; END IF;
  SELECT md5((to_jsonb(x)-'next_charge_at'-'updated_at')::text),x.next_charge_at INTO protected_after,after_next
    FROM public.subscriptions_v2 x WHERE x.id=t.id;
  IF protected_after IS DISTINCT FROM protected_before OR after_next IS DISTINCT FROM (v->>'verified_next_charge_at')::timestamptz
  THEN RAISE EXCEPTION 'schedule_repair_readback_failed'; END IF;
  INSERT INTO public.audit_logs(action,actor_type,actor_user_id,actor_label,meta)
  VALUES(correction,'user',actor,'reviewed_completed_bepaid_schedule_repair',jsonb_build_object(
    'queue_id',q.id,'target_subscription_id',t.id,'provider_row_id',ps.id,'payment_uid',q.bepaid_uid,
    'before_next_charge_at',t.next_charge_at,'after_next_charge_at',after_next,
    'protected_target_md5',protected_before,'provider_verified_at',v->>'verified_at'));
END;
$repair$;
