import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderResidual} from './render-contact-merge-residuals.mjs';
const {PGlite}=await import(process.env.CONTACT_MERGE_PGLITE_MODULE||'@electric-sql/pglite');
const ids={G1:['e12d151d-f872-4726-8940-51d726e8e7bc','2c41efeb-d7f1-42f0-b595-75e5c4f386e4','1c3485af-3963-4139-9b8b-e8c71ec5fc02'],G10:['d74aeb9b-b959-4c65-9393-871d79bee598','dff8cb9a-3548-4acc-ad8b-0216d9b4190b','def0faba-02ca-4bec-b8cb-9a2b2eab74d1','fa10d932-eea5-46e2-a3b0-9c5b806ecb66']};
async function fixture(g){
 const db=new PGlite();const[m,o,u,oldU=u]=ids[g];
 await db.exec(`CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,deleted_at timestamptz,banned_until timestamptz);
 CREATE FUNCTION has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid UNIQUE,email text,status text,is_archived boolean,merged_to_profile_id uuid,telegram_user_id text,duplicate_flag text);
 CREATE TABLE orders_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,status text,is_deleted boolean);
 CREATE TABLE payments_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,status text,order_id uuid,amount numeric);
 CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,status text,order_id uuid,access_end_at timestamptz,auto_renew boolean);
 CREATE TABLE entitlements(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,status text,order_id uuid,expires_at timestamptz,product_code text,UNIQUE(user_id,product_code));
 CREATE TABLE referral_partners(id uuid PRIMARY KEY,profile_id uuid UNIQUE,status text);
 CREATE TABLE merge_history(id uuid PRIMARY KEY,master_profile_id uuid,merged_profile_id uuid,merged_data jsonb);
 CREATE TABLE audit_logs(action text,actor_type text,actor_label text,target_user_id uuid,meta jsonb);`);
 await db.query('INSERT INTO auth.users VALUES($1,$2,null,null)',[oldU,'buyer@example.invalid']);
 if(g==='G10')await db.query('INSERT INTO auth.users VALUES($1,$2,null,null)',[u,'active@example.invalid']);
 await db.query(`INSERT INTO profiles VALUES($1,$3,$5,$6,false,null,null,'none'),($2,$4,'buyer@example.invalid','archived',true,$7,null,'none')`,[m,o,g==='G1'?null:u,oldU,g==='G1'?'buyer@example.invalid':'active@example.invalid',g==='G1'?'imported':'active',g==='G1'?null:m]);
 let deps;
 if(g==='G1'){
  await db.query(`INSERT INTO referral_partners VALUES('71d63f4d-6c27-4091-86bc-f994bbd8c374',$1,'active'),('abcde024-a56d-4d2d-9939-9395d3ca5626',$2,'closed')`,[m,o]);
  await db.query(`INSERT INTO payments_v2(id,user_id,status,amount)VALUES('00000000-0000-4000-8000-000000000001',$1,'succeeded',123)`,[oldU]);
  deps={telegram_access_audit:11,telegram_logs:7,telegram_messages:3,tenant_memberships:1,user_roles_v2:1};
 }else{
  await db.query(`INSERT INTO orders_v2 VALUES('828ed0df-b37f-43fe-a9ba-f5e9bf7fae04',$1,$2,'paid',false)`,[m,u]);
  await db.query(`INSERT INTO payments_v2 VALUES('92825c91-9282-404b-8c35-a00685e4228e',$1,$2,'succeeded','828ed0df-b37f-43fe-a9ba-f5e9bf7fae04',123)`,[m,oldU]);
  await db.query(`INSERT INTO subscriptions_v2 VALUES('23a959b9-189e-43ed-855b-c564d078a77d',$1,$2,'expired','828ed0df-b37f-43fe-a9ba-f5e9bf7fae04','2026-08-09T07:38:29.802Z',false)`,[m,oldU]);
  await db.query(`INSERT INTO entitlements VALUES('1b7b04f6-4788-4eba-8966-f660c6c063a9',$1,$2,'expired','828ed0df-b37f-43fe-a9ba-f5e9bf7fae04','2026-08-09T07:38:29.802Z','consultation')`,[m,oldU]);
  await db.exec('CREATE TABLE access_grant_ledger(profile_id uuid,user_id uuid);CREATE TABLE email_logs(profile_id uuid,user_id uuid);CREATE TABLE client_duplicates(profile_id uuid)');
  await db.query('INSERT INTO access_grant_ledger VALUES($1,$2),(null,$2)',[o,oldU]);
  await db.query('INSERT INTO email_logs SELECT $1::uuid,$2::uuid FROM generate_series(1,3)',[o,oldU]);
  await db.query('INSERT INTO client_duplicates VALUES($1)',[o]);
  deps={consent_logs:1,telegram_logs:3};
 }
 for(const[t,n]of Object.entries(deps)){
  await db.exec(`CREATE TABLE ${t}(user_id uuid)`);
  await db.query(`INSERT INTO ${t} SELECT $1::uuid FROM generate_series(1,$2::int)`,[oldU,n]);
 }
 return db;
}
for(const g of ['G1','G10'])test(`${g} dry-run, exact ownership transfer and replay; login and paid facts preserved`,async()=>{
 const db=await fixture(g);const[m,o,u,oldU=u]=ids[g];
 try{
  const auth=(await db.query('SELECT * FROM auth.users ORDER BY id')).rows;
  const payments=(await db.query('SELECT * FROM payments_v2 ORDER BY id')).rows;
  await db.exec(renderResidual(g,'dry-run'));
  await db.exec(renderResidual(g,'rollback'));
  assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,0);
  assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1',[o])).rows[0].user_id,oldU);
  await db.exec(renderResidual(g,'execute'));await db.exec(renderResidual(g,'execute'));
  assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,1);
  assert.deepEqual((await db.query('SELECT * FROM auth.users ORDER BY id')).rows,auth);
  if(g==='G1'){
   assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1',[m])).rows[0].user_id,u);
   assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1',[o])).rows[0].user_id,null);
   assert.deepEqual((await db.query('SELECT * FROM payments_v2 ORDER BY id')).rows,payments);
   assert.equal((await db.query('SELECT count(*)::int n FROM referral_partners')).rows[0].n,2);
  }else{
   const after=(await db.query('SELECT * FROM payments_v2 ORDER BY id')).rows;
   assert.deepEqual(after.map(r=>({...r,user_id:oldU})),payments);
   for(const t of ['payments_v2','subscriptions_v2','entitlements'])assert.equal((await db.query(`SELECT user_id FROM ${t}`)).rows[0].user_id,u);
   assert.equal((await db.query('SELECT status FROM entitlements')).rows[0].status,'expired');
  }
 }finally{await db.close()}
});
test('new business dependency aborts G1 without dropping old login',async()=>{
 const db=await fixture('G1');try{
  await db.exec('CREATE TABLE payment_methods(user_id uuid)');await db.query('INSERT INTO payment_methods VALUES($1)',[ids.G1[2]]);
  await assert.rejects(db.exec(renderResidual('G1','execute')),/Auth dependency changed/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT user_id FROM profiles WHERE id=$1',[ids.G1[1]])).rows[0].user_id,ids.G1[2]);
 }finally{await db.close()}
});
test('unexpected trigger side effect rolls back every G10 owner change',async()=>{
 const db=await fixture('G10');try{
  await db.exec(`CREATE FUNCTION bad_change() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.status:='active';RETURN NEW;END$$;CREATE TRIGGER bad BEFORE UPDATE ON entitlements FOR EACH ROW EXECUTE FUNCTION bad_change();`);
  await assert.rejects(db.exec(renderResidual('G10','execute')),/changed money\/status\/window/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT user_id FROM payments_v2')).rows[0].user_id,ids.G10[3]);
  assert.equal((await db.query('SELECT count(*)::int n FROM merge_history')).rows[0].n,0);
 }finally{await db.close()}
});
