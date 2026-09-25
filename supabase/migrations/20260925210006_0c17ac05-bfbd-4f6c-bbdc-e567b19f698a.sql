-- Exact PR564 operation; transaction is owned by the managed migration runner.
-- Reviewed production fingerprint: drift aborts before any persistent write.
SET LOCAL cb21.legacy_copy_options = '{"apply":true,"expected_fingerprint":"48cacee66e4c315631073cdb7925f455"}';
DO $$ BEGIN IF current_setting('cb21.legacy_copy_options',true) IS DISTINCT FROM '{"apply":true,"expected_fingerprint":"48cacee66e4c315631073cdb7925f455"}' THEN RAISE EXCEPTION 'cb21_not_single_transaction'; END IF; END $$;
-- One-time managed configuration repair, not runtime business logic.
-- The administrator's existing "only previously created links" setting.
-- Default dry-run writes TEMP tables only. Set cb21.legacy_copy_options in the
-- same SQL session: {"apply":true,"expected_fingerprint":"reviewed value"}.
-- Keep active flags, prices, existing links, subscriptions and access unchanged.
CREATE TEMP TABLE _cb21_legacy_options ON COMMIT DROP AS
 SELECT coalesce(nullif(current_setting('cb21.legacy_copy_options',true),''),'{}')::jsonb v;
CREATE TEMP TABLE _cb21_legacy_scope(tariff_id uuid PRIMARY KEY,amount numeric) ON COMMIT DROP;
INSERT INTO _cb21_legacy_scope VALUES
 ('63939f2d-2980-466f-8cd9-c29c99efa800',1950),
 ('9afbf9a0-4bb8-42bb-bc30-da6e983f5262',1650),
 ('ce13a0b5-124d-42c3-ae2a-c454c4c08ee0',2650);
DO $$
BEGIN
 IF coalesce((SELECT (v->>'apply')::boolean FROM _cb21_legacy_options),false) THEN
  PERFORM 1 FROM public.sales_campaigns WHERE code='cb21-owner-test' FOR UPDATE;
  PERFORM 1 FROM public.tariffs WHERE id IN(SELECT tariff_id FROM _cb21_legacy_scope) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.tariff_offers WHERE tariff_id IN(SELECT tariff_id FROM _cb21_legacy_scope) ORDER BY id FOR UPDATE;
 END IF;
 IF (SELECT count(*) FROM public.sales_campaigns WHERE code='cb21-owner-test' AND mode='off' AND enabled_at IS NULL)<>1
 THEN RAISE EXCEPTION 'campaign_must_be_off'; END IF;
 IF EXISTS(SELECT 1 FROM public.sales_jobs j JOIN public.sales_conversations c ON c.id=j.conversation_id
   JOIN public.sales_campaigns sc ON sc.id=c.campaign_id WHERE sc.code='cb21-owner-test'
   AND j.status IN('queued','claimed','sending')) THEN RAISE EXCEPTION 'active_sales_job'; END IF;
 IF (SELECT count(*) FROM public.tariffs t JOIN _cb21_legacy_scope s ON s.tariff_id=t.id
   WHERE t.product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596' AND t.is_active AND NOT t.is_public)<>3
 THEN RAISE EXCEPTION 'legacy_tariff_scope_changed'; END IF;
 IF EXISTS(SELECT s.tariff_id FROM _cb21_legacy_scope s LEFT JOIN public.tariff_offers o ON o.tariff_id=s.tariff_id
   GROUP BY s.tariff_id HAVING count(o.id)<>5 OR count(o.id) FILTER(WHERE o.is_active)<>4)
 THEN RAISE EXCEPTION 'legacy_offer_scope_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.tariff_offers o JOIN _cb21_legacy_scope s ON o.tariff_id=s.tariff_id
   WHERE (o.is_active AND o.amount IS DISTINCT FROM s.amount)
   OR o.meta ? 'purchase_eligibility' OR o.meta ? 'source_offer_id')
 THEN RAISE EXCEPTION 'legacy_offer_terms_changed'; END IF;
END $$;
CREATE TEMP TABLE _cb21_legacy_diff ON COMMIT DROP AS
 SELECT o.id,to_jsonb(o) before_row,
   coalesce(o.meta,'{}'::jsonb)||jsonb_build_object('sales_legacy_only',true) after_meta
 FROM public.tariff_offers o JOIN _cb21_legacy_scope s ON s.tariff_id=o.tariff_id
 WHERE o.meta->'sales_legacy_only' IS DISTINCT FROM 'true'::jsonb;
CREATE TEMP TABLE _cb21_legacy_plan ON COMMIT DROP AS
 SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY id)::text,'[]')) fingerprint,
   count(*) changed_rows FROM _cb21_legacy_diff d;
SELECT * FROM _cb21_legacy_plan;
SELECT id,ARRAY['meta.sales_legacy_only'] changed_fields FROM _cb21_legacy_diff ORDER BY id;
DO $$
DECLARE cfg jsonb:=(SELECT v FROM _cb21_legacy_options); affected integer;
BEGIN
 IF coalesce((cfg->>'apply')::boolean,false) IS NOT TRUE THEN RETURN; END IF;
 IF cfg->>'expected_fingerprint' IS DISTINCT FROM (SELECT fingerprint FROM _cb21_legacy_plan)
 THEN RAISE EXCEPTION 'dry_run_fingerprint_changed'; END IF;
 UPDATE public.tariff_offers o SET meta=d.after_meta,updated_at=now()
 FROM _cb21_legacy_diff d WHERE o.id=d.id AND to_jsonb(o)=d.before_row;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>(SELECT changed_rows FROM _cb21_legacy_plan) THEN RAISE EXCEPTION 'legacy_update_count_changed'; END IF;
 IF affected>0 THEN
  INSERT INTO public.audit_logs(actor_type,action,meta)
  SELECT 'system','cb21.legacy_copy_offers',jsonb_build_object(
    'fingerprint',(SELECT fingerprint FROM _cb21_legacy_plan),'changes',jsonb_agg(to_jsonb(d) ORDER BY id))
  FROM _cb21_legacy_diff d;
 END IF;
END $$;