import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const base=new URL('../webinars/web-2410-refinement/',import.meta.url);
const landing='859c9cf0-657f-4585-a645-e93e66d940ca',thanks='20997a6e-0320-47f2-bf8b-b56b0d9f1e53',product='c0dbe1aa-8d8b-4f9b-83ee-0d57d1a3f740',tariff='745e77aa-46b5-4838-b5a2-7b7b1c8bad76';
test('refinement patches only two existing pages, read-only dry-run, strict replay and drift rejection',async()=>{
 const db=new PGlite();try{
  const prior=await readFile(new URL('../webinars/web-2410/release-managed-apply.sql',import.meta.url),'utf8');
  const blocks=JSON.parse(prior.match(/v_blocks jsonb:='([\s\S]*?)'::jsonb;/)[1].replaceAll("''","'"));blocks[1].content.tariff_id=tariff;
  const bonus=[{id:'bonus',type:'questionnaire_bonuses',content:{title:'Thanks',source_page_id:landing,source_block_id:blocks[1].id,channel_url:'https://t.me/+fixture',personal_chat_url:'https://t.me/m/fixture'}}];
  await db.exec(`CREATE TABLE site_pages(id uuid PRIMARY KEY,status text,slug text,product_id uuid,blocks jsonb,theme_settings jsonb DEFAULT '{}',seo_settings jsonb DEFAULT '{}',updated_at timestamptz DEFAULT '2026-10-16 09:51:17.658058+00');
  CREATE TABLE tariffs(id uuid,product_id uuid,public_id text,is_active boolean);CREATE TABLE broadcast_templates(id uuid,metadata jsonb,status text,channels text[]);`);
  await db.query('INSERT INTO site_pages(id,status,slug,product_id,blocks) VALUES($1,\'published\',\'web-2410\',$2,$3),($4,\'published\',\'thx-web-2410\',null,$5)',[landing,product,JSON.stringify(blocks),thanks,JSON.stringify(bonus)]);
  await db.exec("INSERT INTO site_pages(id,blocks) VALUES('c8c5c19a-a10d-4f6b-8049-449f37230ed0','[]'),('f2aceb14-0937-4c8d-814b-f62a2e03c6d6','[]')");
  await db.query('INSERT INTO tariffs VALUES($1,$2,\'T-000196\',true)',[tariff,product]);
  await db.exec(`INSERT INTO broadcast_templates VALUES(gen_random_uuid(),' {"webinar_release":"web_2410_v1"}','draft',ARRAY['email','telegram'])`);
  const hash=async(query,args=[])=>(await db.query(query,args)).rows[0].h;
  const bonusHash=await hash('SELECT md5(blocks::text) h FROM site_pages WHERE id=$1',[thanks]);
  const tariffHash=await hash('SELECT md5(to_jsonb(t)::text) h FROM tariffs t');
  const snapshot=async()=>JSON.stringify((await db.query('SELECT to_jsonb(t) x FROM broadcast_templates t')).rows);
  const before=await snapshot();
  let sql=await readFile(new URL('release-managed-apply.sql',base),'utf8');
  sql=sql.replaceAll('d9aca857be20f0d56d15c3353496192b','99914b932bd37a50b983c5e7c90ae93b')
   .replaceAll('fcc4e8260805641e6db9b4765cd302cd','99914b932bd37a50b983c5e7c90ae93b')
   .replaceAll('76c074055c73f08392dd1c8fd3f92ce2','d751713988987e9331980363e24189ce')
   .replaceAll('fa96f5c77fae37664f7342b4bcc597ec','d751713988987e9331980363e24189ce')
   .replaceAll('2d8bc33b087412fa2c4567121c300ca9',bonusHash).replaceAll('b80b62b0718de9561b1921d44665bd03',tariffHash);
  await db.exec(sql.replace('v_dry_run boolean:=false','v_dry_run boolean:=true'));
  assert.equal(await hash('SELECT md5(blocks::text) h FROM site_pages WHERE id=$1',[landing]),'4b2f80873883ad26ffa05bdb3b7c9c29');
  assert.equal(await snapshot(),before);
  await db.exec(sql);
  const actual=(await db.query('SELECT blocks FROM site_pages WHERE id=$1',[landing])).rows[0].blocks;
  assert.deepEqual(actual[1],blocks[1]);
  assert.equal(actual[0].content.code,await readFile(new URL('landing.html',base),'utf8'));
  const actualThanks=(await db.query('SELECT blocks FROM site_pages WHERE id=$1',[thanks])).rows[0].blocks;
  assert.equal(actualThanks[0].content.channel_url,bonus[0].content.channel_url);
  assert.equal(actualThanks[0].content.personal_chat_url,bonus[0].content.personal_chat_url);
  assert.equal(actualThanks[0].content.designer_html,await readFile(new URL('thanks.html',base),'utf8'));
  assert.equal(await snapshot(),before);
  const post=await hash('SELECT md5(blocks::text) h FROM site_pages WHERE id=$1',[landing]);
  await db.exec(sql);assert.equal(await hash('SELECT md5(blocks::text) h FROM site_pages WHERE id=$1',[landing]),post);
  await db.query("UPDATE site_pages SET blocks=jsonb_set(blocks,'{1,content,telegram_link}','false') WHERE id=$1",[landing]);
  await assert.rejects(db.exec(sql),/binding_drift/);
  await db.query('UPDATE site_pages SET blocks=$1 WHERE id=$2',[JSON.stringify(actual),landing]);
  await db.query("UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,channel_url}','\"https://t.me/+drift\"') WHERE id=$1",[thanks]);
  await assert.rejects(db.exec(sql),/replay_drift/);
  assert.equal(await snapshot(),before);
 }finally{await db.close();}
});
test('managed dry-run is generated from exact apply body and never issues an update',async()=>{
 const apply=await readFile(new URL('release-managed-apply.sql',base),'utf8');
 assert.equal(await readFile(new URL('release-managed-dry-run.sql',base),'utf8'),apply.replace('v_dry_run boolean:=false','v_dry_run boolean:=true'));
});
