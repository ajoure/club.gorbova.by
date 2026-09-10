-- Future-only catalogue generation. No historical order/payment/access writes.
-- Expected first application: flows +1, tariffs +3, offers +12, rules +10,
-- offer_addons +108, tariff_prices +0; only old public visibility and the specified page change.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('cb21-october-2026-catalogue', 0));
CREATE TEMP TABLE cb_tariff_map(old_id uuid, new_id uuid, old_price numeric, price numeric,
  old_display_price numeric, months integer, monthly numeric, slot text) ON COMMIT DROP;
INSERT INTO cb_tariff_map VALUES
('9afbf9a0-4bb8-42bb-bc30-da6e983f5262','3c749a5d-fa43-5552-b064-c66611dedd58',1650,1790,2090,6,139,'accountant'),
('63939f2d-2980-466f-8cd9-c29c99efa800','3b427617-b192-57fa-9ac4-e85c28a7ad2f',1950,2190,2590,9,183,'chief_accountant'),
('ce13a0b5-124d-42c3-ae2a-c454c4c08ee0','c558c63b-dd2f-5cc8-a990-ef4f0b3064c2',2650,2990,3490,12,249,'business_lady');
CREATE TEMP TABLE cb_offer_map(old_id uuid, new_id uuid, tariff_old_id uuid) ON COMMIT DROP;
INSERT INTO cb_offer_map VALUES
('c49fbc8c-0f69-40be-945c-3b8ef880fded','24e92d96-1872-57ed-934e-c9097b7f3381','9afbf9a0-4bb8-42bb-bc30-da6e983f5262'),
('7e5d066e-0cee-4074-8162-18ceb5ceab78','d515cd28-8bec-5c6e-bc8b-56181d95f58d','9afbf9a0-4bb8-42bb-bc30-da6e983f5262'),
('8ac848b2-cd2b-4678-8570-9956bc3bbe7b','2929ba16-51e1-5d4a-aaff-ae3754dde386','9afbf9a0-4bb8-42bb-bc30-da6e983f5262'),
('a6064ae2-ffb0-4cd2-95f9-920ec2c18829','35523d6e-06cc-5012-8070-14fb03c1e07a','9afbf9a0-4bb8-42bb-bc30-da6e983f5262'),
('169bfc1e-25a1-4405-b2e4-671f1d4fe19c','f00c3934-5305-556e-8a65-ed8464e5ace4','63939f2d-2980-466f-8cd9-c29c99efa800'),
('09a43ff3-9c38-4904-a089-91606a94385c','50b5041c-dd8b-50bb-9c3d-0a628f7863a1','63939f2d-2980-466f-8cd9-c29c99efa800'),
('b89b7c53-cc37-45e6-83f4-dc9e7861a24e','c4f7218c-cfd8-5380-911e-b25cfaad938e','63939f2d-2980-466f-8cd9-c29c99efa800'),
('0147b33f-9d8b-41d7-9495-39d79504e0ea','3ed3a575-e1bd-5c64-81c1-73fd52005a40','63939f2d-2980-466f-8cd9-c29c99efa800'),
('ec29a77c-0c4e-4bba-be9c-1f72e131204d','91b14409-0e35-5034-aac7-ad820dbe871d','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('24ae11fb-9d3f-47be-943d-0de6f220e141','8028fdcf-fdf0-50fb-ad78-27dc3ca35e1a','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('e4fe2030-5cba-46e6-8dfe-0713ffcdb3d6','5f79fccc-015f-5846-b423-aea2a2ba1ed1','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('50bf95a4-ef9c-49ea-999e-301b70188249','1ec06293-920c-550d-bd14-4e8cbcdb5754','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0');
CREATE TEMP TABLE cb_rule_map(old_id uuid, new_id uuid, tariff_old_id uuid) ON COMMIT DROP;
INSERT INTO cb_rule_map VALUES
('ce22859f-9b08-450d-a2ca-68cd592fb6f8','80c51908-2760-517c-81e2-bb756e8e6177','9afbf9a0-4bb8-42bb-bc30-da6e983f5262'),
('d4c8ad89-04b0-4d9a-bde7-029aec33ee2d','7101d58c-433c-5e2d-9720-ec9d9a856ab9','63939f2d-2980-466f-8cd9-c29c99efa800'),
('14d57191-2b83-43c5-8901-4fa41e5a325d','172fc999-a580-53ab-ac7f-c37aacd715bc','63939f2d-2980-466f-8cd9-c29c99efa800'),
('12d63704-0e60-4dfe-b522-f23196eda730','e3c936ba-4be0-5d1b-a190-94e0d19c8460','63939f2d-2980-466f-8cd9-c29c99efa800'),
('a91354a2-9e84-477d-ae34-f8642e7f8f44','a446c55b-ccf2-5c14-a6c9-fe4af49091c4','63939f2d-2980-466f-8cd9-c29c99efa800'),
('9eaa3ed9-6cbc-4386-895d-459d63ba24cd','46ed8a7f-9071-503f-9ea8-fbd19f294c1d','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('aee1d3d3-d68c-4c95-8327-580f1f85cbc5','7fd8dbb2-b3d1-5fed-9c79-44927ada0887','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('40819e0c-b4be-4cb2-aa0a-0b040168c888','0b1b21f0-c99d-5e6a-96e3-ab6950867b76','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('5b16064a-0577-4240-ad07-f6432cb554f9','acc21e80-484c-54d1-ac16-864e768fd3ca','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0'),
('557bc290-92f3-4c47-913f-5ed299577f17','199a4a4f-e305-5951-ab13-2946dc92a00d','ce13a0b5-124d-42c3-ae2a-c454c4c08ee0');

DO $migration$
DECLARE
  p constant uuid := '2b7bf6d4-ad8d-46ad-9399-7f96c307c596';
  flow_id constant uuid := 'b10e15c5-51c3-5df5-ba83-a42416da5902';
  generation constant text := 'cb21-october-2026-v1';
  existing_count integer;
  old_tariffs jsonb;
  old_offers jsonb;
  old_rules jsonb;
  old_addons jsonb;
BEGIN
  -- Lock only catalogue rows involved in this generation, not customer tables.
  PERFORM t.id FROM public.tariffs t JOIN cb_tariff_map m ON m.old_id=t.id FOR UPDATE OF t;
  PERFORM o.id FROM public.tariff_offers o JOIN cb_offer_map m ON m.old_id=o.id FOR UPDATE OF o;
  PERFORM r.id FROM public.access_rules r JOIN cb_rule_map m ON m.old_id=r.id FOR UPDATE OF r;
  SELECT count(*) INTO existing_count FROM public.tariffs t JOIN cb_tariff_map m ON m.new_id=t.id;
  IF existing_count NOT IN (0,3) THEN RAISE EXCEPTION 'partial_cb_catalogue_generation'; END IF;
  IF existing_count=3 THEN
    IF (SELECT count(*) FROM public.tariffs t JOIN cb_tariff_map m ON m.new_id=t.id
        WHERE t.product_id=p AND t.meta->>'sales_generation'=generation AND t.price_monthly=m.price)=3
       AND (SELECT count(*) FROM public.tariff_offers o JOIN cb_offer_map m ON m.new_id=o.id)=12
       AND (SELECT count(*) FROM public.access_rules r JOIN cb_rule_map m ON m.new_id=r.id)=10
       AND (SELECT count(*) FROM public.offer_addons WHERE parent_offer_id IN (SELECT new_id FROM cb_offer_map))=108
       AND EXISTS(SELECT 1 FROM public.flows f WHERE f.id=flow_id AND f.product_id=p
         AND f.start_date::date='2026-10-23' AND f.end_date::date='2026-12-10') THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'existing_cb_generation_drift';
  END IF;
  IF (SELECT count(*) FROM public.tariffs t JOIN cb_tariff_map m ON m.old_id=t.id
      WHERE t.product_id=p AND t.is_active AND t.is_public)=3
     AND (SELECT count(*) FROM public.tariffs WHERE product_id=p AND is_active AND is_public)=3
     AND (SELECT count(*) FROM public.tariff_offers o JOIN cb_offer_map om ON om.old_id=o.id
          JOIN cb_tariff_map m ON m.old_id=om.tariff_old_id
          WHERE o.tariff_id=m.old_id AND o.is_active AND o.amount=m.old_price
            AND o.auto_charge_offer_id IS NULL)=12
     AND (SELECT count(*) FROM public.tariff_offers WHERE tariff_id IN (SELECT old_id FROM cb_tariff_map) AND is_active)=12
     AND (SELECT count(*) FROM public.access_rules r JOIN cb_rule_map m ON m.old_id=r.id
          WHERE r.tariff_id=m.tariff_old_id AND r.product_id=p AND r.is_active)=10
     AND (SELECT count(*) FROM public.access_rules WHERE tariff_id IN (SELECT old_id FROM cb_tariff_map) AND is_active)=10
     AND (SELECT count(*) FROM public.access_rules r JOIN cb_rule_map m ON m.old_id=r.id WHERE r.duration_days=30)=7
     AND (SELECT count(*) FROM public.offer_addons WHERE parent_offer_id IN (SELECT old_id FROM cb_offer_map) AND is_active)=108
     AND NOT EXISTS(SELECT 1 FROM public.offer_addons WHERE parent_offer_id IN (SELECT old_id FROM cb_offer_map) AND is_active
       AND (is_required OR is_default_selected OR access_delivery_mode<>'manual'))
     AND (SELECT count(*) FROM public.access_rules r JOIN cb_rule_map m ON m.old_id=r.id
       WHERE r.duration_days IS NULL AND r.grant_target_type='training_content'
         AND r.target_ref='4365e913-36f1-432e-ab16-748c3ca6826a')=3
     AND NOT EXISTS(SELECT 1 FROM public.tariff_features WHERE tariff_id IN (SELECT old_id FROM cb_tariff_map))
     AND NOT EXISTS(SELECT 1 FROM public.tariff_offers o JOIN cb_offer_map m ON m.old_id=o.id
       WHERE jsonb_typeof(o.meta->'crm_routing') IS DISTINCT FROM 'object')
     AND (SELECT count(*) FROM public.flows WHERE product_id=p)=0 THEN
    NULL;
  ELSE RAISE EXCEPTION 'cb_catalogue_preflight_drift'; END IF;
  IF EXISTS(SELECT 1 FROM public.access_rules WHERE id='ce22859f-9b08-450d-a2ca-68cd592fb6f8'
      AND (jsonb_typeof(conditions->'allowed_module_ids') IS DISTINCT FROM 'array'
        OR conditions->>'access_mode' IS DISTINCT FROM 'partial'
        OR jsonb_array_length(conditions->'allowed_module_ids')<>24
        OR NOT (conditions->'allowed_module_ids' @> '["60aa7a27-5346-4ba0-9686-d297e14d49cf","9ce7a575-bbe4-45f1-8c4f-262b432127bf","83544104-b2c1-48c2-a0c9-015ceec012a1"]'::jsonb))) THEN
    RAISE EXCEPTION 'accountant_content_preflight_drift';
  END IF;
  SELECT jsonb_agg(to_jsonb(t)-'is_public'-'updated_at' ORDER BY t.id) INTO old_tariffs
    FROM public.tariffs t JOIN cb_tariff_map m ON m.old_id=t.id;
  SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) INTO old_offers
    FROM public.tariff_offers o JOIN cb_offer_map m ON m.old_id=o.id;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO old_rules
    FROM public.access_rules r JOIN cb_rule_map m ON m.old_id=r.id;

  SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO old_addons FROM public.offer_addons a
    WHERE a.parent_offer_id IN (SELECT old_id FROM cb_offer_map) AND a.is_active;

  INSERT INTO public.flows(id,product_id,code,name,start_date,end_date,is_active,is_default,meta)
  VALUES(flow_id,p,'cb21-october-2026','21 поток — октябрь 2026','2026-10-23','2026-12-10',true,true,
    jsonb_build_object('sales_generation',generation,'timezone','Europe/Minsk'));

  INSERT INTO public.tariffs
  SELECT (jsonb_populate_record(NULL::public.tariffs, to_jsonb(t) || jsonb_build_object(
    'id',m.new_id,'public_id',public.next_public_id('tariff'),
    'code','cb21_oct2026_'||m.slot,'is_active',true,'is_public',true,
    'price_monthly',m.price,'original_price',m.old_display_price,
    'visible_from',NULL,'visible_to',NULL,'created_at',now(),'updated_at',now(),
    'meta',coalesce(t.meta,'{}'::jsonb)||jsonb_build_object(
      'sales_generation',generation,'supersedes_tariff_id',t.id,'site_slot_key',m.slot,
      'course_access',jsonb_build_object('kind','course_end_calendar_months','flow_id',flow_id,
        'end_date','2026-12-10','months',m.months,'timezone','Europe/Minsk'),
      'card_config',coalesce(t.meta->'card_config','{}'::jsonb)||jsonb_build_object(
        'price_display',m.price,'old_price',m.old_display_price,'price_suffix','BYN','installment_from_byn',m.monthly))
  ))).* FROM public.tariffs t JOIN cb_tariff_map m ON m.old_id=t.id;

  INSERT INTO public.tariff_offers
  SELECT (jsonb_populate_record(NULL::public.tariff_offers, to_jsonb(o)||jsonb_build_object(
    'id',om.new_id,'tariff_id',m.new_id,'amount',m.price,'created_at',now(),'updated_at',now(),
    'visible_from',NULL,'visible_to',NULL,
    'meta',coalesce(o.meta,'{}'::jsonb)||jsonb_build_object('sales_generation',generation,'supersedes_offer_id',o.id)
  ))).* FROM public.tariff_offers o JOIN cb_offer_map om ON om.old_id=o.id
  JOIN cb_tariff_map m ON m.old_id=om.tariff_old_id;

  INSERT INTO public.access_rules(id,product_id,tariff_id,grant_target_type,target_ref,target_label,
    is_active,priority,duration_days,conditions,notes)
  SELECT rm.new_id,r.product_id,m.new_id,r.grant_target_type,r.target_ref,r.target_label,
    r.is_active,r.priority,r.duration_days,
    CASE WHEN r.id='ce22859f-9b08-450d-a2ca-68cd592fb6f8' THEN
      jsonb_set(r.conditions,'{allowed_module_ids}',coalesce((SELECT jsonb_agg(e.value ORDER BY e.ord)
        FROM jsonb_array_elements(r.conditions->'allowed_module_ids') WITH ORDINALITY e(value,ord)
        WHERE e.value#>>'{}' NOT IN ('60aa7a27-5346-4ba0-9686-d297e14d49cf',
          '9ce7a575-bbe4-45f1-8c4f-262b432127bf','83544104-b2c1-48c2-a0c9-015ceec012a1')),'[]'::jsonb))
    ELSE r.conditions END, r.notes
  FROM public.access_rules r JOIN cb_rule_map rm ON rm.old_id=r.id
  JOIN cb_tariff_map m ON m.old_id=rm.tariff_old_id;

  INSERT INTO public.offer_addons
  SELECT (jsonb_populate_record(NULL::public.offer_addons,to_jsonb(a)||jsonb_build_object(
    'id',md5('cb21-oct2026-addon:'||a.id::text)::uuid,'parent_offer_id',m.new_id,
    'created_at',now(),'updated_at',now(),
    'meta',coalesce(a.meta,'{}'::jsonb)||jsonb_build_object('sales_generation',generation,'supersedes_addon_id',a.id)
  ))).* FROM public.offer_addons a JOIN cb_offer_map m ON m.old_id=a.parent_offer_id WHERE a.is_active;

  -- Existing links retain active old tariff/offer IDs and original terms.
  UPDATE public.tariffs SET is_public=false,updated_at=now() WHERE id IN (SELECT old_id FROM cb_tariff_map);

  IF old_tariffs IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(t)-'is_public'-'updated_at' ORDER BY t.id)
       FROM public.tariffs t JOIN cb_tariff_map m ON m.old_id=t.id)
     OR old_offers IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id)
       FROM public.tariff_offers o JOIN cb_offer_map m ON m.old_id=o.id)
     OR old_rules IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)
       FROM public.access_rules r JOIN cb_rule_map m ON m.old_id=r.id)
     OR old_addons IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.offer_addons a
       WHERE a.parent_offer_id IN (SELECT old_id FROM cb_offer_map) AND a.is_active) THEN
    RAISE EXCEPTION 'historical_catalogue_was_changed';
  END IF;
