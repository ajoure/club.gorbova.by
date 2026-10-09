import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261009071000_site_questionnaire_bonus_channel.sql',import.meta.url),'utf8');
const legacyMigration = await readFile(new URL('../../supabase/migrations/20261009080000_cb21_legacy_questionnaire_repair.sql',import.meta.url),'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function legacyFixture() {
  const {db}=await fixture();
  await db.exec(`ALTER TABLE auth.users ADD COLUMN email text;
    UPDATE auth.users SET email='owner@example.test';
    ALTER TABLE site_form_submissions ADD COLUMN source text, ADD COLUMN created_at timestamptz,
      ADD COLUMN order_id uuid, ADD COLUMN form_data jsonb, ADD COLUMN field_mapping jsonb;
    CREATE TABLE products_v2(id uuid PRIMARY KEY,is_active boolean);
    CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,is_active boolean);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY,profile_id uuid,user_id uuid,status text,is_deleted boolean,
      base_price numeric,final_price numeric,paid_amount numeric,product_id uuid,tariff_id uuid);
    ALTER TABLE orders_v2 ADD COLUMN pipeline_id uuid, ADD COLUMN pipeline_stage_id uuid;
    CREATE TABLE crm_pipeline_automation_rules(pipeline_id uuid,stage_id uuid,status text,trigger_type text);
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,order_id uuid);`);
  const page='c8c5c19a-a10d-4f6b-8049-449f37230ed0',block='7f144dcc-1a71-4225-8399-efd4d91502cd';
  const bot='1a560e98-574e-4fd9-82ab-4b7bbdc300b4',product='0c98e21a-5300-4cfb-ac82-51c2d6184650',tariff='1a7bf501-c654-46d3-8665-1febd7eb59eb';
  const maps=['email','full_name','instagram_url','phone','telegram_username'];
  const fields=Array.from({length:15},(_,i)=>({label:`Field ${i}`,type:i===0?'email':'text',mapping:maps[i]||'none',required:true}));
  const data=Object.fromEntries(fields.map((f,i)=>[f.label,i===0?' Owner@Example.Test ':'answer']));
  const mapping=Object.fromEntries(fields.slice(0,5).map(f=>[f.label,f.mapping]));
  await db.query("INSERT INTO site_pages VALUES($1,'published',$2)",[page,JSON.stringify([{id:block,type:'form',content:{fields}}])]);
  await db.query("INSERT INTO telegram_bots VALUES($1,'active',true)",[bot]);
  await db.query('INSERT INTO products_v2 VALUES($1,true)',[product]);
  await db.query('INSERT INTO tariffs VALUES($1,$2,true)',[tariff,product]);
  await db.query('INSERT INTO orders_v2 VALUES($1,$2,NULL,\'draft\',false,0,0,0,NULL,NULL,$3,$4)',[id(20),id(2),id(40),id(41)]);
  await db.query('INSERT INTO site_questionnaire_bonus_channels(page_id,block_id,bot_id,channel_id,is_enabled) VALUES($1,$2,$3,-1002091043395,true)',[page,block,bot]);
  for(const n of [21,22]) await db.query(`INSERT INTO site_form_submissions
    (id,profile_id,page_id,status,metadata,source,created_at,order_id,form_data,field_mapping)
    VALUES($1,$2,$3,'processed',$4,'site_form_auth','2026-10-08 12:00:00+00',$5,$6,$7)`,
    [id(n),id(2),page,JSON.stringify({auth_mode:true,user_id:id(1)}),id(20),JSON.stringify(data),JSON.stringify(mapping)]);
  await db.exec(legacyMigration);
  return db;
}

test('bounded legacy repair preserves dates, answers, identity and money, supports dry-run and replay',async()=>{
  const db=await legacyFixture();try{
    const original=(await db.query('SELECT id,created_at,form_data,source FROM site_form_submissions ORDER BY id')).rows;
    assert.deepEqual((await db.query('SELECT repair_cb21_legacy_questionnaires(false) result')).rows[0].result,
      {dry_run:true,histories:2,orders:1});
    assert.deepEqual((await db.query('SELECT repair_cb21_legacy_questionnaires(true) result')).rows[0].result,
      {dry_run:false,histories:2,orders:1});
    assert.deepEqual((await db.query('SELECT id,created_at,form_data,source FROM site_form_submissions ORDER BY id')).rows,original);
    assert.equal((await db.query("SELECT count(*)::int n FROM site_form_submissions WHERE metadata ? 'questionnaire_first'")).rows[0].n,0);
    assert.deepEqual((await db.query('SELECT user_id,status,base_price,final_price,paid_amount FROM orders_v2')).rows[0],
      {user_id:null,status:'draft',base_price:'0',final_price:'0',paid_amount:'0'});
    assert.deepEqual((await db.query('SELECT repair_cb21_legacy_questionnaires(true) result')).rows[0].result,
      {dry_run:false,histories:0,orders:0});
    assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='site_questionnaire.legacy_repaired'")).rows[0].n,1);
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','repair_cb21_legacy_questionnaires(boolean)','EXECUTE') allowed")).rows[0].allowed,false);
  }finally{await db.close();}
});

