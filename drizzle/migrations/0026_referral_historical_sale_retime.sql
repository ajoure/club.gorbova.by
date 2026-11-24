-- Service-only repair endpoint. It changes dates, never constructs wallet entries.
-- Financial release is delegated to the existing canonical maturation function.
CREATE OR REPLACE FUNCTION public.referral_retime_historical_sales(
 p_operation_key text,p_items jsonb,p_expected_balances jsonb,p_dry_run boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp SET timezone='UTC' AS $$
DECLARE
 item jsonb; sale public.referral_sale_attributions%ROWTYPE; pay public.payments_v2%ROWTYPE;
 partner uuid; ids uuid[]; partners uuid[]; due_ids uuid[]:=ARRAY[]::uuid[];
 hold_days integer; expected_at timestamptz; replay_count integer:=0; changed integer:=0;
 matured integer:=0; before_balances jsonb; after_balances jsonb; before_txs uuid[];
 before_other_entries jsonb; after_other_entries jsonb;
BEGIN
 IF nullif(btrim(p_operation_key),'') IS NULL OR length(p_operation_key)>120
   OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 50
   OR p_dry_run IS NULL THEN RAISE EXCEPTION 'invalid_retime_request'; END IF;
 SELECT array_agg((x->>'id')::uuid ORDER BY x->>'id'),array_agg(DISTINCT (x->>'partner_id')::uuid ORDER BY (x->>'partner_id')::uuid)
 INTO ids,partners FROM jsonb_array_elements(p_items)x;
 IF array_position(ids,NULL) IS NOT NULL OR array_position(partners,NULL) IS NOT NULL
   OR cardinality(ids)<>(SELECT count(DISTINCT i) FROM unnest(ids)i) THEN RAISE EXCEPTION 'duplicate_or_missing_sale'; END IF;
 -- Use the same wallet serialization as maturation/redemption; fail immediately
 -- rather than wait in a sale-row/advisory-lock cycle with the scheduled worker.
 FOREACH partner IN ARRAY partners LOOP
  IF NOT pg_try_advisory_xact_lock(hashtextextended(partner::text,0)) THEN RAISE EXCEPTION 'wallet_busy_retry'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.referral_partners p WHERE p.id=partner AND p.status='active') THEN RAISE EXCEPTION 'partner_hold'; END IF;
 END LOOP;
 PERFORM 1 FROM public.referral_sale_attributions WHERE id=ANY(ids) ORDER BY id FOR UPDATE NOWAIT;
 SELECT s.hold_days INTO hold_days FROM public.referral_program_settings s WHERE singleton FOR SHARE;
 IF hold_days IS NULL THEN RAISE EXCEPTION 'missing_referral_settings'; END IF;
 SELECT jsonb_object_agg(k,referral_private.balance(k)) INTO before_balances FROM unnest(partners)k;
 FOR item IN SELECT x FROM jsonb_array_elements(p_items)x ORDER BY x->>'id' LOOP
  SELECT * INTO sale FROM public.referral_sale_attributions WHERE id=(item->>'id')::uuid;
  IF sale.id IS NULL OR sale.partner_id IS DISTINCT FROM (item->>'partner_id')::uuid
    OR sale.order_id IS DISTINCT FROM (item->>'order_id')::uuid OR sale.payment_id IS DISTINCT FROM (item->>'payment_id')::uuid
    OR sale.commission_minor IS DISTINCT FROM (item->>'commission_minor')::bigint
    OR sale.reversed_minor IS DISTINCT FROM (item->>'reversed_minor')::bigint
    OR sale.created_at IS DISTINCT FROM (item->>'expected_created_at')::timestamptz
    OR (sale.rule_snapshot->>'hold_days')::integer IS DISTINCT FROM hold_days
    OR hold_days IS DISTINCT FROM (item->>'hold_days')::integer THEN RAISE EXCEPTION 'sale_snapshot_changed'; END IF;
  IF sale.metadata->'administrative_historical' IS DISTINCT FROM 'true'::jsonb AND item->'allow_unmarked' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'historical_sale_required'; END IF;
  SELECT * INTO pay FROM public.payments_v2 WHERE id=sale.payment_id FOR SHARE;
  IF pay.id IS NULL OR pay.order_id IS DISTINCT FROM sale.order_id OR pay.status::text<>'succeeded' OR pay.is_deleted IS TRUE
    OR pay.amount<=0 OR pay.paid_at IS NULL OR pay.paid_at IS DISTINCT FROM (item->>'sale_paid_at')::timestamptz THEN RAISE EXCEPTION 'payment_snapshot_changed'; END IF;
  IF NOT referral_private.refunds_reconciled(sale.order_id,sale.commission_basis_minor,sale.commission_minor,sale.reversed_minor)
   THEN RAISE EXCEPTION 'maturation_preflight_changed'; END IF;
  expected_at:=pay.paid_at+make_interval(days=>hold_days);
  IF sale.metadata->'old_dates'->>'operation_key'=p_operation_key THEN
   IF sale.available_at IS DISTINCT FROM expected_at
    OR sale.status IS DISTINCT FROM (CASE WHEN item->>'expected_status'='pending' AND expected_at<=now() THEN 'available' ELSE item->>'expected_status' END)
    OR sale.metadata->'old_dates'->>'batch_hash' IS DISTINCT FROM md5(to_jsonb(ids)::text)
    OR (sale.metadata->'old_dates'->>'created_at')::timestamptz IS DISTINCT FROM (item->>'expected_created_at')::timestamptz
    OR (sale.metadata->'old_dates'->>'available_at')::timestamptz IS DISTINCT FROM (item->>'expected_available_at')::timestamptz
    THEN RAISE EXCEPTION 'repaired_date_changed'; END IF;
   replay_count:=replay_count+1; CONTINUE;
  END IF;
  IF sale.metadata ? 'old_dates' THEN RAISE EXCEPTION 'old_dates_already_recorded'; END IF;
  IF sale.status NOT IN ('pending','available') OR sale.status IS DISTINCT FROM item->>'expected_status'
    OR sale.available_at IS DISTINCT FROM (item->>'expected_available_at')::timestamptz THEN RAISE EXCEPTION 'sale_snapshot_changed'; END IF;
  IF sale.available_at IS NOT DISTINCT FROM expected_at THEN RAISE EXCEPTION 'date_already_correct'; END IF;
  IF sale.status='pending' AND expected_at<=now() THEN due_ids:=array_append(due_ids,sale.id); END IF;
 END LOOP;
 IF replay_count=cardinality(ids) THEN RETURN jsonb_build_object('already_applied',true,'changed',0,'matured',0,'balances',before_balances); END IF;
 IF replay_count<>0 THEN RAISE EXCEPTION 'partial_replay_requires_review'; END IF;
 IF before_balances IS DISTINCT FROM p_expected_balances THEN RAISE EXCEPTION 'balance_snapshot_changed'; END IF;
 -- The global canonical writer must not release an unrelated historical backlog.
 IF EXISTS(SELECT 1 FROM public.referral_sale_attributions a WHERE a.status IN ('pending','partially_reversed')
  AND a.available_at<=now() AND NOT(a.id=ANY(ids))) THEN RAISE EXCEPTION 'unrelated_due_sales'; END IF;
 IF EXISTS(SELECT 1 FROM public.referral_balance_transactions t WHERE t.idempotency_key IN
  (SELECT 'referral:mature:'||i FROM unnest(due_ids)i)) THEN RAISE EXCEPTION 'unexpected_prior_maturation'; END IF;
 -- Preview must reject the same paused/refund/ledger anomalies as execution,
 -- even while the original availability date is still in the future.
 IF EXISTS(WITH candidates AS (
  SELECT a.*,a.commission_minor-a.reversed_minor remaining,
   CASE WHEN coalesce((a.rule_snapshot->>'split_60_40_enabled')::boolean,false)
    THEN round(a.commission_minor*coalesce((a.rule_snapshot->>'withdrawable_percent_bps')::integer,10000)::numeric/10000)::bigint
     -round(a.reversed_minor*coalesce((a.rule_snapshot->>'withdrawable_percent_bps')::integer,10000)::numeric/10000)::bigint
    ELSE a.commission_minor-a.reversed_minor END cash
  FROM public.referral_sale_attributions a WHERE a.id=ANY(due_ids)
 ) SELECT 1 FROM candidates c LEFT JOIN public.referral_partners p ON p.id=c.partner_id
 WHERE p.status IS DISTINCT FROM 'active' OR c.cash<0 OR c.remaining-c.cash<0
  OR c.cash IS DISTINCT FROM (SELECT coalesce(sum(e.amount_minor),0) FROM public.referral_balance_entries e JOIN public.referral_balance_transactions t ON t.id=e.transaction_id WHERE t.source_id=c.id AND e.partner_id=c.partner_id AND e.bucket='pending')
  OR c.remaining-c.cash IS DISTINCT FROM (SELECT coalesce(sum(e.amount_minor),0) FROM public.referral_balance_entries e JOIN public.referral_balance_transactions t ON t.id=e.transaction_id WHERE t.source_id=c.id AND e.partner_id=c.partner_id AND e.bucket='internal_pending')
 ) THEN RAISE EXCEPTION 'maturation_preflight_changed'; END IF;
 IF p_dry_run THEN RETURN jsonb_build_object('dry_run',true,'no_writes',true,'date_changes',cardinality(ids),
  'expected_matured',cardinality(due_ids),'balances_before',before_balances); END IF;
 SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO before_txs FROM public.referral_balance_transactions;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO before_other_entries FROM public.referral_balance_entries e;
 FOR item IN SELECT x FROM jsonb_array_elements(p_items)x ORDER BY x->>'id' LOOP
  UPDATE public.referral_sale_attributions a SET
   available_at=(item->>'sale_paid_at')::timestamptz+make_interval(days=>hold_days),
   metadata=coalesce(a.metadata,'{}'::jsonb)||jsonb_build_object('old_dates',jsonb_build_object(
    'operation_key',p_operation_key,'batch_hash',md5(to_jsonb(ids)::text),'created_at',a.created_at,'available_at',a.available_at,'saved_at',now(),
    'sale_paid_at',(item->>'sale_paid_at')::timestamptz,'hold_days',hold_days))
  WHERE a.id=(item->>'id')::uuid;
  changed:=changed+1;
 END LOOP;
 -- Validate pending ledger/refunds/partner state using the existing manifest.
 IF (SELECT (public.referral_maturation_manifest()->>'eligible_count')::integer)<>cardinality(due_ids)
  OR (SELECT (public.referral_maturation_manifest()->>'anomaly_count')::integer)<>0
  OR (SELECT (public.referral_maturation_manifest()->>'paused_count')::integer)<>0 THEN RAISE EXCEPTION 'maturation_preflight_changed'; END IF;
 IF cardinality(due_ids)>0 THEN matured:=public.referral_mature_due_commissions(cardinality(due_ids)); END IF;
 IF matured<>cardinality(due_ids) OR changed<>cardinality(ids) THEN RAISE EXCEPTION 'unexpected_retime_count'; END IF;
 IF EXISTS(SELECT 1 FROM public.referral_balance_transactions t WHERE NOT(t.id=ANY(before_txs))
  AND (t.transaction_type<>'commission_available' OR NOT(t.source_id=ANY(due_ids)) OR t.idempotency_key<>'referral:mature:'||t.source_id))
  OR (SELECT count(*) FROM public.referral_balance_transactions t WHERE NOT(t.id=ANY(before_txs)))<>cardinality(due_ids)
  THEN RAISE EXCEPTION 'unexpected_ledger_side_effect'; END IF;
 -- Reject extra/offsetting entries as well as net balance changes from triggers.
 IF (WITH cash AS (
   SELECT a.id,a.partner_id,a.commission_minor-a.reversed_minor remaining,
    CASE WHEN coalesce((a.rule_snapshot->>'split_60_40_enabled')::boolean,false)
     THEN round(a.commission_minor*coalesce((a.rule_snapshot->>'withdrawable_percent_bps')::integer,10000)::numeric/10000)::bigint
      -round(a.reversed_minor*coalesce((a.rule_snapshot->>'withdrawable_percent_bps')::integer,10000)::numeric/10000)::bigint
     ELSE a.commission_minor-a.reversed_minor END cash
   FROM public.referral_sale_attributions a WHERE a.id=ANY(due_ids)
  ), expected AS (
   SELECT c.id source_id,c.partner_id,v.bucket,v.amount_minor FROM cash c
   CROSS JOIN LATERAL(VALUES('pending',-c.cash),('available',c.cash),('internal_pending',-(c.remaining-c.cash)),('internal',c.remaining-c.cash))v(bucket,amount_minor)
   WHERE v.amount_minor<>0
  ), actual AS (
   SELECT t.source_id,e.partner_id,e.bucket,e.amount_minor FROM public.referral_balance_entries e
   JOIN public.referral_balance_transactions t ON t.id=e.transaction_id WHERE NOT(t.id=ANY(before_txs))
  ) SELECT (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY source_id,partner_id,bucket,amount_minor),'[]') FROM expected e)
   IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY source_id,partner_id,bucket,amount_minor),'[]') FROM actual a)
 ) THEN RAISE EXCEPTION 'unexpected_maturation_entries'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]') INTO after_other_entries FROM public.referral_balance_entries e WHERE e.transaction_id=ANY(before_txs);
 IF after_other_entries IS DISTINCT FROM before_other_entries THEN RAISE EXCEPTION 'existing_ledger_mutated'; END IF;
 IF EXISTS(SELECT 1 FROM public.referral_sale_attributions a JOIN jsonb_array_elements(p_items)i ON a.id=(i->>'id')::uuid
  WHERE a.created_at IS DISTINCT FROM (i->>'expected_created_at')::timestamptz
   OR a.available_at IS DISTINCT FROM (i->>'sale_paid_at')::timestamptz+make_interval(days=>hold_days)
   OR (a.id=ANY(due_ids) AND a.status<>'available') OR a.commission_minor IS DISTINCT FROM (i->>'commission_minor')::bigint
   OR a.reversed_minor IS DISTINCT FROM (i->>'reversed_minor')::bigint) THEN RAISE EXCEPTION 'retime_readback_failed'; END IF;
 SELECT jsonb_object_agg(k,referral_private.balance(k)) INTO after_balances FROM unnest(partners)k;
 INSERT INTO public.audit_logs(actor_type,action,entity_type,meta) VALUES('system','referral.historical_dates_retimed','referral_sale_attribution',
  jsonb_build_object('operation_key',p_operation_key,'sale_ids',ids,'changed',changed,'matured',matured,'balances_before',before_balances,'balances_after',after_balances));
 RETURN jsonb_build_object('changed',changed,'matured',matured,'balances_before',before_balances,'balances_after',after_balances);
END $$;
REVOKE ALL ON FUNCTION public.referral_retime_historical_sales(text,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.referral_retime_historical_sales(text,jsonb,jsonb,boolean) TO service_role;
