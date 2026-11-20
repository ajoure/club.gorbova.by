-- Existing RR bank flow only; canonical six card plans and all existing purchases remain unchanged.
BEGIN;
DO $bank$
DECLARE p record; b jsonb; bank_blocks jsonb; code text; stripped text; n int; bank_count int; html_count int;
 product constant uuid := 'e71c0dbb-baf2-4b6c-a950-bf0f728708af';
 insertion constant text := '<a class="button" style="background:transparent!important;color:var(--accent)!important;border-color:var(--accent)!important" href="#zg27-bank" data-lovable-action="open-zg27-bank">Банковская рассрочка<span class="arrow" aria-hidden="true"></span></a><p class="caption">Заявка на банковскую рассрочку</p>';
 bank_meta constant jsonb := '{"slot_role":"installment_bank","site_button_variant":"installment","zg27":{"policy_version":"zg27-v1","bank":true},"bank_installment":{"rr_runtime":{"enabled":true,"provider":"rr"}}}';
 existing_six jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('zg27-bank-config-v1',0));
 IF (SELECT count(*) FROM public.tariffs WHERE product_id=product AND id IN('d0fce8c6-473a-49a1-978f-1069d0f012bc','08059eb1-748a-4ad6-8283-e6f1efa2f40f') AND is_active IS TRUE AND meta#>>'{course_access,end_exclusive}'='2027-04-30T21:00:00.000Z')<>2 THEN RAISE EXCEPTION 'zg27_bank_tariff_policy_mismatch'; END IF;
 SELECT jsonb_agg(to_jsonb(o) ORDER BY id) INTO existing_six FROM public.tariff_offers o WHERE tariff_id IN('d0fce8c6-473a-49a1-978f-1069d0f012bc','08059eb1-748a-4ad6-8283-e6f1efa2f40f') AND offer_type<>'bank_installment';
 IF coalesce(jsonb_array_length(existing_six),0)<>6 THEN RAISE EXCEPTION 'zg27_bank_six_baseline_mismatch'; END IF;
 FOR p IN SELECT * FROM (VALUES
 ('96af3364-c10d-4215-a305-9ec8fb683101'::uuid,'d0fce8c6-473a-49a1-978f-1069d0f012bc'::uuid,1290::numeric),
 ('96af3364-c10d-4215-a305-9ec8fb683102'::uuid,'08059eb1-748a-4ad6-8283-e6f1efa2f40f'::uuid,890::numeric)
 )v(id,tariff_id,amount) LOOP
  IF EXISTS(SELECT 1 FROM public.tariff_offers WHERE tariff_id=p.tariff_id AND (offer_type='bank_installment' OR meta->>'slot_role'='installment_bank') AND id<>p.id) THEN RAISE EXCEPTION 'zg27_bank_offer_conflict'; END IF;
  INSERT INTO public.tariff_offers(id,tariff_id,offer_type,payment_method,amount,is_active,button_label,sort_order,meta)
  VALUES(p.id,p.tariff_id,'bank_installment','full_payment',p.amount,true,'Банковская рассрочка',20,bank_meta) ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM public.tariff_offers WHERE id=p.id AND tariff_id=p.tariff_id AND offer_type='bank_installment' AND payment_method='full_payment' AND amount=p.amount AND is_active IS TRUE AND meta=bank_meta) THEN RAISE EXCEPTION 'zg27_bank_offer_drift'; END IF;
 END LOOP;
 FOR p IN SELECT * FROM (VALUES
 ('164a1f0b-eb1e-4917-b2aa-73dbdbc21e6d'::uuid,'zg27povtor','f51c7395495d0dba3d90f75ba2612de0'),
 ('d0da405e-0fab-4f52-bbc8-ed30b15317e9'::uuid,'zg27pervoe','a7d3a66d3d80180bf7f8b01306597387')
 )v(id,slug,baseline_md5) LOOP
  SELECT s.blocks INTO bank_blocks FROM public.site_pages s WHERE s.id=p.id AND s.slug=p.slug AND s.status='published' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'zg27_bank_page_missing'; END IF;
  n:=0; html_count:=0;
  FOR b IN SELECT value FROM jsonb_array_elements(bank_blocks) LOOP
   IF b->>'type'<>'html' THEN n:=n+1; CONTINUE; END IF;
   html_count:=html_count+1; code:=b#>>'{content,code}';
   IF code IS NULL THEN RAISE EXCEPTION 'zg27_bank_html_missing'; END IF;
   SELECT count(*) INTO bank_count FROM regexp_matches(code,'data-lovable-action="open-zg27-bank"','g');
   stripped:=replace(code,insertion,'');
   IF md5(stripped)<>p.baseline_md5 OR bank_count NOT IN(0,2) OR (bank_count=2 AND stripped=code) THEN RAISE EXCEPTION 'zg27_bank_html_drift'; END IF;
   IF (SELECT count(*) FROM regexp_matches(stripped,'data-lovable-action="open-zg27-payment"','g'))<>2 THEN RAISE EXCEPTION 'zg27_bank_cta_baseline'; END IF;
   IF bank_count=0 THEN
    code:=regexp_replace(code,'(<a class="button" href="#zg27-payment" data-lovable-action="open-zg27-payment">.*?</a>[[:space:]]*(<p class="caption">[^<]*</p>|<div class="row">[[:space:]]*<p class="caption">[^<]*</p>[[:space:]]*</div>))','\1'||insertion,'g');
    IF (SELECT count(*) FROM regexp_matches(code,'data-lovable-action="open-zg27-bank"','g'))<>2 THEN RAISE EXCEPTION 'zg27_bank_cta_count'; END IF;
    b:=jsonb_set(b,'{content,code}',to_jsonb(code));
    bank_blocks:=jsonb_set(bank_blocks,ARRAY[n::text],b);
   END IF;
   n:=n+1;
  END LOOP;
  IF html_count<>1 THEN RAISE EXCEPTION 'zg27_bank_html_count'; END IF;
  UPDATE public.site_pages SET blocks=bank_blocks WHERE id=p.id AND blocks IS DISTINCT FROM bank_blocks;
 END LOOP;
 IF existing_six IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.tariff_offers o WHERE tariff_id IN('d0fce8c6-473a-49a1-978f-1069d0f012bc','08059eb1-748a-4ad6-8283-e6f1efa2f40f') AND offer_type<>'bank_installment') THEN RAISE EXCEPTION 'zg27_bank_six_mutated'; END IF;
END $bank$;
COMMIT;
