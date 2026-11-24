-- One authorized financial repair. No customer identifiers are embedded in source.
-- Source cohort is frozen by a full financial snapshot fingerprint.
-- Apply only through the approved managed migration operator, never a client RPC.
DO $repair$
DECLARE
 op constant text := 'referral-hold-sale-date-20261124-v1';
 fingerprint text; items jsonb; balances jsonb; preview jsonb; result jsonb;
 old_claims text := current_setting('request.jwt.claims',true);
 old_claim text := current_setting('request.jwt.claim',true);
 matching_ids integer;
 pending_partner uuid; available_partner uuid;
BEGIN
 IF NOT pg_has_role(session_user,'postgres','MEMBER') THEN
  RAISE EXCEPTION 'managed_migration_operator_required';
 END IF;
 -- COHORT_ID_HASHES_BEGIN: no-op only when this production cohort is absent.
 SELECT count(*) INTO matching_ids FROM public.referral_sale_attributions WHERE md5(id::text) IN ('42be009d5fb609942b9f25473f3d8747','021bcb2a1f1835313de0b8fd370f787e','4021e701155d3658f5195dd23c5deb83','9190db684def0d584da8e58f46ebc292','2a1194749be0781d443fec492193d97e');
 -- COHORT_ID_HASHES_END
 IF matching_ids=0 THEN RETURN; END IF;
 IF matching_ids<>5 THEN RAISE EXCEPTION 'incomplete_frozen_cohort'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 LOCK TABLE public.referral_sale_attributions IN SHARE ROW EXCLUSIVE MODE;
 SELECT md5(jsonb_agg(jsonb_build_array(
  a.id::text,a.partner_id::text,a.order_id::text,a.payment_id::text,
  CASE WHEN a.metadata->'old_dates'->>'operation_key'=op THEN
   CASE WHEN a.created_at>timestamptz '2026-11-01' THEN 'pending' ELSE 'available' END ELSE a.status END,
  to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  to_char(CASE WHEN a.metadata->'old_dates'->>'operation_key'=op THEN (a.metadata->'old_dates'->>'available_at')::timestamptz ELSE a.available_at END AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  a.commission_minor::text,a.commission_basis_minor::text,a.commission_percent_bps::text,a.reversed_minor::text,
  to_char(p.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),p.status::text,
  round(p.amount*100)::bigint::text,round(o.paid_amount*100)::bigint::text,o.currency,coalesce(p.is_deleted,false)::text,round(coalesce(p.refunded_amount,0)*100)::bigint::text
 ) ORDER BY a.id)::text) INTO fingerprint
 FROM public.referral_sale_attributions a JOIN public.payments_v2 p ON p.id=a.payment_id JOIN public.orders_v2 o ON o.id=a.order_id;
 IF fingerprint IS DISTINCT FROM '4927e1b499eed318c8954541b711ad75' THEN RAISE EXCEPTION 'frozen_financial_snapshot_changed'; END IF;
 SELECT jsonb_agg(jsonb_build_object(
  'id',a.id,'partner_id',a.partner_id,'order_id',a.order_id,'payment_id',a.payment_id,
  'commission_minor',a.commission_minor,'reversed_minor',a.reversed_minor,
  'expected_created_at',a.created_at,
  'expected_available_at',CASE WHEN a.metadata->'old_dates'->>'operation_key'=op THEN (a.metadata->'old_dates'->>'available_at')::timestamptz ELSE a.available_at END,
  'expected_status',CASE WHEN a.created_at>timestamptz '2026-11-01' THEN 'pending' ELSE 'available' END,
  'sale_paid_at',p.paid_at,'hold_days',14,'allow_unmarked',a.commission_minor=250000
 ) ORDER BY a.id) INTO items
 FROM public.referral_sale_attributions a JOIN public.payments_v2 p ON p.id=a.payment_id
 WHERE a.commission_minor<>19500;
 IF jsonb_array_length(items)<>4 THEN RAISE EXCEPTION 'frozen_cohort_count_changed'; END IF;
 SELECT (x->>'partner_id')::uuid INTO pending_partner FROM jsonb_array_elements(items)x WHERE x->>'expected_status'='pending' LIMIT 1;
 SELECT (x->>'partner_id')::uuid INTO available_partner FROM jsonb_array_elements(items)x WHERE x->>'expected_status'='available' LIMIT 1;
 balances:=jsonb_build_object(pending_partner::text,jsonb_build_object('available',0,'held',0,'internal',0,'internal_held',0,'internal_pending',118743,'paid',0,'pending',79162),
  available_partner::text,jsonb_build_object('available',118000,'held',0,'internal',13000,'internal_held',0,'internal_pending',0,'paid',0,'pending',0));
 preview:=public.referral_retime_historical_sales(op,items,balances,true);
 IF coalesce((preview->>'already_applied')::boolean,false) THEN RETURN; END IF;
 IF preview->>'no_writes'<>'true' OR (preview->>'date_changes')::int<>4 OR (preview->>'expected_matured')::int<>2 THEN RAISE EXCEPTION 'repair_dry_run_changed'; END IF;
 -- The managed DB operator establishes service context only in this transaction.
 -- No token, user impersonation, permanent role grant or auth function change.
 PERFORM set_config('request.jwt.claim','',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.referral_retime_historical_sales(op,items,balances,false);
 PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
 PERFORM set_config('request.jwt.claim',coalesce(old_claim,''),true);
 IF (result->>'changed')::int<>4 OR (result->>'matured')::int<>2 THEN RAISE EXCEPTION 'repair_effect_count_changed'; END IF;
 IF result->'balances_after'->pending_partner::text IS DISTINCT FROM jsonb_build_object('available',79162,'held',0,'internal',118743,'internal_held',0,'internal_pending',0,'paid',0,'pending',0)
 OR result->'balances_after'->available_partner::text IS DISTINCT FROM balances->available_partner::text THEN RAISE EXCEPTION 'repair_balance_readback_failed'; END IF;
END $repair$;
