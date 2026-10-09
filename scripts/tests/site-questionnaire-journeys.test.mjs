import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migration=await readFile(new URL('../../supabase/migrations/20261009083000_site_questionnaire_journeys.sql',import.meta.url),'utf8');
const resourceMigration=await readFile(new URL('../../supabase/migrations/20261009084000_site_questionnaire_stats_resource.sql',import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const key='a'.repeat(64),ip='b'.repeat(64);
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION has_admin_resource_access(uuid,text,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT current_setting('fixture.allow',true)='yes'$$;
 CREATE TABLE site_pages(id uuid PRIMARY KEY,status text,blocks jsonb);
 CREATE TABLE profiles(id uuid PRIMARY KEY);
 CREATE TABLE site_form_submissions(id uuid PRIMARY KEY,page_id uuid,profile_id uuid,status text,metadata jsonb,created_at timestamptz DEFAULT now());`);
 await db.query("INSERT INTO site_pages VALUES($1,'published',$2)",[id(1),JSON.stringify([{type:'form',content:{auth_mode:true,questionnaire_first:true}}])]);
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
  await track();await db.query('INSERT INTO profiles VALUES($1)',[id(9)]);
  await db.query("INSERT INTO site_form_submissions(id,page_id,profile_id,status,metadata) VALUES($1,$2,$3,'processed','{}')",[id(10),id(1),id(9)]);
  await assert.rejects(db.query('SELECT bind_site_questionnaire_journey($1,$2,$3)',[id(2),'c'.repeat(64),id(10)]),/journey_binding_invalid/);
  await db.query('SELECT bind_site_questionnaire_journey($1,$2,$3)',[id(2),key,id(10)]);
  const stats=()=>db.query("SELECT * FROM site_questionnaire_funnel_stats($1,now()-interval '1 day',now()+interval '1 day')",[id(1)]);
  await assert.rejects(stats(),/questionnaire_stats_forbidden/);
  await db.query("SELECT set_config('fixture.uid',$1,false)",[id(20)]);
  await db.exec("SELECT set_config('fixture.allow','yes',false)");
  const row=(await stats()).rows[0];
  assert.deepEqual([row.visits,row.visitors,row.questionnaires,row.contacts,row.new_accounts,row.existing_accounts],[1,1,1,1,0,0]);
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','site_questionnaire_journeys','SELECT') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

test('stats menu resource is seeded once and never replaces an existing conflicting route',async()=>{
 const {db}=await fixture();try{
  await db.exec("CREATE TABLE admin_section(id uuid PRIMARY KEY,code text,is_active boolean); CREATE TABLE admin_resource(section_id uuid,code text,label text,route text,sort_order integer,is_active boolean DEFAULT true,UNIQUE(section_id,code));");
  await assert.rejects(db.exec(resourceMigration),/questionnaire_stats_section_ambiguous/);
  await db.query("INSERT INTO admin_section VALUES($1,'forms-hub',true)",[id(40)]);
  await db.exec(resourceMigration);await db.exec(resourceMigration);
  assert.equal((await db.query('SELECT count(*)::int n FROM admin_resource')).rows[0].n,1);
  await db.exec("UPDATE admin_resource SET route='/admin/other'");
  await assert.rejects(db.exec(resourceMigration),/questionnaire_stats_resource_changed/);
  assert.equal((await db.query('SELECT route FROM admin_resource')).rows[0].route,'/admin/other');
 }finally{await db.close();}
});
