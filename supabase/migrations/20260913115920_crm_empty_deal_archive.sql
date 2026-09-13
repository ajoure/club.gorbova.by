-- Reversible cleanup only. Financial rows, contractual differences, active
-- checkout sessions and every declared order dependency are excluded.
CREATE TABLE public.crm_archived_deal_duplicates (
  source_order_id uuid PRIMARY KEY REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  canonical_order_id uuid NOT NULL REFERENCES public.orders_v2(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL,
  identity_key text NOT NULL,
  row_fingerprint text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  CHECK(source_order_id<>canonical_order_id)
);
ALTER TABLE public.crm_archived_deal_duplicates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_archived_deal_duplicates FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.crm_archived_deal_duplicates TO service_role;

CREATE OR REPLACE FUNCTION public.crm_legacy_pending_identity(p_order jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
SELECT md5(jsonb_build_object(
  'recipient',CASE WHEN p_order->>'user_id' IS NOT NULL THEN 'user:'||(p_order->>'user_id') ELSE 'profile:'||(p_order->>'profile_id') END,
  'product',p_order->'product_id','tariff',p_order->'tariff_id','offer',p_order->'offer_id',
  'amount',p_order->'final_price','currency',upper(p_order->>'currency'),
  'payment_plan',p_order->'payment_plan_id','pricing_stage',p_order->'pricing_stage_id',
  'flow',p_order->'flow_id','trial',coalesce(p_order->'is_trial','false'::jsonb),
  'company',p_order->'company_id','payer_type',p_order->'payer_type',
  'month',p_order#>'{meta,deal_month}','access_days',p_order#>'{purchase_snapshot,access_days}',
  'replacement',p_order->'source_deal_id','replacement_subscription',p_order#>'{meta,replacement_of_subscription_v2_id}',
  'cohort',coalesce(p_order#>'{meta,cohort_id}',p_order#>'{purchase_snapshot,cohort_id}'),
  'period',coalesce(p_order#>'{meta,period}',p_order#>'{purchase_snapshot,period}'),
  'composition',coalesce(p_order#>'{meta,composable_checkout,items}',p_order#>'{purchase_snapshot,composition}'),
  'kind',CASE WHEN p_order#>>'{meta,flow}'='rr_installment' THEN 'rr_installment'
    WHEN p_order#>>'{meta,checkout_kind}'='invoice' THEN 'invoice'
    WHEN coalesce(p_order#>>'{meta,payment_type}',p_order#>>'{meta,type}','') LIKE '%subscription%' THEN 'subscription'
    ELSE 'one_time' END
)::text);
$$;
REVOKE ALL ON FUNCTION public.crm_legacy_pending_identity(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_legacy_pending_identity(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_empty_order_blocker(p_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r record; found_link boolean; t text; o public.orders_v2%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders_v2 WHERE id=p_order_id;
  IF NOT FOUND THEN RETURN 'missing'; END IF;
  IF coalesce(o.is_deleted,false) OR o.status<>'pending' OR coalesce(o.paid_amount,0)<>0
    OR o.product_id IS NULL OR o.tariff_id IS NULL OR (o.user_id IS NULL AND o.profile_id IS NULL)
    OR coalesce(o.final_price,0)<=0 THEN RETURN 'not_empty_pending'; END IF;
  IF o.created_at>=now()-interval '24 hours' THEN RETURN 'recent_order'; END IF;
  IF coalesce(o.meta->>'checkout_created_at','')<>'' THEN
    BEGIN
      IF (o.meta->>'checkout_created_at')::timestamptz>=now()-interval '24 hours' THEN RETURN 'recent_checkout'; END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN 'unknown_checkout_date'; END;
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_archived_deal_duplicates WHERE canonical_order_id=p_order_id) THEN RETURN 'canonical_mapping_owner'; END IF;
  -- Introspect all FK columns, including newly added dependencies. The archive
  -- table itself is handled above; audit history remains untouched.
  FOR r IN SELECT ns.nspname schema_name,cl.relname table_name,a.attname column_name
    FROM pg_constraint c JOIN pg_class cl ON cl.oid=c.conrelid
    JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    JOIN pg_attribute a ON a.attrelid=cl.oid AND a.attnum=c.conkey[1]
    WHERE c.contype='f' AND c.confrelid='public.orders_v2'::regclass
      AND array_length(c.conkey,1)=1 AND ns.nspname='public'
      AND cl.relname<>'crm_archived_deal_duplicates'
  LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',r.schema_name,r.table_name,r.column_name)
      INTO found_link USING p_order_id;
    IF found_link THEN RETURN 'dependency:'||r.table_name||'.'||r.column_name; END IF;
  END LOOP;
  -- These durable payloads may reference orders without an FK. Search the
  -- whole row so schema evolution cannot silently drop a JSON path check.
  FOREACH t IN ARRAY ARRAY['provider_events','payment_links','payment_reconcile_queue','payment_reconcile_queue_archive','ai_generated_documents','document_package_sessions'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I r WHERE to_jsonb(r)::text LIKE $1)',t)
        INTO found_link USING '%'||p_order_id::text||'%';
      IF found_link THEN RETURN 'payload_dependency:'||t; END IF;
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.orders_v2 other WHERE other.id<>p_order_id
    AND (coalesce(other.meta,'{}'::jsonb)::text LIKE '%'||p_order_id::text||'%'
      OR coalesce(other.purchase_snapshot,'{}'::jsonb)::text LIKE '%'||p_order_id::text||'%')) THEN
    RETURN 'order_json_dependency';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_empty_order_blocker(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_empty_order_blocker(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_preview_empty_deal_duplicates(p_source_ids uuid[] DEFAULT NULL)
RETURNS TABLE(source_order_id uuid,canonical_order_id uuid,identity_key text,row_fingerprint text,blocked_reason text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
WITH candidates AS (
  SELECT o.*,public.crm_legacy_pending_identity(to_jsonb(o)) identity,
    md5(to_jsonb(o)::text) fingerprint
  FROM public.orders_v2 o WHERE NOT coalesce(o.is_deleted,false) AND o.status='pending'
    AND coalesce(o.paid_amount,0)=0 AND o.product_id IS NOT NULL AND o.tariff_id IS NOT NULL
    AND (o.user_id IS NOT NULL OR o.profile_id IS NOT NULL) AND o.final_price>0
), ranked AS (
  SELECT c.*,first_value(id) OVER(PARTITION BY identity ORDER BY created_at DESC,id) canonical
  FROM candidates c
)
SELECT id,canonical,identity,fingerprint,public.crm_empty_order_blocker(id) FROM ranked WHERE id<>canonical AND (p_source_ids IS NULL OR id=ANY(p_source_ids));
$$;
REVOKE ALL ON FUNCTION public.crm_preview_empty_deal_duplicates(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_preview_empty_deal_duplicates(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_archive_empty_deal_duplicates(p_batch_id uuid,p_candidates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r record; proposed record; n integer:=0; expected integer;
BEGIN
  IF p_batch_id IS NULL OR jsonb_typeof(p_candidates)<>'array' THEN RAISE EXCEPTION 'invalid_archive_batch'; END IF;
  expected:=jsonb_array_length(p_candidates);
  IF expected<1 OR expected>25 THEN RAISE EXCEPTION 'archive_batch_size'; END IF;
  IF (SELECT count(DISTINCT value->>'source_order_id') FROM jsonb_array_elements(p_candidates))<>expected THEN RAISE EXCEPTION 'duplicate_batch_ids'; END IF;
  IF EXISTS(SELECT 1 FROM public.crm_archived_deal_duplicates WHERE batch_id=p_batch_id) THEN
    IF (SELECT count(*) FROM public.crm_archived_deal_duplicates WHERE batch_id=p_batch_id AND restored_at IS NULL)=expected
      AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(p_candidates) AS x(source_order_id uuid,canonical_order_id uuid,identity_key text,row_fingerprint text)
        WHERE NOT EXISTS(SELECT 1 FROM public.crm_archived_deal_duplicates a WHERE a.batch_id=p_batch_id
          AND a.source_order_id=x.source_order_id AND a.canonical_order_id=x.canonical_order_id
          AND a.identity_key=x.identity_key AND a.row_fingerprint=x.row_fingerprint)) THEN
      RETURN jsonb_build_object('archived',expected,'already_applied',true);
    END IF;
    RAISE EXCEPTION 'archive_batch_conflict';
  END IF;
  -- Lock source and keeper rows in a deterministic order before rechecking.
  PERFORM o.id FROM public.orders_v2 o WHERE o.id IN (
    SELECT (value->>'source_order_id')::uuid FROM jsonb_array_elements(p_candidates)
    UNION SELECT (value->>'canonical_order_id')::uuid FROM jsonb_array_elements(p_candidates)
  ) ORDER BY o.id FOR UPDATE;
  FOR proposed IN SELECT * FROM jsonb_to_recordset(p_candidates)
    AS x(source_order_id uuid,canonical_order_id uuid,identity_key text,row_fingerprint text)
  LOOP
    SELECT * INTO r FROM public.crm_preview_empty_deal_duplicates(ARRAY[proposed.source_order_id]) p;
    IF NOT FOUND OR r.canonical_order_id IS DISTINCT FROM proposed.canonical_order_id
      OR r.identity_key IS DISTINCT FROM proposed.identity_key OR r.row_fingerprint IS DISTINCT FROM proposed.row_fingerprint
      OR r.blocked_reason IS NOT NULL THEN RAISE EXCEPTION 'archive_candidate_changed'; END IF;
    INSERT INTO public.crm_archived_deal_duplicates(source_order_id,canonical_order_id,batch_id,identity_key,row_fingerprint)
      VALUES(r.source_order_id,r.canonical_order_id,p_batch_id,r.identity_key,r.row_fingerprint);
    UPDATE public.orders_v2 SET is_deleted=true WHERE id=r.source_order_id AND NOT is_deleted;
    IF NOT FOUND THEN RAISE EXCEPTION 'archive_write_changed'; END IF;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','crm.empty_duplicate.archived','orders_v2',r.source_order_id,
        jsonb_build_object('source_order_id',r.source_order_id,'canonical_order_id',r.canonical_order_id,'batch_id',p_batch_id));
    n:=n+1;
  END LOOP;
  IF n<>expected THEN RAISE EXCEPTION 'archive_count_mismatch'; END IF;
  RETURN jsonb_build_object('archived',n,'already_applied',false);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_archive_empty_deal_duplicates(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_archive_empty_deal_duplicates(uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_restore_empty_deal_archive(p_batch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE public.orders_v2 o SET is_deleted=false FROM public.crm_archived_deal_duplicates a
    WHERE a.source_order_id=o.id AND a.batch_id=p_batch_id AND a.restored_at IS NULL;
  GET DIAGNOSTICS n=ROW_COUNT;
  UPDATE public.crm_archived_deal_duplicates SET restored_at=now() WHERE batch_id=p_batch_id AND restored_at IS NULL;
  INSERT INTO public.audit_logs(actor_type,action,entity_type,meta)
    VALUES('system','crm.empty_duplicate.batch_restored','orders_v2',jsonb_build_object('batch_id',p_batch_id,'restored',n));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_restore_empty_deal_archive(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_restore_empty_deal_archive(uuid) TO service_role;

-- A late confirmed receipt restores the original purchase. Never rewrite money
-- to a different order or discard the callback merely because it was archived.
CREATE OR REPLACE FUNCTION public.crm_restore_archived_purchase_on_money()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE restore_id uuid;
BEGIN
  IF TG_TABLE_NAME='payments_v2' THEN
    IF coalesce(NEW.is_deleted,false) OR NEW.status NOT IN ('succeeded','refunded','partially_refunded') OR
      (coalesce(NEW.amount,0)=0 AND coalesce(NEW.refunded_amount,0)=0) OR
      coalesce(NEW.transaction_type,'payment') IN ('void','Отмена','authorization','tokenization') THEN RETURN NEW; END IF;
    restore_id:=NEW.order_id;
  ELSE
    IF coalesce(NEW.paid_amount,0)<=0 AND NEW.status NOT IN ('paid','partial','refunded') THEN RETURN NEW; END IF;
    restore_id:=NEW.id;
  END IF;
  IF EXISTS(SELECT 1 FROM public.crm_archived_deal_duplicates WHERE source_order_id=restore_id AND restored_at IS NULL) THEN
    IF TG_TABLE_NAME='orders_v2' THEN NEW.is_deleted:=false;
    ELSE UPDATE public.orders_v2 SET is_deleted=false WHERE id=restore_id; END IF;
    UPDATE public.crm_archived_deal_duplicates SET restored_at=now() WHERE source_order_id=restore_id;
    INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,meta)
      VALUES('system','crm.empty_duplicate.money_restored','orders_v2',restore_id,jsonb_build_object('order_id',restore_id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.crm_restore_archived_purchase_on_money() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_restore_archived_order_money BEFORE UPDATE OF status,paid_amount ON public.orders_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_restore_archived_purchase_on_money();
CREATE TRIGGER crm_restore_archived_payment_money AFTER INSERT OR UPDATE OF status,amount,refunded_amount ON public.payments_v2
  FOR EACH ROW EXECUTE FUNCTION public.crm_restore_archived_purchase_on_money();
