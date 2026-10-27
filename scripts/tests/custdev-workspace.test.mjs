import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture,serviceAclMigration,id,a,b,admin,noAccess,lesson,block,blank } from './custdev-fixture.mjs';

test('platform default grants are reproduced and history ACLs are narrowed without data loss',async()=>{
 const {db,as,save}=await fixture({applyServiceAcl:false});
 try{
  const privilege=async(table,p)=>(await db.query('SELECT has_table_privilege($1,$2,$3) AS ok',['service_role',`public.${table}`,p])).rows[0].ok;
  assert.equal(await privilege('training_custdev_versions','UPDATE'),true);
  assert.equal(await privilege('training_custdev_ai_runs','DELETE'),true);
  const w=await save(a,a,0,blank,true);
  await db.exec(serviceAclMigration);
  await db.exec(serviceAclMigration); // Reapplying ACLs has no data side effects.
  for(const table of ['training_custdev_workspaces','training_custdev_ai_runs','training_custdev_versions']){
   const direct=(await db.query("SELECT p.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) p WHERE c.oid=$1::regclass AND p.grantee=(SELECT oid FROM pg_roles WHERE rolname='service_role') ORDER BY p.privilege_type",[`public.${table}`])).rows.map(r=>r.privilege_type);
   assert.deepEqual(direct,table==='training_custdev_workspaces'?['DELETE','INSERT','SELECT','UPDATE']:['INSERT','SELECT']);
   for(const p of ['SELECT','INSERT'])assert.equal(await privilege(table,p),true);
   for(const p of ['TRUNCATE','TRIGGER','REFERENCES'])assert.equal(await privilege(table,p),false);
   if(table!=='training_custdev_workspaces')for(const p of ['UPDATE','DELETE'])assert.equal(await privilege(table,p),false);
  }
  await as('service_role',a,async()=>{
   const run=(await db.query('SELECT public.custdev_reserve_ai_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r',[a,w.id,id(101),'quotes','s1',null,'hash',w.revision,'fixture-model'])).rows[0].r.run;
   await assert.rejects(db.query('UPDATE public.training_custdev_ai_runs SET user_id=$1 WHERE id=$2',[b,run.id]),/permission denied/);
   await db.query("UPDATE public.training_custdev_ai_runs SET status='failed',error_code='fixture',finished_at=now() WHERE id=$1",[run.id]);
   await assert.rejects(db.query('DELETE FROM public.training_custdev_ai_runs'),/permission denied/);
   await assert.rejects(db.query("UPDATE public.training_custdev_versions SET status='draft'"),/permission denied/);
   await assert.rejects(db.query('DELETE FROM public.training_custdev_versions'),/permission denied/);
   await assert.rejects(db.query('TRUNCATE public.training_custdev_versions'),/permission denied/);
  });
  const reviewed=await save(admin,a,w.revision,blank,false,'approved');
  assert.equal(reviewed.status,'approved');
  assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_versions')).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_ai_runs')).rows[0].n,1);
 }finally{await db.close();}
});

