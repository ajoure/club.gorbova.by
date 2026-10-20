-- Reviewed ONE-row data-only DML operation through Lovable Cloud run_sql.
-- No DO/BEGIN/GUC/schema/RPC. One statement is one atomic PostgreSQL transaction.
-- Replace ONLY the JSON literal below with the protected approved 14-key input:
-- JSON.stringify(input), then double every single quote for the SQL literal.
-- Never commit the input. Run canonical exact dry-run/provider GET immediately before.
WITH input AS MATERIALIZED (
  SELECT '__REVIEWED_INPUT_JSON__'::jsonb AS v
), params AS MATERIALIZED (
  SELECT v FROM input
  WHERE jsonb_typeof(v)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(v))=14
    AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(v) k WHERE k NOT IN
      ('target_id','source_id','provider_row_id','queue_id','payment_uid','previous_payment_uid',
       'target_updated_at','source_updated_at','provider_updated_at','queue_updated_at',
       'protected_target_md5','before_next_charge_at','verified_next_charge_at','verified_at'))
    AND NOT EXISTS(SELECT 1 FROM jsonb_each(v) e WHERE jsonb_typeof(e.value)<>'string' OR e.value='""'::jsonb)
    AND (v->>'verified_at')::timestamptz BETWEEN clock_timestamp()-interval '5 minutes' AND clock_timestamp()+interval '5 seconds'
    AND (v->>'verified_next_charge_at')::timestamptz>clock_timestamp()
), rights AS MATERIALIZED (
  SELECT e.* FROM public.entitlements e JOIN public.subscriptions_v2 t
    ON e.user_id=t.user_id AND e.product_id=t.product_id
  JOIN params ON t.id=(v->>'target_id')::uuid FOR UPDATE OF e
), ledger AS MATERIALIZED (
  SELECT l.* FROM public.access_grant_ledger l JOIN public.payment_reconcile_queue q ON l.source_order_id=q.processed_order_id
  JOIN params ON q.id=(v->>'queue_id')::uuid FOR SHARE OF l
), proof_audits AS MATERIALIZED (
  SELECT a.* FROM public.audit_logs a JOIN params ON a.meta->>'queue_id'=v->>'queue_id' FOR SHARE OF a
), refunds AS MATERIALIZED (
  SELECT r.* FROM public.payments_v2 r JOIN params ON r.provider_payment_id IN(v->>'payment_uid',v->>'previous_payment_uid')
    OR r.meta->>'parent_payment_uid' IN(v->>'payment_uid',v->>'previous_payment_uid') FOR UPDATE OF r
), candidates AS MATERIALIZED (
  SELECT t.id,t.updated_at,t.next_charge_at,
    md5((to_jsonb(t)-'next_charge_at'-'updated_at')::text) protected_before,
    (ps.meta->'paid_continuation_repair'->>'operator_user_id')::uuid actor,
    ps.id provider_row_id,q.id queue_id,q.bepaid_uid payment_uid,v,
    (v->>'verified_next_charge_at')::timestamptz verified_next
  FROM params
  JOIN public.subscriptions_v2 t ON t.id=(v->>'target_id')::uuid
  JOIN public.subscriptions_v2 s ON s.id=(v->>'source_id')::uuid
  JOIN public.provider_subscriptions ps ON ps.id=(v->>'provider_row_id')::uuid
  JOIN public.payment_reconcile_queue q ON q.id=(v->>'queue_id')::uuid
  JOIN public.payments_v2 p ON p.provider='bepaid' AND p.provider_payment_id=q.bepaid_uid
  JOIN public.payments_v2 prior ON prior.provider='bepaid' AND prior.provider_payment_id=v->>'previous_payment_uid'
  JOIN public.orders_v2 o ON o.id=q.processed_order_id
  JOIN public.orders_v2 parent_order ON parent_order.id=prior.order_id
  JOIN public.orders_v2 source_order ON source_order.id=s.order_id
  WHERE NOT coalesce((md5((to_jsonb(t)-'next_charge_at'-'updated_at')::text) IS DISTINCT FROM v->>'protected_target_md5' OR
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
     (ps.meta->'paid_continuation_repair')->>'source_subscription_id' IS DISTINCT FROM s.id::text OR
     (ps.meta->'paid_continuation_repair')->>'target_subscription_id' IS DISTINCT FROM t.id::text OR
     (ps.meta->'paid_continuation_repair')->>'payment_uid' IS DISTINCT FROM q.bepaid_uid OR (ps.meta->'paid_continuation_repair')->>'queue_id' IS DISTINCT FROM q.id::text OR
     (ps.meta->'paid_continuation_repair')->>'billing_review_required' IS DISTINCT FROM 'true' OR
     (ps.meta->'paid_continuation_repair')->>'billing_policy' IS DISTINCT FROM 'preserve_local_auto_renew' OR
     (ps.meta->'paid_continuation_repair')->>'operator_user_id' IS NULL),false)
    AND NOT coalesce((p.status::text IS DISTINCT FROM 'succeeded' OR p.is_deleted IS DISTINCT FROM false OR
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
     coalesce(parent_order.meta->>'do_not_grant_access','false')<>'false' OR
     coalesce(parent_order.meta->>'refund_candidate','false')<>'false' OR
     parent_order.meta->>'grant_status'='suppressed_post_cancel_charge' OR
     coalesce(source_order.meta->>'do_not_grant_access','false')<>'false' OR
     coalesce(source_order.meta->>'refund_candidate','false')<>'false' OR
     source_order.meta->>'grant_status'='suppressed_post_cancel_charge' OR
     NOT EXISTS(SELECT 1 FROM rights e WHERE e.user_id=t.user_id AND e.product_id=t.product_id
       AND e.status='active' AND e.expires_at>=t.access_end_at) OR
     NOT EXISTS(SELECT 1 FROM ledger l WHERE l.source_order_id=o.id) OR
     EXISTS(SELECT 1 FROM refunds r WHERE (r.provider_payment_id IN(q.bepaid_uid,v->>'previous_payment_uid') OR
       r.meta->>'parent_payment_uid' IN(q.bepaid_uid,v->>'previous_payment_uid'))
       AND (r.amount<0 OR r.status::text='refunded' OR coalesce(r.refunded_amount,0)>0))),false)
    AND (SELECT count(*) FROM refunds r WHERE r.provider='bepaid' AND r.provider_payment_id=q.bepaid_uid)=1
    AND (SELECT count(*) FROM refunds r WHERE r.provider='bepaid' AND r.provider_payment_id=v->>'previous_payment_uid')=1
    AND (SELECT count(*) FROM proof_audits a WHERE a.action='bepaid.paid_continuation.relinked'
      AND a.actor_user_id=(ps.meta->'paid_continuation_repair'->>'operator_user_id')::uuid
      AND a.meta @> jsonb_build_object('queue_id',q.id,'payment_uid',q.bepaid_uid,'target_subscription_id',t.id,'source_subscription_id',s.id))=1
    AND (SELECT count(*) FROM proof_audits a WHERE a.action='bepaid.paid_continuation.billing_synced'
      AND a.actor_user_id=(ps.meta->'paid_continuation_repair'->>'operator_user_id')::uuid
      AND a.meta @> jsonb_build_object('queue_id',q.id,'payment_uid',q.bepaid_uid,'target_subscription_id',t.id,
        'preserved_auto_renew',false,'billing_review_required',true))=1
    AND NOT EXISTS(SELECT 1 FROM proof_audits a WHERE a.action='bepaid.paid_continuation.schedule_corrected')
    AND t.updated_at=(v->>'target_updated_at')::timestamptz
    AND t.next_charge_at=(v->>'before_next_charge_at')::timestamptz AND t.next_charge_at=t.access_end_at
  FOR UPDATE OF t,s,ps,q,p,prior,o,parent_order,source_order
), corrected AS (
  UPDATE public.subscriptions_v2 dst SET next_charge_at=c.verified_next
  FROM candidates c WHERE dst.id=c.id AND dst.updated_at=c.updated_at AND dst.next_charge_at=c.next_charge_at
    AND (c.v->>'verified_at')::timestamptz>=clock_timestamp()-interval '5 minutes'
  RETURNING dst.next_charge_at,md5((to_jsonb(dst)-'next_charge_at'-'updated_at')::text) protected_after,
    c.id,c.protected_before,c.actor,c.provider_row_id,c.queue_id,c.payment_uid,c.v,c.verified_next,c.next_charge_at before_next
)
INSERT INTO public.audit_logs(action,actor_type,actor_user_id,actor_label,meta)
SELECT 'bepaid.paid_continuation.schedule_corrected','user',actor,'reviewed_completed_bepaid_schedule_repair',
  jsonb_build_object('queue_id',queue_id,'target_subscription_id',id,'provider_row_id',provider_row_id,'payment_uid',payment_uid,
    'before_next_charge_at',before_next,'after_next_charge_at',next_charge_at,
    'protected_target_md5',protected_before,'provider_verified_at',v->>'verified_at',
    -- A trigger overwrite aborts the WHOLE DML statement, including the UPDATE.
    'readback_pass',1/(CASE WHEN protected_after=protected_before AND next_charge_at=verified_next THEN 1 ELSE 0 END))
FROM corrected
RETURNING 'provider_schedule_corrected'::text AS result;
