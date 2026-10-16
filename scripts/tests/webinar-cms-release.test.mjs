import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
const landing='859c9cf0-657f-4585-a645-e93e66d940ca',thanks='20997a6e-0320-47f2-bf8b-b56b0d9f1e53',product='c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740';
test('reviewed CMS release changes three targets, stays idempotent and stops on CMS drift',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'webinar-cms-fixture-'));
 const db=new PGlite();try{
  const output=join(dir,'release.sql');
  execFileSync(process.execPath,['scripts/webinars/web-2410/build-release.mjs',output]);
  let sql=await readFile(output,'utf8');
  await db.exec(`CREATE TABLE site_pages(id uuid PRIMARY KEY,workspace_id uuid,status text,slug text,title text,product_id uuid,blocks jsonb,updated_at timestamptz,theme_settings jsonb DEFAULT '{}',seo_settings jsonb DEFAULT '{}');
  CREATE TABLE tariffs(id uuid DEFAULT gen_random_uuid(),product_id uuid,public_id text,is_active boolean);
  CREATE TABLE products_v2(id uuid,is_active boolean);
  CREATE TABLE live_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text UNIQUE,title text,description text,product_id uuid,access_rule jsonb,status text,platform_status text,is_published boolean,scheduled_at timestamptz,replay_enabled boolean,invite_mode text,direct_access_allowed boolean,event_type text,source_kind text,event_timezone text,room_state text,metadata jsonb);
  CREATE TABLE live_event_access_rules(live_event_id uuid,rule_kind text,product_id uuid,tariff_id uuid,conditions jsonb,sort_order int);
  CREATE TABLE site_form_submissions(page_id uuid);
  CREATE TABLE broadcast_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,template_type text,channel text,channels text[],message_text text,email_subject text,email_body_html text,button_text text,button_url text,send_mode text,status text,approval_status text,trigger_kind text,live_event_id uuid,audience_filters jsonb,metadata jsonb);`);
  await db.query("INSERT INTO site_pages(id,status,slug,title,product_id,blocks,updated_at) VALUES($1,'published','web-2410','Webinar',$2,'[]','2026-10-15 16:15:42.70476+00'),($3,'published','thx-web-2410','Thanks',null,'[]','2026-10-15 16:22:01.430509+00')",[landing,product,thanks]);
  await db.exec("INSERT INTO site_pages(id,blocks) VALUES('c8c5c19a-a10d-4f6b-8049-449f37230ed0','[]')");
  await db.query("INSERT INTO site_pages(id,blocks) VALUES('f2aceb14-0937-4c8d-814b-f62a2e03c6d6',$1)",[JSON.stringify([{id:'original-bonus',type:'questionnaire_bonuses',content:{channel_url:'https://t.me/+fixture',personal_chat_url:'https://t.me/m/fixture'}}])]);
  const sourceHash=(await db.query("SELECT md5(blocks::text) h FROM site_pages WHERE id='f2aceb14-0937-4c8d-814b-f62a2e03c6d6'")).rows[0].h;
  await db.query("INSERT INTO tariffs(product_id,public_id,is_active) VALUES($1,'T-000196',true);",[product]);await db.query('INSERT INTO products_v2 VALUES($1,true)',[product]);
  // Fixture substitutes only known public CMS guard hashes; production artifacts stay strict.
  sql=sql.replaceAll('76c074055c73f08392dd1c8fd3f92ce2','d751713988987e9331980363e24189ce').replaceAll('fa96f5c77fae37664f7342b4bcc597ec',sourceHash).replace('ROLLBACK;','COMMIT;');
  await db.exec(sql);
  const blocks=(await db.query('SELECT blocks FROM site_pages WHERE id=$1',[landing])).rows[0].blocks;
  assert.equal(blocks.length,2);assert.equal(blocks[1].content.fields.length,4);assert.equal(blocks[1].content.live_event_id,undefined);assert.ok(blocks[1].content.tariff_id);
  const t=(await db.query('SELECT blocks FROM site_pages WHERE id=$1',[thanks])).rows[0].blocks[0].content;
  assert.equal(t.channel_url,'https://t.me/+fixture');
  assert.equal(t.personal_chat_url,'https://t.me/m/fixture');
  assert.equal(t.title,'Спасибо, вы зарегистрированы на вебинар!');
  assert.equal((await db.query('SELECT count(*)::int n FROM live_events')).rows[0].n,0);
  assert.deepEqual((await db.query('SELECT status,approval_status,channels FROM broadcast_templates')).rows,[{status:'draft',approval_status:'pending',channels:['email','telegram']}]);
  await db.exec(sql);assert.equal((await db.query('SELECT count(*)::int n FROM live_events')).rows[0].n,0);
  await db.query("UPDATE site_pages SET blocks='[]' WHERE id=$1",[landing]);await assert.rejects(db.exec(sql),/webinar_cms_baseline_drift|webinar_existing_usage_drift/);await db.exec('ROLLBACK');
 }finally{await db.close();await rm(dir,{recursive:true,force:true})}
});
