import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../../supabase/migrations/20261009083000_site_questionnaire_journeys.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key='a'.repeat(64),ip='b'.repeat(64);
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION has_admin_resource_access(uuid,text,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('fixture.allow',true)='yes' AND $2='forms-hub' AND $3='site' AND $4='view'$$;
 CREATE TABLE site_pages(id uuid PRIMARY KEY,status text,blocks jsonb);
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,raw_app_meta_data jsonb);
 CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,status text DEFAULT 'active',is_archived boolean DEFAULT false,merged_to_profile_id uuid);
 CREATE TABLE site_form_submissions(id uuid PRIMARY KEY,page_id uuid,profile_id uuid,status text,metadata jsonb,created_at timestamptz DEFAULT now());`);
 await db.query("INSERT INTO site_pages VALUES($1,'published',$2)",[id(1),JSON.stringify([{id:id(8),type:'form',content:{auth_mode:true,questionnaire_first:true}}])]);
 await db.exec(migration);
 const track=(journey=id(2),visit=id(3),attribution={utm_source:'Stories',utm_campaign:'ЦБ21'},hash=key)=>db.query('SELECT track_site_questionnaire_visit($1,$2,$3,$4,$5,$6) result',[journey,hash,visit,id(1),JSON.stringify(attribution),ip]).then(r=>r.rows[0].result);
 return {db,track};
}
test('first-touch stays immutable; duplicate events do not inflate views and unknown owners cannot resume',async()=>{
 const {db,track}=await fixture();try{
  assert.deepEqual(await track(),{status:'tracked',replayed:false});
  assert.deepEqual(await track(),{status:'tracked',replayed:true});
  await track(id(2),id(4),{utm_source:'Telegram'});
  const row=(await db.query('SELECT attribution FROM site_questionnaire_journeys')).rows[0];
  assert.deepEqual(row.attribution,{utm_source:'Stories',utm_campaign:'ЦБ21'});
  assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_visits')).rows[0].n,2);
  await assert.rejects(track(id(2),id(5),{},'c'.repeat(64)),/journey_owner_invalid/);
  await assert.rejects(track(id(6),id(3)),/journey_visit_conflict/);
 }finally{await db.close();}
});
test('published questionnaire and bounded fields are required, and minute quota is atomic',async()=>{
 const {db,track}=await fixture();try{
  await assert.rejects(track(id(2),id(3),{email:'not-attribution'}),/journey_attribution_invalid/);
  await db.exec("UPDATE site_pages SET status='draft'");
  await assert.rejects(track(),/journey_page_unavailable/);
  await db.exec("UPDATE site_pages SET status='published'");
  for(let i=0;i<30;i++)assert.equal((await track(id(2),id(100+i))).status,'tracked');
  assert.equal((await track(id(2),id(200))).status,'rate_limited');
  assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_visits')).rows[0].n,30);
 }finally{await db.close();}
});
test('only owning journey attaches to a saved contact, and stats require admin permission',async()=>{
 const {db,track}=await fixture();try{
  await track();await db.query("INSERT INTO auth.users VALUES($1,'existing@example.invalid',now(),null,null,'{}')",[id(90)]);
  await db.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)',[id(9),id(90)]);
  await db.query("INSERT INTO site_form_submissions(id,page_id,profile_id,status,metadata) VALUES($1,$2,$3,'processed','{}')",[id(10),id(1),id(9)]);
  await assert.rejects(db.query('SELECT bind_site_questionnaire_journey($1,$2,$3)',[id(2),'c'.repeat(64),id(10)]),/journey_binding_invalid/);
  await db.query('SELECT bind_site_questionnaire_journey($1,$2,$3)',[id(2),key,id(10)]);
  const stats=()=>db.query("SELECT * FROM site_questionnaire_funnel_stats($1,now()-interval '1 day',now()+interval '1 day')",[id(1)]);
  await assert.rejects(stats(),/questionnaire_stats_forbidden/);
  await db.query("SELECT set_config('fixture.uid',$1,false)",[id(20)]);
  await db.exec("SELECT set_config('fixture.allow','yes',false)");
  const row=(await stats()).rows[0];
  assert.deepEqual([row.visits,row.visitors,row.questionnaires,row.contacts,row.new_accounts,row.existing_accounts],[1,1,1,1,0,1]);
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','site_questionnaire_journeys','SELECT') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('verified signup outcome survives retry before submission; ownership and canonical account are enforced',async()=>{
 const {db,track}=await fixture();try{
  await track();
  await db.query("INSERT INTO auth.users VALUES($1,'new@example.invalid',now(),null,null,$2)",[id(90),JSON.stringify({questionnaire_signup_journey_id:id(2)})]);
  await db.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)',[id(9),id(90)]);
  const record=(hash=key,user=id(90))=>db.query('SELECT record_site_questionnaire_account_outcome($1,$2,$3)',[id(2),hash,user]);
  await assert.rejects(record('c'.repeat(64)),/journey_binding_invalid/);
  await record();
  const first=(await db.query('SELECT account_outcome,outcome_at FROM site_questionnaire_journeys')).rows[0];
  assert.equal(first.account_outcome,'new_account');
  await db.exec("UPDATE auth.users SET raw_app_meta_data='{}'");
  await record();assert.deepEqual((await db.query('SELECT account_outcome,outcome_at FROM site_questionnaire_journeys')).rows[0],first);
  await db.query("SELECT set_config('fixture.uid',$1,false)",[id(20)]);await db.exec("SELECT set_config('fixture.allow','yes',false)");
  const stats=(await db.query("SELECT * FROM site_questionnaire_funnel_stats($1,now()-interval '1 day',now()+interval '1 day')",[id(1)])).rows[0];
  assert.deepEqual([stats.new_accounts,stats.questionnaires],[1,0]);
  const validate=(email='new@example.invalid',hash=key)=>db.query('SELECT validate_site_questionnaire_otp_journey($1,$2,$3,$4,$5)',[id(2),hash,id(1),id(8),email]);
  assert.equal((await db.query("SELECT has_function_privilege('authenticated','record_site_questionnaire_account_outcome(uuid,text,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  await validate();await assert.rejects(validate('other@example.invalid'),/questionnaire_context_invalid/);
  await assert.rejects(validate('new@example.invalid','c'.repeat(64)),/questionnaire_context_invalid/);
  await db.exec("UPDATE auth.users SET banned_until=now()+interval '1 day'");await assert.rejects(record(),/journey_binding_invalid/);
 }finally{await db.close();}
});
