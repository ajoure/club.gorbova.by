import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261009055330_cb21_questionnaire_atomic_submission.sql', import.meta.url), 'utf8');
const notificationsMigration = await readFile(new URL('../../supabase/migrations/20261009062003_site_questionnaire_notifications.sql', import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const fields = [
  { label:'Email',type:'email',mapping:'email',required:true },
  { label:'ФИО',type:'text',mapping:'full_name',required:true },
  { label:'Телефон',type:'phone',mapping:'phone',required:true },
  { label:'Комментарий',type:'textarea',required:true },
];
const answers = [
  { ...fields[0],value:'buyer@example.invalid' }, { ...fields[1],value:'Test Buyer' },
  { ...fields[2],value:'+375 29 111 22 33' }, { ...fields[3],mapping:'none',value:'My complete answer' },
];
let exportedFixtureVerified = false;
async function fixture() {
  const db = new PGlite();
  const schemaSQL = `CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz);
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid UNIQUE,status text,is_archived boolean,merged_to_profile_id uuid,full_name text,phone text);
    CREATE TABLE site_pages(id uuid PRIMARY KEY,workspace_id uuid,status text,blocks jsonb);
    CREATE TABLE products_v2(id uuid PRIMARY KEY,is_active boolean);
    CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,is_active boolean);
    CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid,is_active boolean,is_primary boolean,base_price numeric,final_price numeric);
    CREATE TABLE crm_pipelines(id uuid PRIMARY KEY);
    CREATE TABLE crm_pipeline_stages(id uuid PRIMARY KEY,pipeline_id uuid);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text UNIQUE NOT NULL,profile_id uuid,user_id uuid,
      product_id uuid,tariff_id uuid,offer_id uuid,base_price numeric NOT NULL,final_price numeric NOT NULL,currency text,status text,
      reconcile_source text,pipeline_id uuid,pipeline_stage_id uuid,customer_email text,customer_phone text,meta jsonb,
      is_deleted boolean NOT NULL DEFAULT false,created_at timestamptz DEFAULT now());
    CREATE FUNCTION generate_order_number() RETURNS text LANGUAGE sql AS $$SELECT 'FORM-' || gen_random_uuid()::text$$;
    CREATE TABLE site_form_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_id text UNIQUE NOT NULL,
      workspace_id uuid NOT NULL,page_id uuid NOT NULL,profile_id uuid,order_id uuid,form_data jsonb NOT NULL,field_mapping jsonb NOT NULL,
      status text NOT NULL,source text NOT NULL,metadata jsonb NOT NULL);
    CREATE FUNCTION test_submission_public_id() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.public_id='SUB-'||NEW.id::text; RETURN NEW; END$$;
    CREATE TRIGGER set_site_form_submissions_public_id BEFORE INSERT ON site_form_submissions FOR EACH ROW EXECUTE FUNCTION test_submission_public_id();
    CREATE TABLE consent_logs(user_id uuid,email text,consent_type text,policy_version text,granted boolean,source text,meta jsonb);
    CREATE TABLE domain_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text NOT NULL,source text NOT NULL,entity_id uuid NOT NULL,payload jsonb NOT NULL);
    CREATE TABLE domain_executions(event_id uuid NOT NULL REFERENCES domain_events(id),step text,status text CHECK(status IN ('pending','success','failed','retrying')),attempt int);
    CREATE TABLE audit_logs(action text NOT NULL,actor_type text,actor_user_id uuid,actor_label text,entity_type text,entity_id text,meta jsonb);
    CREATE TABLE commercial_access(user_id uuid,product_id uuid);`;
  await db.exec(schemaSQL);
  const content = { auth_mode:true,questionnaire_first:true,fields,product_binding_enabled:true,product_id:id(4),tariff_id:id(5),deal_creation_enabled:true,pipeline_id:id(6),pipeline_stage_id:id(7) };
  await db.query('INSERT INTO auth.users VALUES($1,$2,now(),null,null)',[id(1),'buyer@example.invalid']);
  await db.query("INSERT INTO profiles VALUES($1,$2,'active',false,null,'Existing name','Existing phone')",[id(2),id(1)]);
  await db.query("INSERT INTO site_pages VALUES($1,$2,'published',$3)",[id(3),id(30),JSON.stringify([{id:id(8),type:'form',content}])]);
  await db.query('INSERT INTO products_v2 VALUES($1,true)',[id(4)]);
  await db.query('INSERT INTO tariffs VALUES($1,$2,true)',[id(5),id(4)]);
  await db.query('INSERT INTO crm_pipelines VALUES($1)',[id(6)]);
  await db.query('INSERT INTO crm_pipeline_stages VALUES($1,$2)',[id(7),id(6)]);
  if (process.env.SITE_QUESTIONNAIRE_SQL_FIXTURE_PATH) {
    assert.equal(process.env.SITE_QUESTIONNAIRE_SQL_FIXTURE_PATH, '/tmp/site-questionnaire-fixture.sql');
    const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
    const safeRoles = schemaSQL.replace('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;',
      () => "DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END$$;");
    const seed = `INSERT INTO auth.users VALUES(${quote(id(1))},'buyer@example.invalid',now(),null,null);
      INSERT INTO profiles VALUES(${quote(id(2))},${quote(id(1))},'active',false,null,'Existing name','Existing phone');
      INSERT INTO site_pages VALUES(${quote(id(3))},${quote(id(30))},'published',${quote(JSON.stringify([{id:id(8),type:'form',content}]))});
      INSERT INTO products_v2 VALUES(${quote(id(4))},true);
      INSERT INTO tariffs VALUES(${quote(id(5))},${quote(id(4))},true);
      INSERT INTO crm_pipelines VALUES(${quote(id(6))});
      INSERT INTO crm_pipeline_stages VALUES(${quote(id(7))},${quote(id(6))});`;
    const exportedSQL = safeRoles + seed + migration;
    if (!exportedFixtureVerified) {
      const exportedDatabase = new PGlite();
      try { await exportedDatabase.exec(exportedSQL); } finally { await exportedDatabase.close(); }
      exportedFixtureVerified = true;
    }
    await writeFile(process.env.SITE_QUESTIONNAIRE_SQL_FIXTURE_PATH, exportedSQL);
  }
  await db.exec(migration);
  const submit = (key=id(10),payload=answers,source='reels') => db.query(
    'SELECT submit_site_questionnaire($1,$2,$3,$4,$5,$6,$7) result',
    [id(3),id(8),id(1),key,JSON.stringify(payload),source,'v2026-04-10'],
  ).then(r=>r.rows[0].result);
  return {db,submit};
}
async function counts(db) {
  return (await db.query(`SELECT (SELECT count(*)::int FROM site_form_submissions) submissions,
    (SELECT count(*)::int FROM orders_v2) orders,(SELECT count(*)::int FROM domain_events) events,
    (SELECT count(*)::int FROM consent_logs) consents,(SELECT count(*)::int FROM audit_logs) audits,
    (SELECT count(*)::int FROM commercial_access) access`)).rows[0];
}
async function notifications(db) {
  await db.exec(`ALTER TABLE profiles ADD COLUMN telegram_user_id bigint;
    CREATE TABLE broadcast_templates(id uuid PRIMARY KEY,channel text,channels text[],trigger_kind text,status text,approval_status text,metadata jsonb,
      CONSTRAINT broadcast_templates_trigger_kind_check CHECK(trigger_kind IN ('manual','lesson_event','scheduled_condition')));
    CREATE TABLE broadcast_automation_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid,user_id uuid,event_key text,status text DEFAULT 'pending',
      UNIQUE(template_id,user_id,event_key));`);
  await db.exec(notificationsMigration);
  await db.query(`INSERT INTO broadcast_templates VALUES($1,'email',ARRAY['email','telegram'],'site_form_event','recurring','approved',$2)`,
    [id(60),JSON.stringify({site_form_condition:{page_id:id(3),block_id:id(8),event:'submitted'}})]);
}

test('atomic questionnaire creates complete history and draft deal; retries never duplicate or grant course access',async()=>{
  const {db,submit}=await fixture(); try {
    const first=await submit(); const replay=await submit();
    assert.equal(first.success,true); assert.equal(first.replayed,false);
    assert.equal(replay.replayed,true); assert.equal(replay.submission_id,first.submission_id);
    assert.deepEqual(await counts(db),{submissions:1,orders:1,events:1,consents:1,audits:1,access:0});
    const row=(await db.query('SELECT * FROM site_form_submissions')).rows[0];
    assert.equal(row.form_data['Комментарий'],'My complete answer');
    assert.equal(row.field_mapping['ФИО'],'full_name');
    assert.equal(row.metadata.product_id,id(4)); assert.equal(row.metadata.tariff_id,id(5));
    assert.equal(row.metadata.source_code,'reels'); assert.equal(row.metadata.utm_source,'instagram');
    const order=(await db.query('SELECT * FROM orders_v2')).rows[0];
    assert.equal(order.status,'draft'); assert.equal(order.final_price,'0');
    assert.deepEqual((await db.query('SELECT full_name,phone FROM profiles')).rows[0],{full_name:'Existing name',phone:'Existing phone'});
    const next=await submit(id(11)); assert.equal(next.order_id,first.order_id);
    assert.notEqual(next.submission_id,first.submission_id);
    assert.deepEqual(await counts(db),{submissions:2,orders:1,events:2,consents:2,audits:2,access:0});
    await assert.rejects(submit(id(10),[...answers.slice(0,3),{...answers[3],value:'Changed after success'}]),/questionnaire_retry_conflict/);
    assert.equal((await counts(db)).submissions,2);
  } finally {await db.close()}
});
test('a late event failure rolls back the deal, history and consent together',async()=>{
  const {db,submit}=await fixture(); try {
    await db.exec('UPDATE profiles SET full_name=null,phone=null');
    await db.exec("ALTER TABLE domain_events ADD CONSTRAINT test_event_failure CHECK(event_type <> 'site_questionnaire_submitted')");
    await assert.rejects(submit(),/test_event_failure/);
    assert.deepEqual(await counts(db),{submissions:0,orders:0,events:0,consents:0,audits:0,access:0});
    assert.deepEqual((await db.query('SELECT full_name,phone FROM profiles')).rows[0],{full_name:null,phone:null});
    await db.exec('ALTER TABLE domain_events DROP CONSTRAINT test_event_failure');
    assert.equal((await submit()).success,true);
  }finally{await db.close()}
});
test('existing paid purchases, identity and commercial access are preserved exactly',async()=>{
  const {db,submit}=await fixture();try{
    await db.query(`INSERT INTO orders_v2(id,order_number,profile_id,user_id,product_id,tariff_id,base_price,final_price,currency,status,reconcile_source,meta)
      VALUES($1,'PAID-FIXTURE',$2,$3,$4,$5,100,100,'BYN','paid','checkout','{"original_purchase":true}')`,[id(50),id(2),id(1),id(4),id(5)]);
    await db.query('INSERT INTO commercial_access VALUES($1,$2)',[id(1),id(4)]);
    const purchase=(await db.query('SELECT * FROM orders_v2 WHERE id=$1',[id(50)])).rows;
    const account=(await db.query('SELECT * FROM auth.users')).rows;
    const access=(await db.query('SELECT * FROM commercial_access')).rows;
    const result=await submit();assert.notEqual(result.order_id,id(50));
    assert.deepEqual((await db.query('SELECT * FROM orders_v2 WHERE id=$1',[id(50)])).rows,purchase);
    assert.deepEqual((await db.query('SELECT * FROM auth.users')).rows,account);
    assert.deepEqual((await db.query('SELECT * FROM commercial_access')).rows,access);
  }finally{await db.close()}
});
test('published config and verified identity reject field injection, foreign email, blocked contacts and changed routing',async()=>{
  const {db,submit}=await fixture(); try {
    await assert.rejects(submit(id(10),[{...answers[0],value:'other@example.invalid'},...answers.slice(1)]),/questionnaire_email_mismatch/);
    await assert.rejects(submit(id(10),[answers[0],{...answers[1],mapping:'email'},...answers.slice(2)]),/questionnaire_fields_invalid/);
    await db.exec("UPDATE profiles SET status='blocked'"); await assert.rejects(submit(),/questionnaire_profile_unavailable/);
    await db.exec("UPDATE profiles SET status='active'; UPDATE auth.users SET banned_until=now()+interval '1 day'");
    await assert.rejects(submit(),/questionnaire_identity_invalid/);
    await db.exec("UPDATE auth.users SET banned_until=null; UPDATE site_pages SET status='draft'");
    await assert.rejects(submit(),/questionnaire_page_unavailable/);
    await db.exec("UPDATE site_pages SET status='published'; DELETE FROM crm_pipeline_stages");
    await assert.rejects(submit(),/questionnaire_pipeline_unavailable/);
    assert.deepEqual(await counts(db),{submissions:0,orders:0,events:0,consents:0,audits:0,access:0});
  }finally{await db.close()}
});
test('missing contact fields are filled without rewriting identity, and arbitrary source text is not stored',async()=>{
  const {db,submit}=await fixture(); try {
    await db.exec('UPDATE profiles SET full_name=null,phone=null');
    await submit(id(10),answers,'buyer-secret@example.invalid');
    assert.deepEqual((await db.query('SELECT full_name,phone FROM profiles')).rows[0],{full_name:'Test Buyer',phone:'+375291112233'});
    const metadata=(await db.query('SELECT metadata FROM site_form_submissions')).rows[0].metadata;
    assert.equal(metadata.source_code,undefined);
    assert.equal(JSON.stringify(metadata).includes('buyer-secret'),false);
    const grants=(await db.query("SELECT has_function_privilege('anon','submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE') anon, has_function_privilege('authenticated','submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE') authenticated,has_function_privilege('service_role','submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text)','EXECUTE') service")).rows[0];
    assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
  }finally{await db.close()}
});
test('questionnaire notifications wait for Telegram linking and are unique independently for each channel',async()=>{
  const {db,submit}=await fixture();try{
    await notifications(db);await submit();
    assert.deepEqual((await db.query('SELECT channel FROM broadcast_automation_deliveries ORDER BY channel')).rows,[{channel:'email'}]);
    await db.exec('UPDATE profiles SET telegram_user_id=123456');
    assert.deepEqual((await db.query('SELECT channel FROM broadcast_automation_deliveries ORDER BY channel')).rows,[{channel:'email'},{channel:'telegram'}]);
    await submit();await submit(id(11));
    await db.exec('UPDATE profiles SET telegram_user_id=654321');
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,2);
  }finally{await db.close()}
});
test('unapproved or unrelated form templates cannot send, and blocked profiles do not queue a Telegram notification',async()=>{
  const {db,submit}=await fixture();try{
    await notifications(db);
    await db.exec("UPDATE broadcast_templates SET approval_status='pending_approval'");
    await submit();assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,0);
    await db.query("UPDATE broadcast_templates SET approval_status='approved',metadata=$1",[JSON.stringify({site_form_condition:{page_id:id(99),block_id:id(8),event:'submitted'}})]);
    await submit(id(11));assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,0);
    await db.query('UPDATE broadcast_templates SET metadata=$1',[JSON.stringify({site_form_condition:{page_id:id(3),block_id:id(8),event:'submitted'}})]);
    await db.exec("UPDATE profiles SET status='blocked',telegram_user_id=123456");
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,0);
  }finally{await db.close()}
});
