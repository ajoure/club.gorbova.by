-- Fixed source-backed date repair. Migration installs only; RPC defaults to dry-run.
CREATE OR REPLACE FUNCTION public.admin_repair_historical_cb_dates(_payload jsonb, _mode text DEFAULT 'dry-run')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET lock_timeout='5s' AS $dates$
DECLARE
 item jsonb; old_row public.orders_v2%ROWTYPE; after_row public.orders_v2%ROWTYPE;
 expected_meta jsonb; changes int:=0; replay int:=0; result jsonb; rollback_message text;
 repair_id constant text:='hist-cb17-18-source-dates-20260911-v1';
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;
 IF _payload IS NULL OR _mode IS NULL OR _mode NOT IN ('dry-run','rollback','execute') THEN RAISE EXCEPTION 'Explicit payload and supported mode required'; END IF;
 IF encode(sha256(convert_to(_payload::text,'UTF8')),'hex') <> ALL(ARRAY[/* FIXED_HASHES */]::text[])
 THEN RAISE EXCEPTION 'Unapproved date payload'; END IF;
 IF jsonb_array_length(_payload)<1 OR jsonb_array_length(_payload)>20 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 BEGIN
 FOR item IN SELECT value FROM jsonb_array_elements(_payload) LOOP
  SELECT * INTO STRICT old_row FROM public.orders_v2 WHERE id=(item->>'id')::uuid FOR UPDATE;
  IF old_row.reconcile_source IS DISTINCT FROM 'owner_confirmed_historical'
   OR old_row.meta->>'historical_batch_id' IS DISTINCT FROM 'hist-cb17-18-20260911-v1'
   OR old_row.meta->>'history_only' IS DISTINCT FROM 'true'
   OR old_row.meta->>'source_spreadsheet_id' IS DISTINCT FROM '1dw8ljnBwfyNn26INHdwxt7MdRGs7aX5qkby7V1wWUq8'
   OR old_row.meta->'source_refs' IS DISTINCT FROM item->'refs'
   OR old_row.product_id IS DISTINCT FROM (item->>'product_id')::uuid
   OR old_row.status::text IS DISTINCT FROM 'paid' OR old_row.is_deleted IS TRUE
   OR old_row.base_price IS DISTINCT FROM 0 OR old_row.final_price IS DISTINCT FROM 0 OR old_row.paid_amount IS DISTINCT FROM 0
   OR old_row.meta->>'deal_month' IS NOT NULL
  THEN RAISE EXCEPTION 'Historical source or financial state changed'; END IF;
  expected_meta := old_row.meta || jsonb_build_object('source_purchase_date_unknown',false,
   'source_deal_date',item->>'deal_date','source_date_ref',item->>'source_date_ref',
   'source_date_column','D','source_timezone','Europe/Moscow',
   'source_paid_at',item->'source_paid_at','historical_date_repair_id',repair_id);
  IF old_row.meta->>'historical_date_repair_id'=repair_id THEN
   IF old_row.deal_date IS DISTINCT FROM (item->>'deal_date')::timestamptz OR old_row.meta IS DISTINCT FROM expected_meta
   THEN RAISE EXCEPTION 'Previously repaired date changed'; END IF;
   replay:=replay+1;CONTINUE;
  END IF;
  IF old_row.deal_date IS NOT NULL OR old_row.meta->>'source_purchase_date_unknown' IS DISTINCT FROM 'true'
  THEN RAISE EXCEPTION 'Refusing to overwrite an existing purchase date'; END IF;
  changes:=changes+1;
  IF _mode='dry-run' THEN CONTINUE; END IF;
  UPDATE public.orders_v2 SET deal_date=(item->>'deal_date')::timestamptz,meta=expected_meta WHERE id=old_row.id;
  SELECT * INTO STRICT after_row FROM public.orders_v2 WHERE id=old_row.id;
  IF after_row.deal_date IS DISTINCT FROM (item->>'deal_date')::timestamptz OR after_row.meta IS DISTINCT FROM expected_meta
   OR (to_jsonb(after_row)-ARRAY['deal_date','meta','updated_at']) IS DISTINCT FROM (to_jsonb(old_row)-ARRAY['deal_date','meta','updated_at'])
  THEN RAISE EXCEPTION 'Unexpected date repair side effect'; END IF;
  INSERT INTO public.audit_logs(action,actor_type,actor_label,meta) VALUES('HISTORICAL_PURCHASE_DATE_REPAIRED','system','Source-backed historical date repair',
   jsonb_build_object('repair_id',repair_id,'order_id',old_row.id,'before_deal_date',old_row.deal_date,'after_deal_date',after_row.deal_date,
    'before_meta',old_row.meta,'after_meta',after_row.meta,'source_refs',item->'refs'));
 END LOOP;
 -- History-only orders must remain without independent money/access side effects.
 IF EXISTS(SELECT 1 FROM public.payments_v2 WHERE order_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(_payload)))
 OR EXISTS(SELECT 1 FROM public.subscriptions_v2 WHERE order_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(_payload)))
 OR EXISTS(SELECT 1 FROM public.entitlements WHERE order_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(_payload)))
 OR EXISTS(SELECT 1 FROM public.entitlement_sources WHERE order_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(_payload)))
 OR EXISTS(SELECT 1 FROM public.access_grant_ledger WHERE order_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(_payload)) OR source_order_id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(_payload)))
 OR EXISTS(SELECT 1 FROM public.referral_balance_transactions WHERE source_id::text IN(SELECT value->>'id' FROM jsonb_array_elements(_payload)))
 THEN RAISE EXCEPTION 'Unexpected historical money/access linkage'; END IF;
 result:=jsonb_build_object('total',jsonb_array_length(_payload),'changes',changes,'already_repaired',replay,'executed',_mode<>'dry-run');
 IF _mode='rollback' THEN RAISE EXCEPTION USING ERRCODE='ZHD01',MESSAGE=result::text; END IF;
 RETURN result;
 EXCEPTION WHEN SQLSTATE 'ZHD01' THEN
  GET STACKED DIAGNOSTICS rollback_message=MESSAGE_TEXT;
  RETURN rollback_message::jsonb||jsonb_build_object('rolled_back',true);
 END;
END;
$dates$;
REVOKE ALL ON FUNCTION public.admin_repair_historical_cb_dates(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_repair_historical_cb_dates(jsonb,text) TO service_role;