test('legacy repair rejects wrong email, changed amounts and unexpected payments before any mutation',async()=>{
  const db=await legacyFixture();try{
    await db.query("UPDATE site_form_submissions SET form_data=jsonb_set(form_data,'{Field 0}','\"other@example.test\"') WHERE id=$1",[id(21)]);
    await assert.rejects(db.query('SELECT repair_cb21_legacy_questionnaires(true)'),/legacy_repair_submission_changed/);
    await db.query("UPDATE site_form_submissions SET form_data=jsonb_set(form_data,'{Field 0}','\"owner@example.test\"') WHERE id=$1",[id(21)]);
    await db.exec('UPDATE orders_v2 SET final_price=500');
    await assert.rejects(db.query('SELECT repair_cb21_legacy_questionnaires(true)'),/legacy_repair_order_changed/);
    await db.exec('UPDATE orders_v2 SET final_price=0');
    await db.query('INSERT INTO payments_v2 VALUES($1,$2)',[id(30),id(20)]);
    await assert.rejects(db.query('SELECT repair_cb21_legacy_questionnaires(true)'),/legacy_repair_order_changed/);
    assert.equal((await db.query("SELECT count(*)::int n FROM site_form_submissions WHERE metadata ? 'legacy_repair_verified'")).rows[0].n,0);
    assert.equal((await db.query('SELECT product_id FROM orders_v2')).rows[0].product_id,null);
  }finally{await db.close();}
});

test('unexpected order trigger effects roll back history and bonus changes together',async()=>{
  const db=await legacyFixture();try{
    await db.exec(`CREATE FUNCTION fixture_bad_order_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.final_price:=100; RETURN NEW; END; $$;
      CREATE TRIGGER fixture_bad_order BEFORE UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION fixture_bad_order_trigger();`);
    await assert.rejects(db.query('SELECT repair_cb21_legacy_questionnaires(true)'),/legacy_repair_order_side_effect/);
    assert.equal((await db.query('SELECT final_price,product_id FROM orders_v2')).rows[0].final_price,'0');
    assert.equal((await db.query("SELECT count(*)::int n FROM site_form_submissions WHERE metadata ? 'legacy_repair_verified'")).rows[0].n,0);
  }finally{await db.close();}
});