END;
$migration$;

-- Product-wide presentation uses a full course price, not a monthly charge.
UPDATE public.products_v2 SET landing_config=jsonb_set(coalesce(landing_config,'{}'::jsonb),'{price_suffix}','"BYN"'::jsonb),updated_at=now()
WHERE id='2b7bf6d4-ad8d-46ad-9399-7f96c307c596'
  AND landing_config->>'price_suffix' IS DISTINCT FROM 'BYN';

DO $page$
DECLARE
  page_id constant uuid := 'a924f3c6-367e-4585-b467-b1d14861c9a7';
  source_html text;
  target_title constant text := 'Ценный бухгалтер — стань профессионалом, который понимает логику учета, умеет работать с НПА и самостоятельно принимает решения | Катерина Горбова';
BEGIN
  SELECT blocks#>>'{0,content,code}' INTO source_html FROM public.site_pages
  WHERE id=page_id AND slug='cb20predzapis' AND status='published'
    AND jsonb_array_length(blocks)=1 AND blocks#>>'{0,id}'='3f366661-bed4-4134-8938-ff2f92da79c6' FOR UPDATE;
  IF source_html IS NULL THEN RAISE EXCEPTION 'cb_preregistration_page_drift'; END IF;
  IF (length(source_html)-length(replace(source_html,'01 августа 2026г.','')))/length('01 августа 2026г.')=1 THEN
    source_html := replace(source_html,'01 августа 2026г.','октябрь 2026');
  ELSIF position('01 августа 2026' IN source_html)>0 OR position('октябрь 2026' IN source_html)=0 THEN
    RAISE EXCEPTION 'cb_preregistration_date_drift';
  END IF;
  IF (length(source_html)-length(replace(source_html,'<s>1200 BYN</s>','')))/length('<s>1200 BYN</s>')=1 THEN
    source_html := replace(source_html,'<s>1200 BYN</s>','');
  ELSIF position('1200 BYN' IN source_html)>0 THEN
    RAISE EXCEPTION 'cb_preregistration_price_drift';
  END IF;
  UPDATE public.site_pages SET blocks=jsonb_set(blocks,'{0,content,code}',to_jsonb(source_html)),
    seo_settings=coalesce(seo_settings,'{}'::jsonb)||jsonb_build_object('title',target_title),updated_at=now()
  WHERE id=page_id AND (blocks#>>'{0,content,code}' IS DISTINCT FROM source_html OR seo_settings->>'title' IS DISTINCT FROM target_title);
END;
$page$;
COMMIT;
