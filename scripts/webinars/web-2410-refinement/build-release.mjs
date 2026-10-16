import {readFile,writeFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
const landing=await read('landing.html'),thanks=await read('thanks.html');
const prior=await read('../web-2410/release-managed-apply.sql');
const match=prior.match(/v_blocks jsonb:='([\s\S]*?)'::jsonb;/);
if(!match)throw Error('Reviewed original CMS artifact missing');
const blocks=JSON.parse(match[1].replaceAll("''","'"));
blocks[1].content.tariff_id='745e77aa-46b5-4838-b5a2-7b7b1c8bad76';
const db=new PGlite();let shape;
try {const result=await db.query("SELECT md5($1::jsonb::text) baseline,md5(jsonb_set($1::jsonb,'{0,content,code}','\"\"')::text) shape",[JSON.stringify(blocks)]);if(result.rows[0].baseline!=='4b2f80873883ad26ffa05bdb3b7c9c29')throw Error('Reviewed original CMS drift');shape=result.rows[0].shape;}finally{await db.close();}

const sql=`-- web2410-v2: exact two-page CMS patch. No template, contact, auth or access writes.
DO $release$
DECLARE
 v_l site_pages%ROWTYPE;v_t site_pages%ROWTYPE;v_tariff tariffs%ROWTYPE;
 v_l_new jsonb;v_t_new jsonb;v_t_old jsonb;v_bonus jsonb;v_templates jsonb;v_rows int;
 v_html_index text;v_bonus_index text;v_form jsonb;v_replayed boolean;
 v_html text:=${quote(landing)};v_design text:=${quote(thanks)};
 v_dry_run boolean:=false;
BEGIN
 SELECT * INTO STRICT v_l FROM site_pages WHERE id='859c9cf0-657f-4585-a645-e93e66d940ca' FOR UPDATE;
 SELECT * INTO STRICT v_t FROM site_pages WHERE id='20997a6e-0320-47f2-bf8b-b56b0d9f1e53' FOR UPDATE;
 IF v_l.status IS DISTINCT FROM 'published' OR v_t.status IS DISTINCT FROM 'published'
 OR v_l.slug IS DISTINCT FROM 'web-2410' OR v_t.slug IS DISTINCT FROM 'thx-web-2410'
 OR v_l.product_id IS DISTINCT FROM 'c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740'::uuid OR v_t.product_id IS NOT NULL
 OR jsonb_array_length(v_l.blocks) IS DISTINCT FROM 2 OR jsonb_array_length(v_t.blocks) IS DISTINCT FROM 1
 THEN RAISE EXCEPTION 'webinar_refinement_routing_drift'; END IF;
 IF md5(v_l.theme_settings::text) IS DISTINCT FROM '99914b932bd37a50b983c5e7c90ae93b'
 OR md5(v_l.seo_settings::text) IS DISTINCT FROM 'd9aca857be20f0d56d15c3353496192b'
 OR md5(v_t.theme_settings::text) IS DISTINCT FROM 'fcc4e8260805641e6db9b4765cd302cd'
 OR md5(v_t.seo_settings::text) IS DISTINCT FROM '99914b932bd37a50b983c5e7c90ae93b'
 THEN RAISE EXCEPTION 'webinar_refinement_settings_drift'; END IF;
 IF (SELECT md5(blocks::text) FROM site_pages WHERE id='c8c5c19a-a10d-4f6b-8049-449f37230ed0') IS DISTINCT FROM '76c074055c73f08392dd1c8fd3f92ce2'
 OR (SELECT md5(blocks::text) FROM site_pages WHERE id='f2aceb14-0937-4c8d-814b-f62a2e03c6d6') IS DISTINCT FROM 'fa96f5c77fae37664f7342b4bcc597ec'
 OR (SELECT md5(theme_settings::text) FROM site_pages WHERE id='c8c5c19a-a10d-4f6b-8049-449f37230ed0') IS DISTINCT FROM 'fcc4e8260805641e6db9b4765cd302cd'
 OR (SELECT md5(theme_settings::text) FROM site_pages WHERE id='f2aceb14-0937-4c8d-814b-f62a2e03c6d6') IS DISTINCT FROM 'fcc4e8260805641e6db9b4765cd302cd'
 THEN RAISE EXCEPTION 'webinar_refinement_cb21_drift'; END IF;
 SELECT (ord-1)::text INTO STRICT v_html_index FROM jsonb_array_elements(v_l.blocks) WITH ORDINALITY x(b,ord) WHERE b->>'type'='html' AND b->>'id'='b02410a0-2430-4f24-8a24-202610240001';
 SELECT b->'content' INTO STRICT v_form FROM jsonb_array_elements(v_l.blocks) b WHERE b->>'type'='form' AND b->>'id'='f04721a0-2430-4f24-8a24-202610240001';
 SELECT (ord-1)::text,b INTO STRICT v_bonus_index,v_bonus FROM jsonb_array_elements(v_t.blocks) WITH ORDINALITY x(b,ord) WHERE b->>'type'='questionnaire_bonuses';
 SELECT * INTO STRICT v_tariff FROM tariffs WHERE product_id=v_l.product_id AND public_id='T-000196' AND is_active FOR SHARE;
 IF md5(to_jsonb(v_tariff)::text) IS DISTINCT FROM 'b80b62b0718de9561b1921d44665bd03'
 OR v_form->>'tariff_id' IS DISTINCT FROM v_tariff.id::text OR v_form->>'redirectUrl' IS DISTINCT FROM '/thx-web-2410'
 OR v_form->'webinar_registration' IS DISTINCT FROM 'true'::jsonb OR v_form->'contact_first' IS DISTINCT FROM 'true'::jsonb
 OR v_form->'deal_creation_enabled' IS DISTINCT FROM 'false'::jsonb OR v_form->'telegram_link' IS DISTINCT FROM 'true'::jsonb
 OR v_bonus#>>'{content,source_page_id}' IS DISTINCT FROM v_l.id::text
 OR v_bonus#>>'{content,source_block_id}' IS DISTINCT FROM 'f04721a0-2430-4f24-8a24-202610240001'
 OR v_bonus#>>'{content,channel_url}' IS NULL OR v_bonus#>>'{content,personal_chat_url}' IS NULL
 THEN RAISE EXCEPTION 'webinar_refinement_binding_drift'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') INTO v_templates FROM broadcast_templates t WHERE metadata->>'webinar_release'='web_2410_v1';
 IF jsonb_array_length(v_templates) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'webinar_refinement_template_drift'; END IF;
 v_l_new:=jsonb_set(v_l.blocks,ARRAY[v_html_index,'content','code'],to_jsonb(v_html));
 v_t_new:=jsonb_set(v_t.blocks,ARRAY[v_bonus_index,'content'],(v_bonus->'content')||jsonb_build_object('design','webinar','designer_html',v_design));
 v_t_old:=jsonb_set(v_t.blocks,ARRAY[v_bonus_index,'content'],(v_bonus->'content')-'design'-'designer_html');
 v_replayed:=v_l.blocks=v_l_new AND v_t.blocks=v_t_new;
 IF v_replayed THEN
  IF md5(jsonb_set(v_l.blocks,ARRAY[v_html_index,'content','code'],'\"\"'::jsonb)::text) IS DISTINCT FROM '${shape}'
  OR md5(v_t_old::text) IS DISTINCT FROM '2d8bc33b087412fa2c4567121c300ca9' THEN RAISE EXCEPTION 'webinar_refinement_replay_drift'; END IF;
  RAISE NOTICE 'web2410-v2 already applied; zero writes'; RETURN;
 END IF;
 IF md5(v_l.blocks::text) IS DISTINCT FROM '4b2f80873883ad26ffa05bdb3b7c9c29'
 OR md5(v_t.blocks::text) IS DISTINCT FROM '2d8bc33b087412fa2c4567121c300ca9'
 OR v_l.updated_at IS DISTINCT FROM '2026-10-16 09:51:17.658058+00'::timestamptz
 OR v_t.updated_at IS DISTINCT FROM '2026-10-16 09:51:17.658058+00'::timestamptz
 THEN RAISE EXCEPTION 'webinar_refinement_baseline_drift'; END IF;
 IF v_dry_run THEN RAISE NOTICE 'web2410-v2 dry-run PASS: exactly two page updates, zero template/data writes'; RETURN; END IF;
 UPDATE site_pages SET blocks=v_l_new,updated_at=now() WHERE id=v_l.id; GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'webinar_refinement_rowcount'; END IF;
 UPDATE site_pages SET blocks=v_t_new,updated_at=now() WHERE id=v_t.id; GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'webinar_refinement_rowcount'; END IF;
 IF (SELECT blocks FROM site_pages WHERE id=v_l.id) IS DISTINCT FROM v_l_new
 OR (SELECT blocks FROM site_pages WHERE id=v_t.id) IS DISTINCT FROM v_t_new
 OR (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM broadcast_templates t WHERE metadata->>'webinar_release'='web_2410_v1') IS DISTINCT FROM v_templates
 THEN RAISE EXCEPTION 'webinar_refinement_readback_failed'; END IF;
 RAISE NOTICE 'web2410-v2 apply PASS: exactly two page updates, templates unchanged';
END;
$release$;
`;
await writeFile(new URL('release-managed-apply.sql',import.meta.url),sql);
await writeFile(new URL('release-managed-dry-run.sql',import.meta.url),sql.replace('v_dry_run boolean:=false','v_dry_run boolean:=true'));
console.log('Generated read-only dry-run and atomic idempotent two-page patch.');
