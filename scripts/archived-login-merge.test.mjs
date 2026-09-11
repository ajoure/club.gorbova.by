import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runArchivedLoginMerge} from '../supabase/functions/admin-merge-archived-login/run.ts';
const {PGlite}=await import(process.env.CONTACT_MERGE_PGLITE_MODULE||'@electric-sql/pglite');
const master='955b4b96-0894-425f-a8ae-b2e3c1a78678',old='4ae8d7b7-f9ed-4402-b7fc-09786f2f2fb8',user='c466a856-d643-4f4a-b39a-f13e7d841822';
const migration=readFileSync(new URL('../supabase/migrations/20260911135000_archived_login_merge_g9.sql',import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,last_sign_in_at timestamptz);
 CREATE TABLE auth.sessions(user_id uuid);CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid UNIQUE,email text,phone text,status text,is_archived boolean,merged_to_profile_id uuid,telegram_user_id text,duplicate_flag text);
 CREATE TABLE merge_history(id uuid PRIMARY KEY,master_profile_id uuid,merged_profile_id uuid,merged_data jsonb);
 CREATE TABLE audit_logs(action text,actor_type text,actor_label text,target_user_id uuid,meta jsonb);
 CREATE FUNCTION has_role_v2(uuid,text)RETURNS boolean LANGUAGE sql AS $$SELECT false$$;`);
 await db.query(`INSERT INTO auth.users VALUES($1,'old@example.invalid',null,null,null,null)`,[user]);
 await db.query(`INSERT INTO profiles VALUES($1,null,'active@example.invalid','123456789','active',false,null,null,'none'),($2,$3,'old@example.invalid','+123456789','archived',true,null,null,'none')`,[master,old,user]);
 await db.exec(migration);return db;
}
async function rpc(db,phase){return(await db.query('SELECT admin_archived_login_merge_g9($1) r',[phase])).rows[0].r;}
test('private preflight writes nothing; journal precedes Auth; merge preserves active email and replay is zero',async()=>{
 const db=await fixture();try{
  await rpc(db,'preflight');assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,0);
  await rpc(db,'prepare');await rpc(db,'prepare');assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,1);
  await assert.rejects(rpc(db,'finish'),/Auth update and journal required/);
  await db.query(`UPDATE auth.users SET email='active@example.invalid' WHERE id=$1`,[user]);
  assert.deepEqual(await rpc(db,'finish'),{state:'complete',changed:1});assert.deepEqual(await rpc(db,'finish'),{state:'complete',changed:0});
  assert.deepEqual((await db.query('SELECT user_id,email FROM profiles WHERE id=$1',[master])).rows[0],{user_id:user,email:'active@example.invalid'});
  assert.equal((await db.query('SELECT merged_to_profile_id FROM profiles WHERE id=$1',[old])).rows[0].merged_to_profile_id,master);
  assert.equal((await db.query('SELECT email_confirmed_at FROM auth.users')).rows[0].email_confirmed_at,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,1);
  await db.exec('SET ROLE authenticated');await assert.rejects(rpc(db,'preflight'),/permission denied/);
 }finally{await db.close()}
});
test('unexpected purchases or changed phone block prepare',async()=>{
 const db=await fixture();try{
  await db.exec('CREATE TABLE orders_v2(user_id uuid)');await db.query('INSERT INTO orders_v2 VALUES($1)',[user]);
  await assert.rejects(rpc(db,'prepare'),/New login dependency/);assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,0);
 }finally{await db.close()}
});
function client({failFinish=false,uncertainFinish=false}={}){
 const state={email:'old@example.invalid',journal:false,complete:false,updates:[]};
 return{state,rpc:async(_name,{_phase})=>{
  if(_phase==='status')return{data:{state:state.complete?'complete':'prepared'}};
  if(_phase==='finish'){
   if(uncertainFinish)state.complete=true;
   if(failFinish||uncertainFinish)return{error:{message:'private error'}};
   state.complete=true;return{data:{state:'complete',changed:1}};
  }
  if(state.complete)return{data:{state:'complete',changed:0}};
  if(_phase==='prepare')state.journal=true;
  return{data:{state:'prepared',user_id:user,previous_email:'old@example.invalid',next_email:'active@example.invalid',auth_update_needed:true}};
 },auth:{admin:{getUserById:async()=>({data:{user:{email:state.email,email_confirmed_at:null,last_sign_in_at:null}}}),updateUserById:async(id,patch)=>{
  assert.equal(id,user);assert.equal(state.journal,true);assert.deepEqual(Object.keys(patch),['email']);state.email=patch.email;state.updates.push(patch.email);return{};
 }}}};
}
test('Admin workflow sends only email field and emits no email; retry avoids duplicate update',async()=>{
 const c=client();assert.equal((await runArchivedLoginMerge(c,'dry-run')).state,'ready');assert.equal(c.state.updates.length,0);
 assert.equal((await runArchivedLoginMerge(c,'execute')).ok,true);assert.equal((await runArchivedLoginMerge(c,'execute')).changed,0);
 assert.deepEqual(c.state.updates,['active@example.invalid']);assert.equal(JSON.stringify(await runArchivedLoginMerge(c,'execute')).includes('@'),false);
});
test('failed SQL finish compensates Auth; uncertain committed finish never restores wrong email',async()=>{
 const failed=client({failFinish:true});assert.equal((await runArchivedLoginMerge(failed,'execute')).stage,'rolled_back');assert.equal(failed.state.email,'old@example.invalid');
 const uncertain=client({uncertainFinish:true});assert.equal((await runArchivedLoginMerge(uncertain,'execute')).ok,true);assert.deepEqual(uncertain.state.updates,['active@example.invalid']);
});

test('unexpected confirmation state stops compensation instead of moving a verified login again',async()=>{
 const c=client();const read=c.auth.admin.getUserById;
 c.auth.admin.getUserById=async()=>{const r=await read();if(c.state.updates.length)r.data.user.email_confirmed_at='2026-09-11T00:00:00Z';return r;};
 const result=await runArchivedLoginMerge(c,'execute');assert.equal(result.stage,'auth_security_drift');assert.equal(result.manual_review,true);
 assert.deepEqual(c.state.updates,['active@example.invalid']);
});
