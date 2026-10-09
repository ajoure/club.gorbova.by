import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261009071000_site_questionnaire_bonus_channel.sql',import.meta.url),'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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

test('free bonus right is permanent, idempotent and independent of club expiry and page archival',async()=>{
  const {db,submit,resolve}=await fixture();try{
    await submit(); await submit(7);
    assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_bonus_channel_grants')).rows[0].n,1);
    assert.equal((await resolve()).eligible,false,'a genuine bot linking event is required');
    await db.query("INSERT INTO telegram_access_audit VALUES($1,123,'telegram_link_confirmed',$2,now())",[id(1),JSON.stringify({bot_id:id(4)})]);
    assert.equal((await resolve()).eligible,true);
    await db.query("INSERT INTO commercial_access VALUES($1,now()-interval '1 year')",[id(1)]);
    await db.exec("UPDATE site_pages SET status='archived',blocks='[]'");
    assert.equal((await resolve()).eligible,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM commercial_access')).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_bonus_channel_grants')).rows[0].n,1);
  }finally{await db.close();}
});

test('wrong identity, incomplete forms and commercial channel collisions never grant bonus entry',async()=>{
  const {db,submit,resolve}=await fixture();try{
    await submit(6,'pending'); await submit(7,'processed',id(99));
    assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_bonus_channel_grants')).rows[0].n,0);
    await submit(8);
    await db.query("INSERT INTO telegram_access_audit VALUES($1,123,'telegram_link_confirmed',$2,now())",[id(1),JSON.stringify({bot_id:id(4)})]);
    await db.query('INSERT INTO telegram_clubs VALUES($1,$2,null,-100123,false,null)',[id(9),id(4)]);
    assert.equal((await resolve()).eligible,false);
    await db.exec('UPDATE telegram_clubs SET channel_id=NULL');
    assert.equal((await resolve()).eligible,true);
    await db.exec("UPDATE profiles SET telegram_link_status='unlinked'");
    assert.equal((await resolve()).eligible,false);
    assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_bonus_channel_grants')).rows[0].n,1,'unlinking preserves the permanent right');
    await db.exec('UPDATE site_questionnaire_bonus_channels SET is_enabled=false');
    assert.equal((await resolve()).configured,true,'paused bonus routes remain reserved');
  }finally{await db.close();}
});

test('ordinary users cannot forge bonus rights or invoke the privileged resolver',async()=>{
  const {db,submit}=await fixture();try{
    await submit();
    const rights=(await db.query("SELECT has_table_privilege('authenticated','site_questionnaire_bonus_channel_grants','INSERT') can_insert,has_function_privilege('authenticated','record_site_questionnaire_bonus_channel_grant(uuid)','EXECUTE') can_grant,has_function_privilege('authenticated','resolve_site_questionnaire_bonus_join(uuid,bigint,bigint)','EXECUTE') can_resolve")).rows[0];
    assert.deepEqual(rights,{can_insert:false,can_grant:false,can_resolve:false});
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query('SELECT record_site_questionnaire_bonus_channel_grant($1) n',[id(6)])).rows[0].n,0);
    await db.exec('RESET ROLE');
  }finally{await db.close();}
});

test('managed cutover changes exactly one mapping and rejects an unexpected grant count atomically',async()=>{
  const {db}=await fixture();try{
    const bot='1a560e98-574e-4fd9-82ab-4b7bbdc300b4';
    const page='c8c5c19a-a10d-4f6b-8049-449f37230ed0';
    const club='4f8f9d8f-07ce-4898-8012-39f1035c1456';
    await db.query("INSERT INTO telegram_bots VALUES($1,'active',true)",[bot]);
    await db.query("INSERT INTO site_pages VALUES($1,'published','[]')",[page]);
    await db.query('INSERT INTO telegram_clubs VALUES($1,$2,-100999,-1002091043395,false,$3)',[club,bot,'private-fixture-link']);
    await assert.rejects(db.query('SELECT configure_cb21_bonus_channel(1)'),/bonus_channel_grant_rowcount/);
    assert.equal((await db.query('SELECT channel_id FROM telegram_clubs WHERE id=$1',[club])).rows[0].channel_id,-1002091043395);
    assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_bonus_channels WHERE page_id=$1',[page])).rows[0].n,0);
    assert.deepEqual((await db.query('SELECT configure_cb21_bonus_channel(0) result')).rows[0].result,{changed_clubs:1,changed_routes:1,granted_users:0,replayed:false});
    assert.deepEqual((await db.query('SELECT chat_id,channel_id,channel_invite_link FROM telegram_clubs WHERE id=$1',[club])).rows[0],{chat_id:-100999,channel_id:null,channel_invite_link:null});
    assert.deepEqual((await db.query('SELECT configure_cb21_bonus_channel(0) result')).rows[0].result,{changed_clubs:0,changed_routes:0,replayed:true});
    assert.equal((await db.query('SELECT count(*)::int n FROM commercial_access')).rows[0].n,0);
  }finally{await db.close();}
});
