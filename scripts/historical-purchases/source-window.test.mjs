import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.env.HISTORICAL_PGLITE_MODULE || '@electric-sql/pglite');
const migration=readFileSync(new URL('../../supabase/migrations/20260911111500_historical_business_source_window.sql',import.meta.url),'utf8');
const user='00000000-0000-4000-8000-000000000001';
const course='7101ed3c-7839-4a74-ad95-aa0660369b22',club='11c9f1b8-0355-4753-bd74-40b42aa53616';
const business='7c748940-dcad-4c7c-a92e-76a2344622d3',rule='1b497fba-031a-4318-8d9f-2530f1bac116';
const source='00000000-0000-4000-8000-000000000002',mod='00000000-0000-4000-8000-000000000003';
const lesson='00000000-0000-4000-8000-000000000004';

async function fixture(){
  const db=new PGlite();
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
    CREATE FUNCTION has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT coalesce(current_setting('test.admin',true),'false')='true' AND $2='admin'$$;
    CREATE FUNCTION has_permission(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
    CREATE FUNCTION has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
    CREATE TYPE subscription_status AS ENUM('active','trial','past_due','canceled','expired','superseded','pending');
    CREATE TABLE products_v2(id uuid PRIMARY KEY,code text UNIQUE);
    CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,user_id uuid,product_id uuid,tariff_id uuid,
      status subscription_status,is_trial boolean,access_start_at timestamptz,access_end_at timestamptz);
    CREATE TABLE entitlement_sources(id uuid PRIMARY KEY,user_id uuid,product_id uuid,tariff_id uuid,
      status text,starts_at timestamptz,expires_at timestamptz);
    CREATE TABLE entitlements(id uuid PRIMARY KEY,user_id uuid,product_id uuid,product_code text,meta jsonb,status text,expires_at timestamptz);
    CREATE TABLE training_modules(id uuid PRIMARY KEY,product_id uuid,is_active boolean);
    CREATE TABLE training_lessons(id uuid PRIMARY KEY,module_id uuid,is_active boolean);
    CREATE TABLE lesson_blocks(id uuid PRIMARY KEY,lesson_id uuid);
    CREATE TABLE module_access(module_id uuid,tariff_id uuid);
    CREATE TABLE kb_questions(lesson_id uuid);
    CREATE TABLE access_rules(id uuid PRIMARY KEY,product_id uuid,tariff_id uuid,is_active boolean,
      grant_target_type text,target_ref text,conditions jsonb);
    ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE training_lessons ENABLE ROW LEVEL SECURITY;
    ALTER TABLE lesson_blocks ENABLE ROW LEVEL SECURITY;
    CREATE POLICY own_entitlements ON entitlements FOR SELECT TO authenticated USING(user_id=auth.uid());
    CREATE POLICY kb_reference ON training_lessons FOR SELECT TO authenticated USING(
      is_active AND EXISTS(SELECT 1 FROM kb_questions k WHERE k.lesson_id=training_lessons.id));
    CREATE POLICY "Users can view lesson blocks with access" ON lesson_blocks FOR SELECT USING(true);`);
  await db.query('INSERT INTO products_v2 VALUES ($1,$2),($3,$4)',[course,'cb20',club,'club']);
  await db.query(`INSERT INTO subscriptions_v2 VALUES ($1,$2,$3,$4,'active',false,now()-interval '1 day',now()+interval '1 day')`,[source,user,club,business]);
  const meta={source_rule_id:rule,business_subscription_id:source,business_tariff_id:business,source_type:'rule_engine',source_access_kind:'subscription'};
  await db.query(`INSERT INTO entitlements VALUES
    ('00000000-0000-4000-8000-000000000005',$1,$2,'cb20',$4,'active',now()+interval '3 days'),
    ('00000000-0000-4000-8000-000000000006',$1,$3,'club','{}','active',now()+interval '3 days')`,[user,course,club,meta]);
  await db.query('INSERT INTO training_modules VALUES ($1,$2,true)',[mod,course]);
  await db.query('INSERT INTO training_lessons VALUES ($1,$2,true)',[lesson,mod]);
  await db.query("INSERT INTO lesson_blocks VALUES ('00000000-0000-4000-8000-000000000007',$1)",[lesson]);
  await db.query('INSERT INTO kb_questions VALUES ($1)',[lesson]);
  await db.query("INSERT INTO access_rules VALUES ($1,$2,$3,true,'product_access',$4,$5)",[rule,club,business,course,{condition_type:'prior_purchase',product_ids:[course]}]);
  await db.exec(migration);
  await db.exec('GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[user]);
  return db;
}
async function canRead(db){
  await db.exec('SET ROLE authenticated');
  try {
    const r=(await db.query(`SELECT
      (SELECT count(*)::int FROM training_lessons) lessons,
      (SELECT count(*)::int FROM lesson_blocks) blocks,
      (SELECT count(*)::int FROM entitlements WHERE product_id=$1 AND status='active') projections,
      user_has_training_lesson_access($2,$3) rpc`,[course,user,lesson])).rows[0];
    return r;
  } finally {await db.exec('RESET ROLE');}
}
const allowed={lessons:1,blocks:1,projections:1,rpc:true};
const denied={lessons:0,blocks:0,projections:0,rpc:false};

test('Business access ends at the real source boundary, through RPC, lesson RLS and block RLS',async()=>{
  const db=await fixture();try{
    assert.deepEqual(await canRead(db),allowed);
    await db.exec("UPDATE subscriptions_v2 SET status='canceled'");
    assert.deepEqual(await canRead(db),allowed);
    await db.exec('UPDATE subscriptions_v2 SET access_end_at=now()');
    assert.deepEqual(await canRead(db),denied);
    // Staff retain history and content administration even after the pupil loses access.
    await db.exec("SELECT set_config('test.admin','true',false)");
    assert.deepEqual(await canRead(db),allowed);
  }finally{await db.close();}
});

test('a second valid Business source or an independent target purchase prevents over-revocation',async()=>{
  const db=await fixture();try{
    await db.exec("UPDATE subscriptions_v2 SET access_end_at=now()-interval '1 hour'");
    await db.query(`INSERT INTO subscriptions_v2 VALUES
      ('00000000-0000-4000-8000-000000000008',$1,$2,$3,'active',false,now()-interval '1 day',now()+interval '2 days')`,[user,club,business]);
    assert.deepEqual(await canRead(db),allowed);
    await db.exec("UPDATE subscriptions_v2 SET status='expired'");
    await db.query(`INSERT INTO entitlement_sources VALUES
      ('00000000-0000-4000-8000-000000000009',$1,$2,null,'active',now()-interval '1 day',now()+interval '5 days')`,[user,course]);
    assert.deepEqual(await canRead(db),allowed);
    // Independent source still works if the aggregate projection is missing.
    await db.query('DELETE FROM entitlements WHERE product_id=$1',[course]);
    assert.deepEqual(await canRead(db),{...allowed,projections:0});
  }finally{await db.close();}
});

test('finite Club entitlement_source works without a subscription; revocation closes secondary access',async()=>{
  const db=await fixture();try{
    await db.exec('DELETE FROM subscriptions_v2');
    const id='00000000-0000-4000-8000-000000000010';
    await db.query(`INSERT INTO entitlement_sources VALUES ($1,$2,$3,$4,'active',now()-interval '1 day',now()+interval '1 day')`,[id,user,club,business]);
    await db.query(`UPDATE entitlements SET meta=$1 WHERE product_id=$2`,[{source_rule_id:rule,business_tariff_id:business,source_access_kind:'entitlement_source',source_entitlement_source_id:id},course]);
    assert.deepEqual(await canRead(db),allowed);
    await db.exec("UPDATE entitlement_sources SET status='revoked'");
    assert.deepEqual(await canRead(db),denied);
  }finally{await db.close();}
});

test('history alone and an unconditional reading of the prior-purchase rule cannot grant the course',async()=>{
  const db=await fixture();try{
    await db.query('DELETE FROM entitlements WHERE product_id=$1',[course]);
    assert.deepEqual(await canRead(db),denied);
  }finally{await db.close();}
});

test('manual access survives, NULL Club expiry is not a perpetual Business bonus, cross-user RPC fails closed',async()=>{
  const db=await fixture();try{
    await db.exec('UPDATE subscriptions_v2 SET access_end_at=null');
    assert.deepEqual(await canRead(db),denied);
    await db.query("UPDATE entitlements SET meta='{}',expires_at=null WHERE product_id=$1",[course]);
    assert.deepEqual(await canRead(db),allowed);
    const r=await db.query('SELECT historical_business_source_is_current($1,$2,$3,null) ok',
      ['00000000-0000-4000-8000-000000000011',course,{}]);
    assert.equal(r.rows[0].ok,false);
  }finally{await db.close();}
});
