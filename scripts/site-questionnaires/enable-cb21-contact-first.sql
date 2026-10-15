-- Managed CMS enablement after the matching frontend and site-form-submit are ready.
-- One published page, one existing form; other blocks/settings and all historical submissions stay intact.
-- Run through Lovable Cloud only. Transaction is idempotent and refuses unexpected field layouts.
BEGIN;
DO $config$
DECLARE
 v_page uuid := 'c8c5c19a-a10d-4f6b-8049-449f37230ed0';
 v_block uuid := '7f144dcc-1a71-4225-8399-efd4d91502cd';
 v_blocks jsonb; v_before jsonb; v_after jsonb; v_fields jsonb; v_content jsonb;
 v_index integer; v_count integer; v_rows integer; v_manual integer;
BEGIN
 SELECT blocks INTO STRICT v_blocks FROM site_pages WHERE id=v_page AND status='published' FOR UPDATE;
 SELECT count(*) INTO v_count FROM jsonb_array_elements(v_blocks) b WHERE b->>'id'=v_block::text AND b->>'type'='form';
 IF v_count<>1 THEN RAISE EXCEPTION 'cb21_contact_form_count_mismatch'; END IF;
 SELECT b,(ord-1)::int INTO v_before,v_index FROM jsonb_array_elements(v_blocks) WITH ORDINALITY x(b,ord)
   WHERE b->>'id'=v_block::text AND b->>'type'='form';
 v_content:=v_before->'content';v_fields:=v_content->'fields';
 IF v_content->'auth_mode' IS DISTINCT FROM 'true'::jsonb OR v_content->'questionnaire_first' IS DISTINCT FROM 'true'::jsonb
   OR jsonb_typeof(v_fields) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'cb21_contact_mode_mismatch'; END IF;
 SELECT count(*) INTO v_manual FROM jsonb_array_elements(v_fields) f WHERE f->>'mapping' IN ('telegram','telegram_username');
 IF jsonb_array_length(v_fields)=14 AND v_manual=0 AND v_content->'contact_first'='true'::jsonb THEN
   RAISE NOTICE 'cb21_contact_config_replayed rows=0';RETURN; END IF;
 IF jsonb_array_length(v_fields)<>15 OR v_manual<>1 OR v_fields->2->>'mapping' IS DISTINCT FROM 'telegram_username'
   OR v_fields->2->>'type' IS DISTINCT FROM 'text' OR v_content->'contact_first'='true'::jsonb
   OR v_fields->0->>'mapping' IS DISTINCT FROM 'full_name' OR v_fields->1->>'mapping' IS DISTINCT FROM 'phone'
   OR v_fields->3->>'mapping' IS DISTINCT FROM 'instagram_url' OR v_fields->4->>'mapping' IS DISTINCT FROM 'email'
   OR (SELECT count(*) FROM jsonb_array_elements(v_fields) f WHERE f->>'type'='textarea')<>10 THEN
   RAISE EXCEPTION 'cb21_contact_field_layout_mismatch'; END IF;
 v_after:=jsonb_set(jsonb_set(v_before,'{content,fields}',v_fields-2),'{content,contact_first}','true');
 UPDATE site_pages SET blocks=jsonb_set(v_blocks,ARRAY[v_index::text],v_after) WHERE id=v_page AND status='published';
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows<>1 OR (SELECT blocks->v_index FROM site_pages WHERE id=v_page) IS DISTINCT FROM v_after
   OR (v_after#>'{content,fields}') IS DISTINCT FROM (v_fields-2)
   OR (v_after-'content') IS DISTINCT FROM (v_before-'content')
   OR ((v_after->'content')-'fields'-'contact_first') IS DISTINCT FROM (v_content-'fields'-'contact_first') THEN
   RAISE EXCEPTION 'cb21_contact_config_verification_failed'; END IF;
 RAISE NOTICE 'cb21_contact_config_updated rows=1 fields=14 questions=10 before_md5=% after_md5=%',md5(v_before::text),md5(v_after::text);
END;
$config$;
COMMIT;
