import {readFile,writeFile} from 'node:fs/promises';
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const landing=await readFile(new URL('landing.html',import.meta.url),'utf8');
const formBlock='f04721a0-2430-4f24-8a24-202610240001';
const form={id:formBlock,type:'form',content:{title:'',subtitle:'',buttonText:'Продолжить',redirectUrl:'/thx-web-2410',auth_mode:true,questionnaire_first:true,contact_first:true,webinar_registration:true,presentation:'dialog',telegram_link:true,product_binding_enabled:true,product_id:'c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740',deal_creation_enabled:false,fields:[{label:'Имя',type:'text',mapping:'first_name',required:true},{label:'Фамилия',type:'text',mapping:'last_name',required:true},{label:'Email',type:'email',mapping:'email',required:true},{label:'Телефон',type:'phone',mapping:'phone',required:true}]}};
const blocks=[{id:'b02410a0-2430-4f24-8a24-202610240001',type:'html',content:{code:landing}},form];
const sql=`-- Reviewed GitHub artifact. Lovable Cloud only. Default ROLLBACK.
-- Expected: 2 CMS updates + 1 disabled notification draft. Irina owns webinar creation.
BEGIN;
DO $release$
DECLARE
 v_landing site_pages%ROWTYPE;v_thanks site_pages%ROWTYPE;v_source_thanks site_pages%ROWTYPE;v_bonus jsonb;v_tariff uuid;v_event uuid;v_template uuid;
 v_blocks jsonb:=${quote(JSON.stringify(blocks))}::jsonb;
 v_thanks_blocks jsonb; v_seo jsonb; v_template_expected jsonb; v_template_count int;
 v_rows int;v_total int:=0;v_dry_run boolean:=false;
BEGIN
 SELECT * INTO STRICT v_landing FROM site_pages WHERE id='859c9cf0-657f-4585-a645-e93e66d940ca' FOR UPDATE;
 SELECT * INTO STRICT v_thanks FROM site_pages WHERE id='20997a6e-0320-47f2-bf8b-b56b0d9f1e53' FOR UPDATE;
 IF v_landing.status IS DISTINCT FROM 'published' OR v_thanks.status IS DISTINCT FROM 'published'
 OR v_landing.slug IS DISTINCT FROM 'web-2410' OR v_thanks.slug IS DISTINCT FROM 'thx-web-2410'
 OR v_landing.product_id IS DISTINCT FROM 'c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740'::uuid OR v_thanks.product_id IS NOT NULL THEN RAISE EXCEPTION 'webinar_cms_routing_drift';END IF;
 SELECT * INTO STRICT v_source_thanks FROM site_pages WHERE id='f2aceb14-0937-4c8d-814b-f62a2e03c6d6' FOR SHARE;
 PERFORM 1 FROM site_pages WHERE id='c8c5c19a-a10d-4f6b-8049-449f37230ed0' FOR SHARE;
 IF (SELECT md5(blocks::text) FROM site_pages WHERE id='c8c5c19a-a10d-4f6b-8049-449f37230ed0') IS DISTINCT FROM '76c074055c73f08392dd1c8fd3f92ce2'
 OR md5(v_source_thanks.blocks::text) IS DISTINCT FROM 'fa96f5c77fae37664f7342b4bcc597ec'
 OR md5(v_source_thanks.theme_settings::text) IS DISTINCT FROM 'fcc4e8260805641e6db9b4765cd302cd'
 OR (SELECT md5(theme_settings::text) FROM site_pages WHERE id='c8c5c19a-a10d-4f6b-8049-449f37230ed0') IS DISTINCT FROM 'fcc4e8260805641e6db9b4765cd302cd'
 THEN RAISE EXCEPTION 'protected_cb21_drift'; END IF;
 SELECT b INTO STRICT v_bonus FROM jsonb_array_elements(v_source_thanks.blocks) b WHERE b->>'type'='questionnaire_bonuses';
 IF v_bonus#>>'{content,channel_url}' IS NULL OR v_bonus#>>'{content,personal_chat_url}' IS NULL THEN RAISE EXCEPTION 'webinar_approved_bonus_links_missing';END IF;
 SELECT id INTO STRICT v_tariff FROM tariffs WHERE product_id=v_landing.product_id AND public_id='T-000196' AND is_active FOR SHARE;
 IF (SELECT md5(to_jsonb(t)::text) FROM tariffs t WHERE id=v_tariff) IS DISTINCT FROM 'b80b62b0718de9561b1921d44665bd03'
 OR (SELECT updated_at FROM tariffs WHERE id=v_tariff) IS DISTINCT FROM '2026-10-15 16:09:41.566906+00'::timestamptz THEN RAISE EXCEPTION 'webinar_tariff_drift';END IF;
 IF NOT EXISTS(SELECT 1 FROM products_v2 WHERE id=v_landing.product_id AND is_active) THEN RAISE EXCEPTION 'webinar_product_unavailable';END IF;
 v_blocks:=jsonb_set(v_blocks,'{1,content,tariff_id}',to_jsonb(v_tariff::text));
 v_seo:=jsonb_build_object('title',v_landing.title,'description','Бесплатный вебинар Катерины Горбовой 24 октября 2026, 16:00 по Минску. Регистрация без пароля.');
 v_template_expected:=jsonb_build_object('name','Вебинар 24.10 — регистрация и ссылка на участие','template_type','general','channel','telegram','channels',jsonb_build_array('email','telegram'),
 'message_text','Вы зарегистрированы на бесплатный вебинар Катерины Горбовой «Как бухгалтеру зарабатывать от 5 000 BYN в месяц». Ждём вас 24 октября в 16:00 по Минску. Ссылку на участие пришлём отдельно.',
 'email_subject','Ваша регистрация на вебинар 24 октября','email_body_html','<p>Вы зарегистрированы на бесплатный вебинар Катерины Горбовой «Как бухгалтеру зарабатывать от 5 000 BYN в месяц».</p><p>Ждём вас 24 октября в 16:00 по Минску. Ссылку на участие пришлём отдельно.</p>',
 'button_text',null,'button_url',null,'send_mode','manual','status','draft','approval_status','pending','trigger_kind',null,'live_event_id',null,
 'audience_filters',jsonb_build_object('webinar_registration',jsonb_build_object('page_id',v_landing.id,'block_id','${formBlock}')),
 'metadata',jsonb_build_object('webinar_registration',true,'webinar_release','web_2410_v1'));
 v_bonus:=jsonb_set(v_bonus,'{id}','"b02410a0-2430-4f24-8a24-202610240002"');
 v_bonus:=jsonb_set(v_bonus,'{content,title}','"Спасибо, вы зарегистрированы на вебинар!"');
 v_bonus:=jsonb_set(v_bonus,'{content,source_page_id}',to_jsonb(v_landing.id::text));
 v_bonus:=jsonb_set(v_bonus,'{content,source_block_id}','"${formBlock}"');
 v_thanks_blocks:=jsonb_build_array(v_bonus);
 SELECT count(*) INTO v_template_count FROM broadcast_templates WHERE metadata->>'webinar_release'='web_2410_v1';
 IF v_landing.blocks=v_blocks AND v_thanks.blocks=v_thanks_blocks AND v_thanks.theme_settings=v_source_thanks.theme_settings
 AND v_landing.seo_settings=v_seo AND v_thanks.seo_settings='{}'::jsonb AND v_landing.theme_settings='{}'::jsonb AND v_template_count=1
 AND EXISTS(SELECT 1 FROM broadcast_templates t WHERE t.metadata->>'webinar_release'='web_2410_v1' AND to_jsonb(t)@>v_template_expected) THEN
  RAISE NOTICE 'webinar_release_replayed rows=0';RETURN;END IF;
 IF v_landing.status IS DISTINCT FROM 'published' OR v_thanks.status IS DISTINCT FROM 'published' OR v_landing.slug IS DISTINCT FROM 'web-2410' OR v_thanks.slug IS DISTINCT FROM 'thx-web-2410'
 OR v_landing.product_id IS DISTINCT FROM 'c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740'::uuid OR v_thanks.product_id IS NOT NULL
 OR md5(v_landing.blocks::text) IS DISTINCT FROM 'd751713988987e9331980363e24189ce' OR md5(v_thanks.blocks::text) IS DISTINCT FROM 'd751713988987e9331980363e24189ce'
 OR v_landing.updated_at IS DISTINCT FROM '2026-10-15 16:15:42.70476+00'::timestamptz
 OR v_thanks.updated_at IS DISTINCT FROM '2026-10-15 16:22:01.430509+00'::timestamptz
 OR v_landing.theme_settings IS DISTINCT FROM '{}'::jsonb OR v_thanks.theme_settings IS DISTINCT FROM '{}'::jsonb
 OR v_landing.seo_settings IS DISTINCT FROM '{}'::jsonb OR v_thanks.seo_settings IS DISTINCT FROM '{}'::jsonb
 OR v_template_count<>0 THEN RAISE EXCEPTION 'webinar_cms_baseline_drift';END IF;
 IF EXISTS(SELECT 1 FROM site_form_submissions WHERE page_id IN(v_landing.id,v_thanks.id))
 OR EXISTS(SELECT 1 FROM broadcast_templates WHERE audience_filters#>>'{webinar_registration,page_id}'=v_landing.id::text) THEN RAISE EXCEPTION 'webinar_existing_usage_drift';END IF;
 IF v_dry_run THEN RAISE NOTICE 'webinar_release_dry_run expected_rows=3 updates=2 inserts=1 sends=0';RETURN;END IF;
 -- Read back restricted originals before real execution; never emit personal rows.
 RAISE NOTICE 'webinar_cms_backup=%',jsonb_build_array(to_jsonb(v_landing),to_jsonb(v_thanks));
 UPDATE site_pages SET blocks=v_blocks,seo_settings=v_seo WHERE id=v_landing.id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;v_total:=v_total+v_rows;
 UPDATE site_pages SET blocks=v_thanks_blocks,theme_settings=v_source_thanks.theme_settings WHERE id=v_thanks.id;
 GET DIAGNOSTICS v_rows=ROW_COUNT;v_total:=v_total+v_rows;
 -- Administrator can approve/send later using the existing broadcast UI.
 -- Draft status means zero enqueue, no actual email or Telegram message here.
 INSERT INTO broadcast_templates(name,template_type,channel,channels,message_text,email_subject,email_body_html,button_text,button_url,
  send_mode,status,approval_status,trigger_kind,live_event_id,audience_filters,metadata)
 VALUES('Вебинар 24.10 — регистрация и ссылка на участие','general','telegram',ARRAY['email','telegram'],
  'Вы зарегистрированы на бесплатный вебинар Катерины Горбовой «Как бухгалтеру зарабатывать от 5 000 BYN в месяц». Ждём вас 24 октября в 16:00 по Минску. Ссылку на участие пришлём отдельно.',
  'Ваша регистрация на вебинар 24 октября',
  '<p>Вы зарегистрированы на бесплатный вебинар Катерины Горбовой «Как бухгалтеру зарабатывать от 5 000 BYN в месяц».</p><p>Ждём вас 24 октября в 16:00 по Минску. Ссылку на участие пришлём отдельно.</p>',
  null,null,'manual','draft','pending',null,null,jsonb_build_object('webinar_registration',jsonb_build_object('page_id',v_landing.id,'block_id','${formBlock}')),
  v_template_expected->'metadata') RETURNING id INTO v_template;
 v_total:=v_total+1;
 IF v_total<>3 OR (SELECT blocks FROM site_pages WHERE id=v_landing.id)<>v_blocks OR (SELECT blocks FROM site_pages WHERE id=v_thanks.id)<>v_thanks_blocks
 OR (SELECT to_jsonb(p)-'blocks'-'seo_settings'-'updated_at' FROM site_pages p WHERE id=v_landing.id) IS DISTINCT FROM (to_jsonb(v_landing)-'blocks'-'seo_settings'-'updated_at')
 OR (SELECT to_jsonb(p)-'blocks'-'theme_settings'-'updated_at' FROM site_pages p WHERE id=v_thanks.id) IS DISTINCT FROM (to_jsonb(v_thanks)-'blocks'-'theme_settings'-'updated_at') THEN RAISE EXCEPTION 'webinar_release_readback_failed';END IF;
 IF NOT EXISTS(SELECT 1 FROM broadcast_templates t WHERE id=v_template AND to_jsonb(t)@>v_template_expected)
 OR (SELECT blocks FROM site_pages WHERE id=v_source_thanks.id) IS DISTINCT FROM v_source_thanks.blocks
 OR (SELECT theme_settings FROM site_pages WHERE id=v_source_thanks.id) IS DISTINCT FROM v_source_thanks.theme_settings
 OR (SELECT md5(blocks::text) FROM site_pages WHERE id='c8c5c19a-a10d-4f6b-8049-449f37230ed0') IS DISTINCT FROM '76c074055c73f08392dd1c8fd3f92ce2' THEN RAISE EXCEPTION 'webinar_release_protected_readback_failed';END IF;
 RAISE NOTICE 'webinar_release rows=% event_id=% template_id=% landing_md5=% thanks_md5=%',v_total,v_event,v_template,md5(v_blocks::text),md5(v_thanks_blocks::text);
END;
$release$;
ROLLBACK;
`;
await writeFile(process.argv[2] || new URL('release.sql',import.meta.url),sql);
if(!process.argv[2]){
 const managed=sql.replace('BEGIN;\n','').replace('ROLLBACK;\n','');
 await writeFile(new URL('release-managed-apply.sql',import.meta.url),managed);
 await writeFile(new URL('release-managed-dry-run.sql',import.meta.url),managed.replace('v_dry_run boolean:=false','v_dry_run boolean:=true'));
 const migration=await readFile(new URL('../../../supabase/migrations/20261016074828_webinar_registration_reuse.sql',import.meta.url),'utf8');
 await writeFile(new URL('migration-managed.sql',import.meta.url),migration.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,''));
}
console.log(JSON.stringify({artifact:'release.sql',expectedWrites:3,notificationsSent:0,thanks:'reuse approved questionnaire bonus block and links'}));
