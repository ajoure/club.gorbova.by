-- Lovable Cloud only. Default is a dry-run; replace ONLY final ROLLBACK with
-- COMMIT after Codex approves the exact merged SHA and dry-run rows=2.
-- Existing links, field schema, product binding and historical forms are untouched.
BEGIN;
DO $brand$
DECLARE
 v_form_id uuid := 'c8c5c19a-a10d-4f6b-8049-449f37230ed0';
 v_thanks_id uuid := 'f2aceb14-0937-4c8d-814b-f62a2e03c6d6';
 v_form site_pages%ROWTYPE; v_thanks site_pages%ROWTYPE;
 v_blocks jsonb; v_header_index int; v_form_index int;
 v_header jsonb; v_form_block jsonb; v_rows int; v_total int := 0;
 v_theme jsonb := '{"preset":"gorbova","primary_color":"#343434","font_family":"Arial, sans-serif"}';
 v_header_code text := $html$<style>
body{margin:0;background:#fff;color:#343434;font-family:Arial,sans-serif}
.cb-prereg{max-width:720px;margin:0 auto;padding:48px 20px 0;line-height:1.6}
.cb-prereg__brand{font-size:12px;letter-spacing:.16em;margin:0 0 32px;text-transform:uppercase}
.cb-prereg h1{font-size:clamp(30px,5vw,44px);line-height:1.1;letter-spacing:-.035em;margin:0 0 24px;color:#1b1b1b}
.cb-prereg h1 span{color:#e422c2}
.cb-prereg p{font-size:17px;margin:0 0 20px}
.cb-prereg__bonus{border-left:3px solid #e422c2;padding-left:18px;color:#686868}
.cb-prereg__next{padding-top:20px;border-top:1px solid #eee}
@media(max-width:640px){.cb-prereg{padding:32px 20px 0}.cb-prereg__brand{margin-bottom:24px}.cb-prereg p{font-size:16px}}
</style>
<section class="cb-prereg">
<p class="cb-prereg__brand">Katerina Gorbova</p>
<h1>Предзапись на новый поток курса <span>«Ценный бухгалтер»</span></h1>
<p>Если вы бухгалтер или главный бухгалтер и рассматриваете <strong>системное обучение у Катерины Горбовой</strong>, заполните анкету предзаписи.</p>
<p class="cb-prereg__bonus">После заполнения анкеты вы получите доступ к бесплатному Telegram-каналу с полезными материалами для бухгалтеров.</p>
<p class="cb-prereg__next">Если вы действительно рассматриваете обучение на «Ценном бухгалтере», заполняйте анкету ниже.</p>
</section>$html$;
BEGIN
 SELECT * INTO STRICT v_form FROM site_pages WHERE id=v_form_id AND status='published' FOR UPDATE;
 SELECT * INTO STRICT v_thanks FROM site_pages WHERE id=v_thanks_id AND status='published' FOR UPDATE;
 IF jsonb_array_length(v_form.blocks)<>2 OR jsonb_array_length(v_thanks.blocks)<>1 THEN
   RAISE EXCEPTION 'cb21_brand_block_count_mismatch'; END IF;
 SELECT b,(ord-1)::int INTO STRICT v_header,v_header_index FROM jsonb_array_elements(v_form.blocks) WITH ORDINALITY x(b,ord)
   WHERE b->>'id'='a0898c9b-5cd1-455b-96a1-c8c1ce2d9c12' AND b->>'type'='html';
 SELECT b,(ord-1)::int INTO STRICT v_form_block,v_form_index FROM jsonb_array_elements(v_form.blocks) WITH ORDINALITY x(b,ord)
   WHERE b->>'id'='7f144dcc-1a71-4225-8399-efd4d91502cd' AND b->>'type'='form';
 IF v_form.theme_settings=v_theme AND v_thanks.theme_settings=v_theme
   AND v_header#>>'{content,code}'=v_header_code
   AND v_form_block#>>'{content,redirectUrl}'='/predzapiscb21anketathanks' THEN
   RAISE NOTICE 'cb21_brand_replayed rows=0'; RETURN; END IF;
 IF md5(v_form.blocks::text)<>'33f7a1fd6f19c9f77cf807dc7c3f8924'
   OR md5(v_thanks.blocks::text)<>'fa96f5c77fae37664f7342b4bcc597ec'
   OR v_form.theme_settings IS DISTINCT FROM '{}'::jsonb OR v_thanks.theme_settings IS DISTINCT FROM '{}'::jsonb
   OR md5(v_header#>>'{content,code}')<>'882ade05b584e8554c06983253fe6167'
   OR v_form.updated_at IS DISTINCT FROM '2026-10-15 14:09:03.779614+00'::timestamptz
   OR v_thanks.updated_at IS DISTINCT FROM '2026-10-10 09:45:29.426114+00'::timestamptz THEN
   RAISE EXCEPTION 'cb21_brand_preflight_drift'; END IF;
 IF v_form_block#>>'{content,redirectUrl}' IS DISTINCT FROM 'https://gorbova.by/predzapiscb21anketathanks'
   OR jsonb_array_length(v_form_block#>'{content,fields}')<>14
   OR v_form_block#>'{content,contact_first}' IS DISTINCT FROM 'true'::jsonb
   OR v_form_block#>'{content,questionnaire_first}' IS DISTINCT FROM 'true'::jsonb THEN
   RAISE EXCEPTION 'cb21_brand_form_config_mismatch'; END IF;
 -- Return non-personal originals to the executor for a recoverable CMS backup.
 RAISE NOTICE 'cb21_brand_backup=%', jsonb_build_array(to_jsonb(v_form),to_jsonb(v_thanks));
 v_blocks:=jsonb_set(v_form.blocks,ARRAY[v_header_index::text,'content','code'],to_jsonb(v_header_code));
 v_blocks:=jsonb_set(v_blocks,ARRAY[v_form_index::text,'content','redirectUrl'],'"/predzapiscb21anketathanks"');
 UPDATE site_pages SET blocks=v_blocks,theme_settings=v_theme WHERE id=v_form_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT; v_total:=v_total+v_rows;
 UPDATE site_pages SET theme_settings=v_theme WHERE id=v_thanks_id;
 GET DIAGNOSTICS v_rows=ROW_COUNT; v_total:=v_total+v_rows;
 IF v_total<>2 OR
   (SELECT to_jsonb(p)-'blocks'-'theme_settings'-'updated_at' FROM site_pages p WHERE id=v_form_id)
     IS DISTINCT FROM (to_jsonb(v_form)-'blocks'-'theme_settings'-'updated_at') OR
   (SELECT to_jsonb(p)-'theme_settings'-'updated_at' FROM site_pages p WHERE id=v_thanks_id)
     IS DISTINCT FROM (to_jsonb(v_thanks)-'theme_settings'-'updated_at') OR
   (SELECT blocks FROM site_pages WHERE id=v_form_id) IS DISTINCT FROM v_blocks OR
   (SELECT count(*) FROM site_pages WHERE id IN(v_form_id,v_thanks_id) AND theme_settings=v_theme)<>2 THEN
   RAISE EXCEPTION 'cb21_brand_readback_failed'; END IF;
 RAISE NOTICE 'cb21_brand_updated rows=% form_blocks_md5=% thanks_blocks_md5=%',v_total,md5(v_blocks::text),md5(v_thanks.blocks::text);
END;
$brand$;
ROLLBACK;
