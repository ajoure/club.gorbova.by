import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, notifications } from './site-questionnaire-database.test.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const load=name=>readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
const fields=[{label:'Имя',type:'text',mapping:'first_name',required:true},{label:'Фамилия',type:'text',mapping:'last_name',required:true},{label:'Email',type:'email',mapping:'email',required:true},{label:'Телефон',type:'phone',mapping:'phone',required:true}];
const answers=fields.map((f,i)=>({...f,value:['Анна','Иванова','buyer@example.invalid','+375291112233'][i]}));
async function webinar(){
 const {db}=await fixture();
 await db.exec(`ALTER TABLE profiles ADD COLUMN email text,ADD COLUMN first_name text,ADD COLUMN last_name text,ADD COLUMN instagram_url text;
 CREATE TABLE live_events(id uuid PRIMARY KEY,product_id uuid);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 CREATE FUNCTION has_admin_resource_access(uuid,text,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
 await notifications(db);
 await db.exec(await load('20261009064000_site_questionnaire_incomplete_reminders'));
 await db.exec(await load('20261009083000_site_questionnaire_journeys'));
 await db.exec(await load('20261015134159_cb21_contact_first'));
 await db.exec(await load('20261016074828_webinar_registration_reuse'));
 await db.query('UPDATE site_pages SET blocks=$1',[JSON.stringify([{id:id(8),type:'form',content:{auth_mode:true,questionnaire_first:true,contact_first:true,webinar_registration:true,product_binding_enabled:true,product_id:id(4),tariff_id:id(5),deal_creation_enabled:false,fields}}])]);
 const register=(key=id(10),values=answers)=>db.query('SELECT submit_site_webinar_registration($1,$2,$3,$4,$5,$6,$7) result',[id(3),id(8),id(1),key,JSON.stringify(values),null,'v2026-04-10']).then(r=>r.rows[0].result);
 return {db,register};
}
test('free webinar saves one registration with separate names, preserves purchases and replays with a fresh browser key',async()=>{
 const {db,register}=await webinar();try{
  await db.exec('UPDATE profiles SET full_name=null,first_name=null,last_name=null,phone=null');
  const result=await register();assert.equal(result.registered,true);assert.equal(result.replayed,false);
  const profile=(await db.query('SELECT first_name,last_name,full_name,phone FROM profiles')).rows[0];
  assert.deepEqual(profile,{first_name:'Анна',last_name:'Иванова',full_name:'Анна Иванова',phone:'+375291112233'});
  assert.equal((await register(id(11))).replayed,true);
  assert.equal((await db.query('SELECT count(*)::int n FROM site_form_submissions')).rows[0].n,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM commercial_access')).rows[0].n,0);
  const metadata=(await db.query('SELECT metadata FROM site_form_submissions')).rows[0].metadata;
  assert.equal(metadata.webinar_registration,true);assert.equal(metadata.product_id,id(4));
 }finally{await db.close()}
});
test('webinar cannot bypass verified email, bot or required phone; failing attempts leave no partial contact',async()=>{
 const {db,register}=await webinar();try{
  await assert.rejects(register(id(11),answers.map((a,i)=>i===2?{...a,value:'foreign@example.invalid'}:a)),/questionnaire_email_mismatch/);
  await assert.rejects(register(id(12),answers.map((a,i)=>i===3?{...a,value:'1'}:a)),/phone_invalid/);
  await db.exec('UPDATE profiles SET telegram_user_id=null');
  await assert.rejects(register(),/webinar_telegram_link_required/);
  assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_confirmations')).rows[0].n,0);
  await db.exec('UPDATE profiles SET telegram_user_id=123;UPDATE auth.users SET email_confirmed_at=null');
  await assert.rejects(register(),/questionnaire_identity_invalid/);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query("SELECT has_function_privilege($1,'submit_site_webinar_registration(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)','EXECUTE') ok",[role])).rows[0].ok,role==='service_role');
 }finally{await db.close()}
});
test('webinar flag never changes the existing questionnaire contract or creates a deal',async()=>{
 const {db,register}=await webinar();try{
  const before=(await db.query("SELECT prosrc,proacl FROM pg_proc WHERE proname IN('save_site_questionnaire_contact','submit_site_questionnaire') ORDER BY proname")).rows;
  await db.exec(await load('20261016074828_webinar_registration_reuse'));
  assert.deepEqual((await db.query("SELECT prosrc,proacl FROM pg_proc WHERE proname IN('save_site_questionnaire_contact','submit_site_questionnaire') ORDER BY proname")).rows,before);
  await db.exec("UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,deal_creation_enabled}','true')");
  await assert.rejects(register(),/webinar_registration_configuration_invalid/);
  assert.equal((await db.query('SELECT count(*)::int n FROM orders_v2')).rows[0].n,0);
 }finally{await db.close()}
});