test('new CRM automation blocks legacy repair rather than enqueueing unexpected messages',async()=>{
  const db=await legacyFixture();try{
    await db.query("INSERT INTO crm_pipeline_automation_rules VALUES($1,$2,'active','deal_field_changed')",[id(40),id(41)]);
    await assert.rejects(db.query('SELECT repair_cb21_legacy_questionnaires(true)'),/legacy_repair_automation_changed/);
    assert.equal((await db.query('SELECT product_id FROM orders_v2')).rows[0].product_id,null);
  }finally{await db.close();}
});
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
    CREATE FUNCTION has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
    CREATE TABLE site_pages(id uuid PRIMARY KEY,status text,blocks jsonb);
    CREATE TABLE telegram_bots(id uuid PRIMARY KEY,status text,is_primary boolean);
    CREATE TABLE telegram_clubs(id uuid PRIMARY KEY,bot_id uuid,chat_id bigint,channel_id bigint,channel_grant_enabled boolean,channel_invite_link text);
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,status text,is_archived boolean,merged_to_profile_id uuid,
      telegram_user_id bigint,telegram_link_bot_id uuid,telegram_link_status text,telegram_linked_at timestamptz);
    CREATE TABLE site_form_submissions(id uuid PRIMARY KEY,profile_id uuid,page_id uuid,status text,metadata jsonb);
    CREATE TABLE telegram_access_audit(user_id uuid,telegram_user_id bigint,event_type text,meta jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE audit_logs(action text,actor_type text,actor_label text,entity_type text,entity_id text,meta jsonb);
    CREATE TABLE commercial_access(user_id uuid,expires_at timestamptz);
    GRANT USAGE ON SCHEMA public,auth TO service_role;`);
  await db.exec(migration);
  await db.query('INSERT INTO auth.users VALUES($1,now(),null,null)',[id(1)]);
  await db.query("INSERT INTO site_pages VALUES($1,'published','[]')",[id(3)]);
  await db.query("INSERT INTO telegram_bots VALUES($1,'active',true)",[id(4)]);
  await db.query("INSERT INTO profiles VALUES($1,$2,'active',false,null,123,$3,'active',now())",[id(2),id(1),id(4)]);
  await db.query('INSERT INTO site_questionnaire_bonus_channels(page_id,block_id,bot_id,channel_id,is_enabled) VALUES($1,$2,$3,-100123,true)',[id(3),id(5),id(4)]);
  const submit = (n=6,status='processed',user=id(1)) => db.query('INSERT INTO site_form_submissions VALUES($1,$2,$3,$4,$5)',
    [id(n),id(2),id(3),status,JSON.stringify({questionnaire_first:true,block_id:id(5),user_id:user})]);
  const resolve = () => db.query('SELECT resolve_site_questionnaire_bonus_join($1,-100123,123) result',[id(4)]).then(r=>r.rows[0].result);
  return {db,submit,resolve};
}

test('shared free channel accepts people without an account or questionnaire and survives paid expiry',async()=>{
  const {db}=await fixture();try{
    const resolve=user=>db.query('SELECT resolve_site_questionnaire_bonus_join($1,-100123,$2) result',[id(4),user]).then(r=>r.rows[0].result);
    assert.equal((await resolve(999)).eligible,true,'a forwarded shared invitation is allowed');
    await db.query("INSERT INTO commercial_access VALUES($1,now()-interval '1 year')",[id(1)]);
    await db.exec("UPDATE site_pages SET status='archived',blocks='[]'");
    await db.exec("UPDATE profiles SET telegram_link_status='unlinked'");
    assert.equal((await resolve(999)).eligible,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM commercial_access')).rows[0].n,1);
    assert.equal((await db.query("SELECT to_regclass('site_questionnaire_bonus_invites') relation")).rows[0].relation,null);
  }finally{await db.close();}
});

test('paused free routes remain reserved and commercial collisions block approval',async()=>{
  const {db,resolve}=await fixture();try{
    await db.query('INSERT INTO telegram_clubs VALUES($1,$2,null,-100123,false,null)',[id(9),id(4)]);
    assert.equal((await resolve()).eligible,false);
    await db.exec('UPDATE telegram_clubs SET channel_id=NULL');
    assert.equal((await resolve()).eligible,true);
    await db.exec('UPDATE site_questionnaire_bonus_channels SET is_enabled=false');
    assert.equal((await resolve()).configured,true);
    assert.equal((await resolve()).eligible,false);
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','resolve_site_questionnaire_bonus_join(uuid,bigint,bigint)','EXECUTE') allowed")).rows[0].allowed,false);
  }finally{await db.close();}
});

test('managed cutover changes exactly one mapping, preserves the paid chat and is idempotent',async()=>{
  const {db}=await fixture();try{
    const bot='1a560e98-574e-4fd9-82ab-4b7bbdc300b4';
    const page='c8c5c19a-a10d-4f6b-8049-449f37230ed0';
    const club='4f8f9d8f-07ce-4898-8012-39f1035c1456';
    await db.query("INSERT INTO telegram_bots VALUES($1,'active',true)",[bot]);
    await db.query("INSERT INTO site_pages VALUES($1,'published','[]')",[page]);
    await db.query('INSERT INTO telegram_clubs VALUES($1,$2,-100999,-1002091043395,false,$3)',[club,bot,'fixture-link']);
    await assert.rejects(db.query('SELECT configure_cb21_bonus_channel(2)'),/bonus_channel_expected_count_required/);
    assert.equal((await db.query('SELECT channel_id FROM telegram_clubs WHERE id=$1',[club])).rows[0].channel_id,-1002091043395);
    assert.deepEqual((await db.query('SELECT configure_cb21_bonus_channel(1) result')).rows[0].result,{changed_clubs:1,changed_routes:1,replayed:false});
    assert.deepEqual((await db.query('SELECT chat_id,channel_id,channel_invite_link FROM telegram_clubs WHERE id=$1',[club])).rows[0],{chat_id:-100999,channel_id:null,channel_invite_link:null});
    assert.deepEqual((await db.query('SELECT configure_cb21_bonus_channel(1) result')).rows[0].result,{changed_clubs:0,changed_routes:0,replayed:true});
  }finally{await db.close();}
});