test('migration, RLS, CAS, immutable submission and admin review',async()=>{
 const {db,as,save}=await fixture();
 try{
  assert.equal((await db.query("SELECT count(*) AS n FROM public.lesson_blocks WHERE block_type='video'")).rows[0].n,1);
  let wa=await save(a,a,0);await save(b,b,0);
  assert.equal(wa.revision,1);assert.equal(wa.status,'draft');
  await as('authenticated',a,async()=>{const rows=(await db.query('SELECT user_id FROM public.training_custdev_workspaces')).rows;assert.deepEqual(rows.map(r=>r.user_id),[a]);await assert.rejects(db.query("UPDATE public.training_custdev_workspaces SET status='approved'"),/permission denied/);await assert.rejects(db.query('SELECT public.custdev_save_workspace($1,$1,$2,$3,1,$4::jsonb)',[a,lesson,block,JSON.stringify(blank)]),/permission denied/);});
  await as('anon','',async()=>assert.rejects(db.query('SELECT * FROM public.training_custdev_workspaces'),/permission denied/));
  await as('authenticated',admin,async()=>assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_workspaces')).rows[0].n,2));
  await assert.rejects(save(a,b,1),/forbidden/);
  await assert.rejects(save(noAccess,noAccess,0),/lesson_access_required/);
  await assert.rejects(save(a,a,0),/revision_conflict/);
  await assert.rejects(save(a,a,1,blank,false,'approved'),/forbidden/);
  await assert.rejects(save(admin,a,1,blank,false,'approved'),/submit_before_review/);
  wa=await save(a,a,1,blank,true);assert.equal(wa.status,'submitted');assert.ok(wa.submitted_at);
  await assert.rejects(save(admin,a,2,{...blank,version:1,usps:[{}]},false,'approved'),/review_cannot_edit_answers/);
  wa=await save(admin,a,2,blank,false,'approved');assert.equal(wa.status,'approved');assert.equal(wa.reviewed_by,admin);
  assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_versions')).rows[0].n,2);
  await as('service_role',admin,async()=>assert.rejects(db.query("UPDATE public.training_custdev_versions SET status='draft'"),/permission denied/));
  await as('authenticated',b,async()=>assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_versions')).rows[0].n,0));
  await as('authenticated',a,async()=>assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_versions')).rows[0].n,2));
  wa=await save(a,a,3);assert.equal(wa.status,'draft');assert.equal(wa.reviewed_at,null);assert.equal(wa.submitted_at,null);
  const progress=(await db.query('SELECT response,completed_at FROM public.user_lesson_progress WHERE user_id=$1',[a])).rows[0];assert.equal(progress.response.status,'draft');assert.equal(progress.completed_at,null);
  assert.equal((await db.query('SELECT state_json FROM public.lesson_progress_state WHERE user_id=$1',[a])).rows[0].state_json.custdev_workspace_id,wa.id);
 }finally{await db.close();}
});

test('database rejects null/missing structure, question overflow and invalid scores',async()=>{
 const {db,as}=await fixture();
 try{await as('service_role',a,async()=>{
  const check=async s=>(await db.query('SELECT public.custdev_validate_state($1::jsonb) AS ok',[JSON.stringify(s)])).rows[0].ok;
  assert.equal(await check(blank),true);for(const s of [null,{}, {...blank,segments:null},{...blank,analyses:{s:{}}}])assert.equal(await check(s),false);
  const segment={id:'s',questions:Array.from({length:11},()=>({group:1,types:['active']}))};assert.equal(await check({...blank,segments:[segment]}),false);
  assert.equal(await check({...blank,segments:[{id:'s',questions:[{group:8,types:['active']}]}]}),false);
  for(const value of [0,6,1.5,'5'])assert.equal(await check({...blank,analyses:{s:{quotes:[],needs:[{overrides:{significance:value}}]}}}),false);
 });}finally{await db.close();}
});

test('AI reservation is owner-only, idempotent, rate-limited and revision guarded',async()=>{
 const {db,as,save}=await fixture();
 try{
  const w=await save(a,a,0);
  const reserve=(actor,request,revision=1,hash='hash')=>as('service_role',actor,async()=>(await db.query('SELECT public.custdev_reserve_ai_run($1,$2,$3,$4,$5,$6,$7,$8,$9) AS r',[actor,w.id,id(request),'quotes','s1',null,hash,revision,'fixture-model'])).rows[0].r);
  await assert.rejects(reserve(b,20),/forbidden/);await assert.rejects(reserve(a,20,0),/revision_conflict/);
  const first=await reserve(a,20);const replay=await reserve(a,20);assert.equal(first.run.id,replay.run.id);assert.equal(replay.replayed,true);
  await assert.rejects(reserve(a,20,1,'changed'),/request_conflict/);
  for(const n of [21,22,23,24])await reserve(a,n);await assert.rejects(reserve(a,25),/ai_rate_limit/);
  await as('authenticated',b,async()=>assert.equal((await db.query('SELECT count(*) AS n FROM public.training_custdev_ai_runs')).rows[0].n,0));
  await as('service_role',a,async()=>{await db.query("UPDATE public.training_custdev_ai_runs SET status='failed',finished_at=now() WHERE id=$1",[first.run.id]);await assert.rejects(db.query("UPDATE public.training_custdev_ai_runs SET error_code='rewrite' WHERE id=$1",[first.run.id]),/ai_history_immutable/);});
  // Fixture clock setup only, as database owner; production service cannot rewrite identity/timestamps.
  await db.exec("ALTER TABLE public.training_custdev_ai_runs DISABLE TRIGGER custdev_finish_ai_once");
  await db.query("UPDATE public.training_custdev_ai_runs SET created_at=now()-interval '2 minutes'");
  await db.exec("ALTER TABLE public.training_custdev_ai_runs ENABLE TRIGGER custdev_finish_ai_once");
  await db.query("INSERT INTO public.training_custdev_ai_runs(workspace_id,user_id,request_id,action,source_hash,workspace_revision,model_name,created_at) SELECT $1,$2,gen_random_uuid(),'quotes','h',1,'fixture',(date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 second' FROM generate_series(1,95)",[w.id,a]);
  assert.equal((await db.query("SELECT count(*) AS n FROM public.training_custdev_ai_runs WHERE user_id=$1 AND created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",[a])).rows[0].n,100);
  await assert.rejects(reserve(a,26),/ai_rate_limit/);
 }finally{await db.close();}
});
