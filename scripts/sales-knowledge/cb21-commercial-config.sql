-- Managed, parameterized data operation. GitHub is the sole code source.
-- Default is DRY RUN: only transaction-local tables are written.
-- Managed runner sets cb21.sync_options JSON in the SAME SQL session before BEGIN:
-- {"apply":false,"expected_fingerprint":null,"addon_opens_at":null,"document_periods":null}
-- document_periods: {accountant:{from,to},chief:{from,to},business:{from,to},alumni:{from,to},gift:{from,to}}.
-- Date values require owner input. No guessed shifting of legal periods.
-- On execute set apply=true with the reviewed dry-run fingerprint and approved dates.
BEGIN;
CREATE TEMP TABLE _cb21_options ON COMMIT DROP AS SELECT coalesce(nullif(current_setting('cb21.sync_options',true),''),'{}')::jsonb AS v;
CREATE TEMP TABLE _cb21_pairs(role text PRIMARY KEY, source uuid UNIQUE,target uuid UNIQUE,price numeric,old_price numeric,days integer) ON COMMIT DROP;
INSERT INTO _cb21_pairs VALUES
('accountant','38ee08c4-21db-4a97-86e6-303bd96c48db','3c749a5d-fa43-5552-b064-c66611dedd58',1790,2090,180),
('chief','a18df7a7-9c8b-4e63-9ea9-b6887c23927f','3b427617-b192-57fa-9ac4-e85c28a7ad2f',2190,2590,240),
('business','767bb895-30fa-49c9-8f31-d0794590020a','c558c63b-dd2f-5cc8-a990-ef4f0b3064c2',2990,3490,300),
('alumni','98539e5d-cd29-4e5b-96cd-cb1e18579e2e','dbdb839e-84a0-4c00-8b8c-e60e4c558d94',1495,2990,300),
('gift','04e6c302-f1ff-4d7d-a588-d30681e7a450','40240c3e-a2eb-40e6-8609-da2e17c910e5',0,NULL,300);
CREATE TEMP TABLE _cb21_offer_pairs(source uuid PRIMARY KEY,target uuid UNIQUE) ON COMMIT DROP;
INSERT INTO _cb21_offer_pairs VALUES
('fb4b275b-94f5-4f5e-8caa-0a0c6153f6d5','2929ba16-51e1-5d4a-aaff-ae3754dde386'),
('b6476800-cc42-4332-836d-5e63ccc83c47','35523d6e-06cc-5012-8070-14fb03c1e07a'),
('fc127066-c0f6-45a3-871a-cdcf7d9fba32','d515cd28-8bec-5c6e-bc8b-56181d95f58d'),
('77dd831a-948c-4097-8977-fa644024ef19','24e92d96-1872-57ed-934e-c9097b7f3381'),
('c1218245-8e4a-4e08-91cd-31d18afefea3','c4f7218c-cfd8-5380-911e-b25cfaad938e'),
('d749583b-86ba-44cc-9d9c-bd0e38a70137','3ed3a575-e1bd-5c64-81c1-73fd52005a40'),
('1f9cf610-561d-4e1f-a208-1715c710e8b1','50b5041c-dd8b-50bb-9c3d-0a628f7863a1'),
('759c1fbc-ae2e-42d2-bca9-b7902b4ef887','f00c3934-5305-556e-8a65-ed8464e5ace4'),
('02750b7d-3f88-4525-818f-6dab5b437325','5f79fccc-015f-5846-b423-aea2a2ba1ed1'),
('4c6d6110-5c9b-419c-82ef-524dfe44ecc1','1ec06293-920c-550d-bd14-4e8cbcdb5754'),
('c7f5221e-715e-4b4e-8312-f542616d9416','8028fdcf-fdf0-50fb-ad78-27dc3ca35e1a'),
('fdb8bffc-b2c4-41c3-8368-b4ae0241b0d1','91b14409-0e35-5034-aac7-ad820dbe871d'),
('379f9ce6-5bbe-4d62-8881-b1f889547970',md5('cb21-full-sync-v2:379f9ce6-5bbe-4d62-8881-b1f889547970')::uuid),
('010982b2-c153-40c2-9b43-65d13894c508',md5('cb21-full-sync-v2:010982b2-c153-40c2-9b43-65d13894c508')::uuid),
('7a3eb87b-79a8-4de7-b264-8b2c42b267d3',md5('cb21-full-sync-v2:7a3eb87b-79a8-4de7-b264-8b2c42b267d3')::uuid),
('1134dda8-0089-4b4c-bbbc-2ef253a6aa26',md5('cb21-full-sync-v2:1134dda8-0089-4b4c-bbbc-2ef253a6aa26')::uuid),
('158112c1-8900-4cea-80b2-4785659c5176',md5('cb21-full-sync-v2:158112c1-8900-4cea-80b2-4785659c5176')::uuid),
('d86e2f34-df5a-4b22-bf50-1d7764020f50',md5('cb21-full-sync-v2:d86e2f34-df5a-4b22-bf50-1d7764020f50')::uuid),
('277098ce-1def-48fe-8b83-ef365549e754',md5('cb21-full-sync-v2:277098ce-1def-48fe-8b83-ef365549e754')::uuid),
('d33afea7-b8d0-4e11-ab7b-d30057938db2',md5('cb21-full-sync-v2:d33afea7-b8d0-4e11-ab7b-d30057938db2')::uuid);
CREATE TEMP TABLE _cb21_tariffs (LIKE public.tariffs INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE _cb21_offers (LIKE public.tariff_offers INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE _cb21_addons (LIKE public.offer_addons INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE _cb21_rules (LIKE public.access_rules INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TEMP TABLE _cb21_diff(table_name text,id uuid,before_row jsonb,after_row jsonb) ON COMMIT DROP;

-- Existing mapped rules are already equal, except accountant's three VIP modules.
-- Translation is checked by title plus exact course-root parent, never array order.
CREATE TEMP TABLE _cb21_modules ON COMMIT DROP AS
 SELECT a.id AS source,b.id AS target FROM public.training_modules a JOIN public.training_modules b
 ON regexp_replace(lower(trim(a.title)),'^(20|21) поток[ :]*','','g')=regexp_replace(lower(trim(b.title)),'^(20|21) поток[ :]*','','g')
 WHERE a.parent_module_id='2e5cbc7b-bbaf-4384-b894-bbd98d7f524e' AND b.parent_module_id='4365e913-36f1-432e-ab16-748c3ca6826a';
CREATE OR REPLACE FUNCTION pg_temp.cb21_map_config(j jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s text:=coalesce(j,'{}')::text; m record;
BEGIN
 s:=replace(s,'3e43fb28-8322-41bc-bfee-714731bdc630','2b7bf6d4-ad8d-46ad-9399-7f96c307c596');
 s:=replace(s,'2e5cbc7b-bbaf-4384-b894-bbd98d7f524e','4365e913-36f1-432e-ab16-748c3ca6826a');
 FOR m IN SELECT * FROM _cb21_pairs LOOP s:=replace(s,m.source::text,m.target::text); END LOOP;
 FOR m IN SELECT * FROM _cb21_offer_pairs LOOP s:=replace(s,m.source::text,m.target::text); END LOOP;
 FOR m IN SELECT * FROM _cb21_modules LOOP s:=replace(s,m.source::text,m.target::text); END LOOP;
 s:=replace(replace(s,'20 поток','21 поток'),'20-й поток','21-й поток');
 RETURN s::jsonb;
END $$;
DO $$
DECLARE p record; a public.tariffs; b public.tariffs; o public.tariff_offers; op record; r public.access_rules;
 cfg jsonb:=(SELECT v FROM _cb21_options); j jsonb; dest uuid; ar record; src_addon public.offer_addons; aa public.offer_addons; offer_price numeric;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sales_campaigns WHERE code='cb21-owner-test' AND mode='off') THEN RAISE EXCEPTION 'campaign_must_be_off'; END IF;
 IF EXISTS(SELECT 1 FROM public.sales_jobs j JOIN public.sales_conversations c ON c.id=j.conversation_id JOIN public.sales_campaigns sc ON sc.id=c.campaign_id WHERE sc.code='cb21-owner-test' AND j.status IN('claimed','sending')) THEN RAISE EXCEPTION 'inflight_sales_job'; END IF;
 IF (SELECT count(*) FROM public.tariffs WHERE id IN(SELECT source FROM _cb21_pairs) AND product_id='3e43fb28-8322-41bc-bfee-714731bdc630')<>5
 OR (SELECT count(*) FROM public.tariffs WHERE id IN(SELECT target FROM _cb21_pairs) AND product_id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596')<>5 THEN RAISE EXCEPTION 'tariff_scope_changed'; END IF;
 IF EXISTS(SELECT source FROM _cb21_modules GROUP BY source HAVING count(*)<>1) OR EXISTS(SELECT target FROM _cb21_modules GROUP BY target HAVING count(*)<>1) THEN RAISE EXCEPTION 'ambiguous_module_mapping'; END IF;
 FOR p IN SELECT * FROM _cb21_pairs LOOP
  SELECT * INTO STRICT a FROM public.tariffs WHERE id=p.source;
  SELECT * INTO STRICT b FROM public.tariffs WHERE id=p.target;
  IF a.access_days<>p.days OR b.access_days<>p.days OR NOT a.is_active OR NOT b.is_active THEN RAISE EXCEPTION 'tariff_access_changed'; END IF;
  IF p.role IN('accountant','chief','business') AND ((b.meta->'card_config'->>'price_display')::numeric<>p.price OR b.price_monthly<>p.price) THEN RAISE EXCEPTION 'cb21_price_changed'; END IF;
  -- Preserve identifiers/site wiring/current price. Copy behavior and presentation from20.
  j:=to_jsonb(a)||jsonb_build_object('id',b.id,'product_id',b.product_id,'code',b.code,'public_id',b.public_id,'created_at',b.created_at,'updated_at',b.updated_at,
   'price_monthly',b.price_monthly,'original_price',b.original_price,'getcourse_offer_id',b.getcourse_offer_id,'getcourse_offer_code',b.getcourse_offer_code,
   'meta',(coalesce(b.meta,'{}')-'course_access')||jsonb_build_object('card_config',coalesce(a.meta->'card_config','{}')||jsonb_build_object('price_display',p.price,'old_price',p.old_price)));
  -- Do not advertise a club entitlement absent from BOTH source and target rules.
  IF p.role='accountant' THEN j:=jsonb_set(j,'{description}',to_jsonb(replace(coalesce(a.description,''),'Доступ к клубу «Буква закона»'||chr(10),''))); END IF;
  INSERT INTO _cb21_tariffs SELECT * FROM jsonb_populate_record(null::public.tariffs,j);
  FOR r IN SELECT * FROM public.access_rules WHERE tariff_id=p.source AND is_active LOOP
   j:=pg_temp.cb21_map_config(to_jsonb(r));
   SELECT id INTO dest FROM public.access_rules WHERE tariff_id=p.target AND is_active AND grant_target_type=r.grant_target_type AND target_ref=j->>'target_ref';
   IF dest IS NULL OR (SELECT count(*) FROM public.access_rules WHERE tariff_id=p.target AND is_active AND grant_target_type=r.grant_target_type AND target_ref=j->>'target_ref')<>1 THEN RAISE EXCEPTION 'access_rule_mapping_changed'; END IF;
   IF r.target_ref='2e5cbc7b-bbaf-4384-b894-bbd98d7f524e' AND r.conditions->>'access_mode'='partial' AND EXISTS(
    SELECT 1 FROM jsonb_array_elements_text(j->'conditions'->'allowed_module_ids') x WHERE NOT EXISTS(SELECT 1 FROM public.training_modules m WHERE m.id=x.value::uuid AND m.parent_module_id='4365e913-36f1-432e-ab16-748c3ca6826a')) THEN RAISE EXCEPTION 'unmapped_course_module'; END IF;
   INSERT INTO _cb21_rules SELECT * FROM jsonb_populate_record(null::public.access_rules,j||jsonb_build_object('id',dest,'created_at',(SELECT created_at FROM public.access_rules WHERE id=dest),'updated_at',(SELECT updated_at FROM public.access_rules WHERE id=dest)));
  END LOOP;
  FOR op IN SELECT mp.* FROM _cb21_offer_pairs mp JOIN public.tariff_offers so ON so.id=mp.source WHERE so.tariff_id=p.source LOOP
   SELECT * INTO STRICT o FROM public.tariff_offers WHERE id=op.source;
   IF NOT o.is_active OR o.getcourse_offer_id IS NOT NULL OR o.auto_charge_offer_id IS NOT NULL THEN RAISE EXCEPTION 'source_offer_needs_mapping_review'; END IF;
   offer_price:=CASE WHEN p.role='gift' THEN 1 ELSE p.price END;
   j:=pg_temp.cb21_map_config(to_jsonb(o))||jsonb_build_object('id',op.target,'tariff_id',p.target,'amount',offer_price);
   j:=jsonb_set(j,'{meta}',(j->'meta')||jsonb_build_object('sales_generation',CASE WHEN p.role='alumni' THEN 'cb21-alumni-v2' ELSE 'cb21-full-sync-v2' END,'source_offer_id',o.id));
   IF p.role='alumni' THEN j:=jsonb_set(j,'{meta}',j->'meta'||'{"sales_eligibility":"cb2_since_2024","sales_discount_percent":50}'::jsonb); END IF;
   IF j->'meta' ? 'document_defaults' THEN
    j:=jsonb_set(j,'{meta,document_defaults}',((j#>'{meta,document_defaults}')-'service_period_from'-'service_period_to')||jsonb_build_object('amount',offer_price,'unit_price',offer_price));
    IF cfg->'document_periods'->p.role IS NOT NULL THEN
     j:=jsonb_set(j,'{meta,document_defaults}',j#>'{meta,document_defaults}'||jsonb_build_object('service_period_from',cfg->'document_periods'->p.role->>'from','service_period_to',cfg->'document_periods'->p.role->>'to'));
    END IF;
   END IF;
   j:=j||coalesce((SELECT jsonb_build_object('created_at',created_at,'updated_at',updated_at) FROM public.tariff_offers WHERE id=op.target),jsonb_build_object('created_at',null,'updated_at',null));
   INSERT INTO _cb21_offers SELECT * FROM jsonb_populate_record(null::public.tariff_offers,j);
   -- Alumni gets the owner's explicit addon exception: same nine discounted
   -- modules as BusinessLady, matched by button role, WITHOUT adding club rules.
   IF p.role IN('business','alumni') THEN
    FOR src_addon IN SELECT ad.* FROM public.offer_addons ad JOIN public.tariff_offers bo ON bo.id=ad.parent_offer_id
     WHERE bo.tariff_id='767bb895-30fa-49c9-8f31-d0794590020a' AND bo.is_active AND ad.is_active
      AND bo.meta->>'slot_role'=o.meta->>'slot_role' LOOP
     IF src_addon.pricing_mode<>'percent_discount' OR src_addon.discount_percent<>50 THEN RAISE EXCEPTION 'addon_discount_changed'; END IF;
     SELECT * INTO aa FROM public.offer_addons WHERE parent_offer_id=op.target AND addon_offer_id=src_addon.addon_offer_id AND is_active;
     IF (SELECT count(*) FROM public.offer_addons WHERE parent_offer_id=op.target AND addon_offer_id=src_addon.addon_offer_id AND is_active)>1 THEN RAISE EXCEPTION 'duplicate_target_addon'; END IF;
     j:=to_jsonb(src_addon)||jsonb_build_object('id',coalesce(aa.id,md5('cb21-full-sync-v2:'||op.target||':'||src_addon.id)::uuid),'parent_offer_id',op.target,
      'access_delivery_mode','fixed_date','access_opens_at',cfg->>'addon_opens_at','created_at',aa.created_at,'updated_at',aa.updated_at,
      'meta',src_addon.meta||jsonb_build_object('sales_generation','cb21-full-sync-v2','source_addon_id',src_addon.id));
     INSERT INTO _cb21_addons SELECT * FROM jsonb_populate_record(null::public.offer_addons,j);
    END LOOP;
   END IF;
  END LOOP;
 END LOOP;
 FOR o IN SELECT * FROM public.tariff_offers WHERE id IN('4d01edc1-6189-4017-ba43-922e7e9479ac','9687b2a8-585d-4770-9505-2a01030a093a','80780ddb-cafd-4427-ae8d-872853596120','e5b64e47-08d0-4ef5-8bed-2524d1ac8170') LOOP
  -- Keep all historical offers resolvable for existing links/obligations. Only
  -- remove them from new-sale selection; never rewrite their amounts/settings.
  INSERT INTO _cb21_offers SELECT * FROM jsonb_populate_record(null::public.tariff_offers,to_jsonb(o)||jsonb_build_object('meta',coalesce(o.meta,'{}')||'{"sales_legacy_only":true}'::jsonb));
 END LOOP;
 IF (SELECT count(*) FROM _cb21_tariffs)<>5 OR (SELECT count(*) FROM _cb21_offers)<>24 OR (SELECT count(*) FROM _cb21_addons)<>72 OR (SELECT count(*) FROM _cb21_rules)<>12 THEN RAISE EXCEPTION 'configuration_rowcounts_changed'; END IF;
 IF EXISTS(SELECT 1 FROM _cb21_rules WHERE tariff_id='dbdb839e-84a0-4c00-8b8c-e60e4c558d94' AND grant_target_type='club') THEN RAISE EXCEPTION 'alumni_club_forbidden'; END IF;
END $$;
INSERT INTO _cb21_diff SELECT 'tariffs',d.id,to_jsonb(b)-'updated_at'-'created_at',to_jsonb(d)-'updated_at'-'created_at' FROM _cb21_tariffs d LEFT JOIN public.tariffs b USING(id) WHERE (to_jsonb(b)-'updated_at'-'created_at') IS DISTINCT FROM (to_jsonb(d)-'updated_at'-'created_at');
INSERT INTO _cb21_diff SELECT 'tariff_offers',d.id,to_jsonb(b)-'updated_at'-'created_at',to_jsonb(d)-'updated_at'-'created_at' FROM _cb21_offers d LEFT JOIN public.tariff_offers b USING(id) WHERE (to_jsonb(b)-'updated_at'-'created_at') IS DISTINCT FROM (to_jsonb(d)-'updated_at'-'created_at');
INSERT INTO _cb21_diff SELECT 'offer_addons',d.id,to_jsonb(b)-'updated_at'-'created_at',to_jsonb(d)-'updated_at'-'created_at' FROM _cb21_addons d LEFT JOIN public.offer_addons b USING(id) WHERE (to_jsonb(b)-'updated_at'-'created_at') IS DISTINCT FROM (to_jsonb(d)-'updated_at'-'created_at');
INSERT INTO _cb21_diff SELECT 'access_rules',d.id,to_jsonb(b)-'updated_at'-'created_at',to_jsonb(d)-'updated_at'-'created_at' FROM _cb21_rules d LEFT JOIN public.access_rules b USING(id) WHERE (to_jsonb(b)-'updated_at'-'created_at') IS DISTINCT FROM (to_jsonb(d)-'updated_at'-'created_at');
CREATE TEMP TABLE _cb21_plan ON COMMIT DROP AS SELECT md5(coalesce(jsonb_agg(to_jsonb(d) ORDER BY table_name,id)::text,'[]')) AS fingerprint FROM _cb21_diff d;
SELECT p.fingerprint,(SELECT count(*) FROM _cb21_diff) AS changed_rows,
 (SELECT jsonb_object_agg(table_name,n) FROM(SELECT table_name,count(*) n FROM _cb21_diff GROUP BY table_name)s) AS rowcounts,
 (SELECT v->'document_periods' IS NOT NULL AND v->>'addon_opens_at' IS NOT NULL FROM _cb21_options) AS dates_supplied
 FROM _cb21_plan p;
-- Review changed field names without personal data or payment URLs.
SELECT table_name,id,ARRAY(SELECT k FROM jsonb_object_keys(after_row) k WHERE before_row->k IS DISTINCT FROM after_row->k ORDER BY k) AS changed_fields FROM _cb21_diff ORDER BY table_name,id;
DO $$
DECLARE cfg jsonb:=(SELECT v FROM _cb21_options); p record;
BEGIN
 IF coalesce((cfg->>'apply')::boolean,false) IS NOT TRUE THEN RETURN; END IF;
 IF cfg->>'expected_fingerprint' IS DISTINCT FROM (SELECT fingerprint FROM _cb21_plan) THEN RAISE EXCEPTION 'dry_run_fingerprint_changed'; END IF;
 IF cfg->>'addon_opens_at' IS NULL OR cfg->'document_periods' IS NULL THEN RAISE EXCEPTION 'owner_dates_required'; END IF;
 FOR p IN SELECT role FROM _cb21_pairs LOOP
  IF (cfg->'document_periods'->p.role->>'from')::date IS NULL OR (cfg->'document_periods'->p.role->>'to')::date IS NULL
   OR (cfg->'document_periods'->p.role->>'to')::date < (cfg->'document_periods'->p.role->>'from')::date THEN RAISE EXCEPTION 'invalid_document_period'; END IF;
 END LOOP;
 UPDATE public.tariffs b SET name=d.name,badge=d.badge,features=d.features,subtitle=d.subtitle,is_active=d.is_active,is_public=d.is_public,is_popular=d.is_popular,sort_order=d.sort_order,trial_days=d.trial_days,visible_to=d.visible_to,access_days=d.access_days,description=d.description,trial_price=d.trial_price,period_label=d.period_label,visible_from=d.visible_from,display_order=d.display_order,document_params=d.document_params,discount_enabled=d.discount_enabled,discount_percent=d.discount_percent,trial_auto_charge=d.trial_auto_charge,trial_enabled=d.trial_enabled,meta=d.meta,updated_at=now() FROM _cb21_tariffs d WHERE b.id=d.id AND EXISTS(SELECT 1 FROM _cb21_diff WHERE table_name='tariffs' AND id=d.id);
 UPDATE public.tariff_offers b SET amount=d.amount,auto_charge_after_trial=d.auto_charge_after_trial,auto_charge_amount=d.auto_charge_amount,auto_charge_delay_days=d.auto_charge_delay_days,auto_charge_offer_id=d.auto_charge_offer_id,button_label=d.button_label,first_payment_delay_days=d.first_payment_delay_days,getcourse_offer_id=d.getcourse_offer_id,installment_count=d.installment_count,installment_interval_days=d.installment_interval_days,is_active=d.is_active,is_installment=d.is_installment,is_primary=d.is_primary,meta=d.meta,offer_type=d.offer_type,payment_method=d.payment_method,reentry_amount=d.reentry_amount,reject_virtual_cards=d.reject_virtual_cards,requires_card_tokenization=d.requires_card_tokenization,sort_order=d.sort_order,tariff_id=d.tariff_id,trial_days=d.trial_days,visible_from=d.visible_from,visible_to=d.visible_to,updated_at=now() FROM _cb21_offers d WHERE b.id=d.id AND EXISTS(SELECT 1 FROM _cb21_diff WHERE table_name='tariff_offers' AND id=d.id);
 INSERT INTO public.tariff_offers (id,amount,auto_charge_after_trial,auto_charge_amount,auto_charge_delay_days,auto_charge_offer_id,button_label,first_payment_delay_days,getcourse_offer_id,installment_count,installment_interval_days,is_active,is_installment,is_primary,meta,offer_type,payment_method,reentry_amount,reject_virtual_cards,requires_card_tokenization,sort_order,tariff_id,trial_days,visible_from,visible_to) SELECT d.id,d.amount,d.auto_charge_after_trial,d.auto_charge_amount,d.auto_charge_delay_days,d.auto_charge_offer_id,d.button_label,d.first_payment_delay_days,d.getcourse_offer_id,d.installment_count,d.installment_interval_days,d.is_active,d.is_installment,d.is_primary,d.meta,d.offer_type,d.payment_method,d.reentry_amount,d.reject_virtual_cards,d.requires_card_tokenization,d.sort_order,d.tariff_id,d.trial_days,d.visible_from,d.visible_to FROM _cb21_offers d WHERE NOT EXISTS(SELECT 1 FROM public.tariff_offers b WHERE b.id=d.id);
 UPDATE public.offer_addons b SET access_delivery_mode=d.access_delivery_mode,access_duration_days=d.access_duration_days,access_opens_at=d.access_opens_at,addon_offer_id=d.addon_offer_id,addon_product_id=d.addon_product_id,addon_tariff_id=d.addon_tariff_id,allow_repurchase_after_expiry=d.allow_repurchase_after_expiry,discount_percent=d.discount_percent,fixed_amount=d.fixed_amount,is_active=d.is_active,is_default_selected=d.is_default_selected,is_required=d.is_required,meta=d.meta,parent_offer_id=d.parent_offer_id,pricing_mode=d.pricing_mode,sort_order=d.sort_order,visible_from=d.visible_from,visible_to=d.visible_to,updated_at=now() FROM _cb21_addons d WHERE b.id=d.id AND EXISTS(SELECT 1 FROM _cb21_diff WHERE table_name='offer_addons' AND id=d.id);
 INSERT INTO public.offer_addons (id,access_delivery_mode,access_duration_days,access_opens_at,addon_offer_id,addon_product_id,addon_tariff_id,allow_repurchase_after_expiry,discount_percent,fixed_amount,is_active,is_default_selected,is_required,meta,parent_offer_id,pricing_mode,sort_order,visible_from,visible_to) SELECT d.id,d.access_delivery_mode,d.access_duration_days,d.access_opens_at,d.addon_offer_id,d.addon_product_id,d.addon_tariff_id,d.allow_repurchase_after_expiry,d.discount_percent,d.fixed_amount,d.is_active,d.is_default_selected,d.is_required,d.meta,d.parent_offer_id,d.pricing_mode,d.sort_order,d.visible_from,d.visible_to FROM _cb21_addons d WHERE NOT EXISTS(SELECT 1 FROM public.offer_addons b WHERE b.id=d.id);
 UPDATE public.access_rules b SET conditions=d.conditions,created_by=d.created_by,duration_days=d.duration_days,grant_target_type=d.grant_target_type,is_active=d.is_active,notes=d.notes,priority=d.priority,product_id=d.product_id,target_label=d.target_label,target_ref=d.target_ref,tariff_id=d.tariff_id,updated_by=d.updated_by,updated_at=now() FROM _cb21_rules d WHERE b.id=d.id AND EXISTS(SELECT 1 FROM _cb21_diff WHERE table_name='access_rules' AND id=d.id);
 IF EXISTS(SELECT 1 FROM _cb21_diff) THEN
  INSERT INTO public.audit_logs(actor_type,action,meta) SELECT 'system','cb21.commercial_config_sync',jsonb_build_object('fingerprint',(SELECT fingerprint FROM _cb21_plan),'changes',jsonb_agg(to_jsonb(d) ORDER BY table_name,id)) FROM _cb21_diff d;
 END IF;
END $$;
COMMIT;
