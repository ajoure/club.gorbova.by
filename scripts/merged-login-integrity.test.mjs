import {test} from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{retireMergedLogin}from'../supabase/functions/admin-merge-archived-login/retire.ts';
const{PGlite}=await import(process.env.CONTACT_MERGE_PGLITE_MODULE||'@electric-sql/pglite');
const sql=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const master='d74aeb9b-b959-4c65-9393-871d79bee598',old='dff8cb9a-3548-4acc-ad8b-0216d9b4190b',login='def0faba-02ca-4bec-b8cb-9a2b2eab74d1',oldLogin='fa10d932-eea5-46e2-a3b0-9c5b806ecb66';
async function retirementFixture(){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,banned_until timestamptz,deleted_at timestamptz,last_sign_in_at timestamptz);
 CREATE TABLE auth.sessions(user_id uuid);
 CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,email text,status text,is_archived boolean,merged_to_profile_id uuid);
 CREATE TABLE merge_history(id uuid PRIMARY KEY,master_profile_id uuid,merged_profile_id uuid,merged_data jsonb);
 CREATE TABLE audit_logs(action text,actor_type text,actor_label text,target_user_id uuid,meta jsonb);
 CREATE TABLE orders_v2(user_id uuid);CREATE TABLE access_grant_ledger(user_id uuid);
 CREATE FUNCTION has_role_v2(uuid,text)RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
 await db.query(`INSERT INTO auth.users VALUES($1,'current@example.invalid',null,null,null),($2,'old@example.invalid',null,null,null)`,[login,oldLogin]);
 await db.query(`INSERT INTO profiles VALUES($1,$3,'current@example.invalid','active',false,null),($2,$4,'old@example.invalid','archived',true,$1)`,[master,old,login,oldLogin]);
 await db.query(`INSERT INTO merge_history VALUES('ca2e06b2-5098-4fea-bbb4-c2958e31a610',$1,$2,'{}');`,[master,old]);
 await db.query('INSERT INTO access_grant_ledger VALUES($1)',[oldLogin]);
 await db.exec(sql('20260911145000_retire_merged_login_g10.sql'));return db;
}
const retireRpc=async(db,phase)=>(await db.query('SELECT admin_retire_merged_login_g10($1) r',[phase])).rows[0].r;
test('obsolete login retirement journals first, preserves active login and retries without duplicate audit',async()=>{
 const db=await retirementFixture();try{
  const before=(await db.query('SELECT * FROM profiles ORDER BY id')).rows;
  await retireRpc(db,'preflight');assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,1);
  await retireRpc(db,'prepare');await assert.rejects(retireRpc(db,'finish'),/Admin API retirement required/);
  await db.query("UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id=$1",[oldLogin]);
  assert.equal((await retireRpc(db,'finish')).changed,1);assert.equal((await retireRpc(db,'finish')).changed,0);
  assert.deepEqual((await db.query('SELECT * FROM profiles ORDER BY id')).rows,before);
  assert.equal((await db.query('SELECT banned_until FROM auth.users WHERE id=$1',[login])).rows[0].banned_until,null);
  await db.exec('SET ROLE authenticated');await assert.rejects(retireRpc(db,'preflight'),/permission denied/);
 }finally{await db.close()}
});
test('new purchase on obsolete login prevents retirement',async()=>{
 const db=await retirementFixture();try{await db.query('INSERT INTO orders_v2 VALUES($1)',[oldLogin]);await assert.rejects(retireRpc(db,'prepare'),/still owns live data/);
 }finally{await db.close()}
});
test('retirement API updates only ban duration, never deletes or sends an email',async()=>{
 const state={prepared:false,done:false,banned:false,updates:[]};
 const client={rpc:async(_,{_phase})=>{
  if(_phase==='finish'){state.done=true;return{data:{state:'complete',changed:1}}}
  if(state.done)return{data:{state:'complete',changed:0}};
  if(_phase==='prepare')state.prepared=true;
  return{data:{state:'prepared',user_id:oldLogin,ban_needed:!state.banned}};
 },auth:{admin:{updateUserById:async(id,patch)=>{assert.equal(id,oldLogin);assert.equal(state.prepared,true);assert.deepEqual(patch,{ban_duration:'876000h'});state.banned=true;state.updates.push(patch);return{}},getUserById:async()=>({data:{user:{banned_until:state.banned?'2126-09-11T00:00:00Z':null}}})}}};
 await retireMergedLogin(client,'dry-run');assert.equal(state.updates.length,0);assert.equal((await retireMergedLogin(client,'execute')).ok,true);assert.equal((await retireMergedLogin(client,'execute')).changed,0);assert.equal(state.updates.length,1);
});
async function claimFixture(){
 const db=new PGlite();await db.exec(`CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid,email text,raw_user_meta_data jsonb);
 CREATE TABLE profiles(id uuid DEFAULT gen_random_uuid(),user_id uuid,email text,status text,is_archived boolean,merged_to_profile_id uuid,
 first_name text,last_name text,full_name text,phone text,source text,was_club_member boolean,created_at timestamptz,updated_at timestamptz);
 CREATE TABLE app_settings(key text,value jsonb);CREATE TABLE orders_v2(profile_id uuid,user_id uuid,updated_at timestamptz);
 CREATE TABLE subscriptions_v2(id uuid,profile_id uuid,user_id uuid,product_id uuid,status text,access_end_at timestamptz,updated_at timestamptz);
 CREATE TABLE entitlements(profile_id uuid,user_id uuid,product_id uuid,product_code text,status text,expires_at timestamptz,meta jsonb,updated_at timestamptz,UNIQUE(user_id,product_code));
 CREATE TABLE products_v2(id uuid,code text);CREATE TABLE audit_logs(actor_type text,actor_user_id uuid,actor_label text,action text,target_user_id uuid,meta jsonb);
 CREATE TABLE consent_logs(user_id uuid,email text,consent_type text,policy_version text,granted boolean,source text);`);
 await db.exec(sql('20260911144000_prevent_merged_profile_reactivation.sql'));
 await db.exec('CREATE TRIGGER claim AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()');return db;
}
test('signup cannot reactivate merged archive, while a real unmerged legacy contact is still claimed',async()=>{
 const db=await claimFixture();try{
  await db.query(`INSERT INTO profiles(id,email,status,is_archived,merged_to_profile_id)VALUES($1,'old@example.invalid','archived',true,$2)`,[old,master]);
  await assert.rejects(db.query(`INSERT INTO auth.users VALUES($1,'old@example.invalid','{}')`,[oldLogin]),/Account registration unavailable/);
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,0);
  assert.equal((await db.query('SELECT is_archived FROM profiles')).rows[0].is_archived,true);
  await db.query(`INSERT INTO profiles(id,email,status,is_archived,merged_to_profile_id)VALUES($1,'old@example.invalid','imported',false,null)`,[master]);
  await db.query(`INSERT INTO auth.users VALUES($1,'old@example.invalid','{}')`,[login]);
  const rows=(await db.query('SELECT id,status,user_id,is_archived FROM profiles ORDER BY id')).rows;
  assert.equal(rows.find(r=>r.id===old).user_id,null);assert.equal(rows.find(r=>r.id===old).status,'archived');
  assert.equal(rows.find(r=>r.id===master).user_id,login);assert.equal(rows.find(r=>r.id===master).status,'active');
 }finally{await db.close()}
});
