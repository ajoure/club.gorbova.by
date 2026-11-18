-- ZG27 approved configuration only. No orders, receipts, existing grants or lessons are rewritten.
-- Baseline HTML hashes freeze the separately read public landing source; changed source stops release.
BEGIN;
DO $zg27$
DECLARE
 product constant uuid := 'e71c0dbb-baf2-4b6c-a950-bf0f728708af';
 module constant uuid := '2ee0cb2a-ab85-47b1-85e0-5c3f30242046';
 first_tariff constant uuid := 'd0fce8c6-473a-49a1-978f-1069d0f012bc';
 repeat_tariff constant uuid := '08059eb1-748a-4ad6-8283-e6f1efa2f40f';
 policy constant jsonb := '{"kind":"fixed_exclusive_end","timezone":"Europe/Minsk","end_exclusive":"2027-04-30T21:00:00.000Z"}';
 p record; o record; current_page record; block jsonb; newblocks jsonb; code text;
 n integer; total_cta integer := 0; page_cta integer; installed boolean; footer_count integer;
BEGIN
 PERFORM 1 FROM public.products_v2 WHERE id=product AND is_active IS TRUE AND status::text='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'zg27_product_baseline_mismatch'; END IF;
 PERFORM 1 FROM public.training_modules WHERE id=module AND product_id=product AND parent_module_id IS NULL AND slug='zakroj-god-2027' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'zg27_module_baseline_mismatch'; END IF;
 SELECT count(*) INTO n FROM public.tariffs WHERE product_id=product;
 IF EXISTS(SELECT 1 FROM public.tariffs WHERE id IN(first_tariff,repeat_tariff) AND meta->'course_access' IS NOT NULL AND meta->'course_access'<>'{"kind":"fixed_exclusive_end","timezone":"Europe/Minsk","end_exclusive":"2027-04-30T21:00:00.000Z"}'::jsonb) THEN RAISE EXCEPTION 'zg27_existing_access_policy_mismatch'; END IF;
 IF n<>2 OR (SELECT count(*) FROM public.tariffs WHERE product_id=product AND id IN(first_tariff,repeat_tariff) AND is_active IS TRUE)<>2 THEN RAISE EXCEPTION 'zg27_tariffs_baseline_mismatch'; END IF;
 SELECT count(*) INTO n FROM public.tariff_offers WHERE tariff_id IN(first_tariff,repeat_tariff);
 IF n<>6 THEN RAISE EXCEPTION 'zg27_offers_count_mismatch'; END IF;
 -- Lock and validate every target before writing any configuration.
 FOR o IN SELECT * FROM (VALUES
 ('2fd031d9-f94e-4dac-991a-4e11bc7d0bbb'::uuid,first_tariff,1,1290::numeric,'first'),
 ('1e3b02c3-3a67-4505-b399-5de565cff20c'::uuid,first_tariff,2,1290::numeric,'first'),
 ('834a032c-09ae-47a8-b75b-8a828dad3547'::uuid,first_tariff,3,1290::numeric,'first'),
 ('3a85b4bc-d479-4aa5-bf34-d66625610315'::uuid,repeat_tariff,1,890::numeric,'repeat'),
 ('8f03fa98-67a0-45a8-aeed-bebef555bf07'::uuid,repeat_tariff,2,890::numeric,'repeat'),
 ('f94cb0b9-b98d-4162-b0b6-ca17e3d5841a'::uuid,repeat_tariff,3,890::numeric,'repeat')
 ) v(id,tariff,cycles,total,tier) LOOP
 PERFORM 1 FROM public.tariff_offers WHERE id=o.id AND tariff_id=o.tariff AND is_active IS TRUE AND offer_type::text='pay_now'
 AND payment_method::text=CASE WHEN o.cycles=1 THEN 'full_payment' ELSE 'internal_installment' END
 AND (amount=o.total OR (o.tier='repeat' AND o.cycles>1 AND amount=900))
 AND (meta->'zg27' IS NULL OR meta->'zg27'=jsonb_build_object('policy_version','zg27-v1','tier',o.tier,'cycles',o.cycles)) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'zg27_offer_baseline_mismatch: %',o.id; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.access_rules WHERE product_id=product AND (
 grant_target_type='training_content' AND target_ref=module::text AND tariff_id IN(first_tariff,repeat_tariff)
 AND conditions='{"access_mode":"full","allowed_module_ids":[],"allowed_lesson_ids":[]}'::jsonb AND is_active IS TRUE) IS NOT TRUE) THEN RAISE EXCEPTION 'zg27_access_rules_baseline_mismatch'; END IF;
 FOR p IN SELECT * FROM (VALUES
('164a1f0b-eb1e-4917-b2aa-73dbdbc21e6d','zg27povtor','53903fbf-f263-439e-8492-6de7aafd2d7b','60f7a1be85d96b1a4bee172bff1df345','repeat'),
('d0da405e-0fab-4f52-bbc8-ed30b15317e9','zg27pervoe','b017345e-14fd-498b-b8e4-4bd12bae2d9f','75edb63c324127f1df6221d9dac15813','first')
 ) v(id,slug,html_id,html_md5,tier) LOOP
 SELECT * INTO current_page FROM public.site_pages WHERE id=p.id::uuid AND slug=p.slug AND status::text='published' FOR UPDATE;
 IF NOT FOUND OR (current_page.product_id IS NOT NULL AND current_page.product_id<>product) THEN RAISE EXCEPTION 'zg27_page_baseline_mismatch'; END IF;
 IF jsonb_typeof(current_page.blocks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'zg27_blocks_invalid'; END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(current_page.blocks) b WHERE b->>'type'='html' AND b->>'id'=p.html_id;
 SELECT count(*) INTO footer_count FROM jsonb_array_elements(current_page.blocks) b WHERE b->>'type'='footer';
 IF n<>1 OR footer_count<>1 OR (SELECT count(*) FROM jsonb_array_elements(current_page.blocks) b WHERE b->>'type'='html')<>1 THEN RAISE EXCEPTION 'zg27_page_structure_mismatch'; END IF;
 SELECT count(*) INTO n FROM jsonb_array_elements(current_page.blocks) b WHERE b->>'type'='zg27_checkout';
 installed:=n=1;
 IF n>1 THEN RAISE EXCEPTION 'zg27_duplicate_checkout'; END IF;
 SELECT b->'content'->>'code' INTO code FROM jsonb_array_elements(current_page.blocks) b WHERE b->>'id'=p.html_id;
 IF NOT installed AND md5(code) IS DISTINCT FROM p.html_md5 THEN RAISE EXCEPTION 'zg27_html_baseline_mismatch'; END IF;
 SELECT count(*) INTO page_cta FROM regexp_matches(code,'href="mailto:[^"]*"','g');
 IF (NOT installed AND page_cta<>2) OR (installed AND (page_cta<>0 OR (SELECT count(*) FROM regexp_matches(code,'data-lovable-action="open-zg27-payment"','g'))<>2)) THEN RAISE EXCEPTION 'zg27_cta_count_mismatch'; END IF;
 total_cta:=total_cta+CASE WHEN installed THEN 2 ELSE page_cta END;
 newblocks:='[]';
 FOR block IN SELECT value FROM jsonb_array_elements(current_page.blocks) LOOP
 IF block->>'type'='zg27_checkout' THEN
 IF block->'content' IS DISTINCT FROM jsonb_build_object('product_id',product,'tier',p.tier,'page_slug',p.slug,'section_id','zg27-payment','policy_version','zg27-v1') THEN RAISE EXCEPTION 'zg27_checkout_config_mismatch'; END IF;
 CONTINUE;
 END IF;
 IF block->>'id'=p.html_id THEN
 code:=regexp_replace(code,'href="mailto:[^"]*"','href="#zg27-payment" data-lovable-action="open-zg27-payment"','g');
 block:=jsonb_set(block,'{content,code}',to_jsonb(code));
 END IF;
 IF block->>'type'='footer' THEN
 newblocks:=newblocks||jsonb_build_array(jsonb_build_object('id',CASE WHEN p.tier='first' THEN '970a6a71-2727-4c85-a0d9-5c031a520001' ELSE '970a6a71-2727-4c85-a0d9-5c031a520002' END,'type','zg27_checkout','version',1,'content',jsonb_build_object('product_id',product,'tier',p.tier,'page_slug',p.slug,'section_id','zg27-payment','policy_version','zg27-v1'),'settings','{}'::jsonb,'metadata','{}'::jsonb));
 END IF;
 newblocks:=newblocks||jsonb_build_array(block);
 END LOOP;
 -- Release only our canonical FK first; the second page retains explicit block association.
 IF p.tier='repeat' THEN UPDATE public.site_pages SET product_id=NULL,blocks=newblocks WHERE id=p.id::uuid;
 ELSE
 UPDATE public.site_pages SET product_id=NULL WHERE product_id=product AND id='164a1f0b-eb1e-4917-b2aa-73dbdbc21e6d';
 IF EXISTS(SELECT 1 FROM public.site_pages WHERE product_id=product AND id<>p.id::uuid) THEN RAISE EXCEPTION 'zg27_canonical_page_conflict'; END IF;
 UPDATE public.site_pages SET product_id=product,blocks=newblocks WHERE id=p.id::uuid;
 END IF;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'zg27_page_rowcount'; END IF;
 END LOOP;
 IF total_cta<>4 THEN RAISE EXCEPTION 'zg27_total_cta_count_mismatch'; END IF;
 UPDATE public.tariffs SET meta=coalesce(meta,'{}')||jsonb_build_object('course_access',policy) WHERE id IN(first_tariff,repeat_tariff) AND product_id=product;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>2 THEN RAISE EXCEPTION 'zg27_tariff_rowcount'; END IF;
 FOR o IN SELECT * FROM (VALUES
 ('2fd031d9-f94e-4dac-991a-4e11bc7d0bbb'::uuid,first_tariff,1,1290::numeric,'first'),
 ('1e3b02c3-3a67-4505-b399-5de565cff20c'::uuid,first_tariff,2,1290::numeric,'first'),
 ('834a032c-09ae-47a8-b75b-8a828dad3547'::uuid,first_tariff,3,1290::numeric,'first'),
 ('3a85b4bc-d479-4aa5-bf34-d66625610315'::uuid,repeat_tariff,1,890::numeric,'repeat'),
 ('8f03fa98-67a0-45a8-aeed-bebef555bf07'::uuid,repeat_tariff,2,890::numeric,'repeat'),
 ('f94cb0b9-b98d-4162-b0b6-ca17e3d5841a'::uuid,repeat_tariff,3,890::numeric,'repeat')
 ) v(id,tariff,cycles,total,tier) LOOP
 UPDATE public.tariff_offers SET amount=o.total,installment_count=o.cycles,installment_interval_days=30,first_payment_delay_days=0,
 meta=(coalesce(meta,'{}')||jsonb_build_object('zg27',jsonb_build_object('policy_version','zg27-v1','tier',o.tier,'cycles',o.cycles)))||CASE WHEN o.cycles>1 THEN jsonb_build_object('installment',coalesce(meta->'installment','{}')||jsonb_build_object('max_months',o.cycles,'interval_days',30,'first_payment_delay_days',0,'rounding_mode','last_payment_remainder')) ELSE '{}'::jsonb END
 WHERE id=o.id AND tariff_id=o.tariff;
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'zg27_offer_rowcount'; END IF;
 END LOOP;
 INSERT INTO public.access_rules(id,product_id,tariff_id,grant_target_type,target_ref,conditions,is_active)
 VALUES ('713ad78b-aa21-4c7b-a9cb-031025270001',product,first_tariff,'training_content',module::text,'{"access_mode":"full","allowed_module_ids":[],"allowed_lesson_ids":[]}',true),
 ('713ad78b-aa21-4c7b-a9cb-031025270002',product,repeat_tariff,'training_content',module::text,'{"access_mode":"full","allowed_module_ids":[],"allowed_lesson_ids":[]}',true)
 ON CONFLICT DO NOTHING;
 SELECT count(*) INTO n FROM public.access_rules WHERE product_id=product AND tariff_id IN(first_tariff,repeat_tariff) AND grant_target_type='training_content' AND target_ref=module::text AND is_active IS TRUE;
 IF n<>2 THEN RAISE EXCEPTION 'zg27_access_rules_rowcount'; END IF;
END $zg27$;
COMMIT;
