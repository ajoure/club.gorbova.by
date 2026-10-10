import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261009055330_cb21_questionnaire_atomic_submission.sql', import.meta.url), 'utf8');
const notificationsMigration = await readFile(new URL('../../supabase/migrations/20261009062003_site_questionnaire_notifications.sql', import.meta.url), 'utf8');
const remindersMigration = await readFile(new URL('../../supabase/migrations/20261009064000_site_questionnaire_incomplete_reminders.sql', import.meta.url), 'utf8');
const journeysMigration = await readFile(new URL('../../supabase/migrations/20261009083000_site_questionnaire_journeys.sql',import.meta.url),'utf8');
const submissionDelayMigration = await readFile(new URL('../../supabase/migrations/20261009072000_site_questionnaire_submission_delay.sql', import.meta.url), 'utf8');
const salesIdentityMigration = await readFile(new URL('../../supabase/migrations/20261009120000_questionnaire_sales_identity.sql', import.meta.url), 'utf8');
const offerPriceMigration = await readFile(new URL('../../supabase/migrations/20261010140309_cb21_questionnaire_offer_price.sql', import.meta.url), 'utf8');
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
async function fixture({ applyOfferPriceFix = true } = {}) {
  const db = new PGlite();
  const schemaSQL = `CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,banned_until timestamptz,deleted_at timestamptz,raw_app_meta_data jsonb DEFAULT '{}');
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid UNIQUE,status text,is_archived boolean,merged_to_profile_id uuid,full_name text,phone text,telegram_user_id bigint,telegram_link_bot_id uuid,telegram_link_status text,telegram_linked_at timestamptz);
    CREATE TABLE telegram_bots(id uuid PRIMARY KEY,status text,is_primary boolean);
    CREATE TABLE telegram_access_audit(user_id uuid,telegram_user_id bigint,event_type text,meta jsonb,created_at timestamptz DEFAULT now());
    CREATE TABLE site_pages(id uuid PRIMARY KEY,workspace_id uuid,status text,blocks jsonb);
    CREATE TABLE products_v2(id uuid PRIMARY KEY,is_active boolean);
    CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,is_active boolean);
    CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid,is_active boolean,is_primary boolean,amount numeric);
    CREATE TABLE crm_pipelines(id uuid PRIMARY KEY);
    CREATE TABLE crm_pipeline_stages(id uuid PRIMARY KEY,pipeline_id uuid);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text UNIQUE NOT NULL,profile_id uuid,user_id uuid,
      product_id uuid,tariff_id uuid,offer_id uuid,base_price numeric NOT NULL,final_price numeric NOT NULL,currency text,status text,
      reconcile_source text,pipeline_id uuid,pipeline_stage_id uuid,customer_email text,customer_phone text,meta jsonb,
      is_deleted boolean NOT NULL DEFAULT false,created_at timestamptz DEFAULT now());
    CREATE FUNCTION generate_order_number() RETURNS text LANGUAGE sql AS $$SELECT 'FORM-' || gen_random_uuid()::text$$;
    CREATE TABLE site_form_submissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_id text UNIQUE NOT NULL,
      workspace_id uuid NOT NULL,page_id uuid NOT NULL,profile_id uuid,order_id uuid,form_data jsonb NOT NULL,field_mapping jsonb NOT NULL,
      status text NOT NULL,source text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz DEFAULT now());
    CREATE FUNCTION test_submission_public_id() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.public_id='SUB-'||NEW.id::text; RETURN NEW; END$$;
    CREATE TRIGGER set_site_form_submissions_public_id BEFORE INSERT ON site_form_submissions FOR EACH ROW EXECUTE FUNCTION test_submission_public_id();
    CREATE TABLE consent_logs(user_id uuid,email text,consent_type text,policy_version text,granted boolean,source text,meta jsonb);
    CREATE TABLE domain_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_type text NOT NULL,source text NOT NULL,entity_id uuid NOT NULL,payload jsonb NOT NULL);
    CREATE TABLE domain_executions(event_id uuid NOT NULL REFERENCES domain_events(id),step text,status text CHECK(status IN ('pending','success','failed','retrying')),attempt int);
    CREATE TABLE audit_logs(action text NOT NULL,actor_type text,actor_user_id uuid,actor_label text,entity_type text,entity_id text,meta jsonb);
    CREATE TABLE commercial_access(user_id uuid,product_id uuid);`;
  await db.exec(schemaSQL);
  const content = { auth_mode:true,questionnaire_first:true,fields,product_binding_enabled:true,product_id:id(4),tariff_id:id(5),deal_creation_enabled:true,pipeline_id:id(6),pipeline_stage_id:id(7) };
  await db.query('INSERT INTO auth.users(id,email,email_confirmed_at,banned_until,deleted_at) VALUES($1,$2,now(),null,null)',[id(1),'buyer@example.invalid']);
  await db.query("INSERT INTO profiles VALUES($1,$2,'active',false,null,'Existing name','Existing phone',123,$3,'active',now())",[id(2),id(1),id(90)]);
  await db.query("INSERT INTO telegram_bots VALUES($1,'active',true)",[id(90)]);
  await db.query("INSERT INTO telegram_access_audit VALUES($1,123,'telegram_link_confirmed',$2,now())",[id(1),JSON.stringify({bot_id:id(90)})]);
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
    const seed = `INSERT INTO auth.users(id,email,email_confirmed_at,banned_until,deleted_at) VALUES(${quote(id(1))},'buyer@example.invalid',now(),null,null);
      INSERT INTO profiles VALUES(${quote(id(2))},${quote(id(1))},'active',false,null,'Existing name','Existing phone',123,${quote(id(90))},'active',now());
      INSERT INTO telegram_bots VALUES(${quote(id(90))},'active',true);
      INSERT INTO telegram_access_audit VALUES(${quote(id(1))},123,'telegram_link_confirmed',${quote(JSON.stringify({bot_id:id(90)}))},now());
      INSERT INTO site_pages VALUES(${quote(id(3))},${quote(id(30))},'published',${quote(JSON.stringify([{id:id(8),type:'form',content}]))});
      INSERT INTO products_v2 VALUES(${quote(id(4))},true);
      INSERT INTO tariffs VALUES(${quote(id(5))},${quote(id(4))},true);
      INSERT INTO crm_pipelines VALUES(${quote(id(6))});
      INSERT INTO crm_pipeline_stages VALUES(${quote(id(7))},${quote(id(6))});`;
    const exportedSQL = safeRoles + seed + migration + offerPriceMigration;
    if (!exportedFixtureVerified) {
      const exportedDatabase = new PGlite();
      try { await exportedDatabase.exec(exportedSQL); } finally { await exportedDatabase.close(); }
      exportedFixtureVerified = true;
    }
    await writeFile(process.env.SITE_QUESTIONNAIRE_SQL_FIXTURE_PATH, exportedSQL);
  }
  await db.exec(migration);
  if (applyOfferPriceFix) await db.exec(offerPriceMigration);
  const submit = (key=id(10),payload=answers,source='reels',journey=null,journeyHash=null) => db.query(
    'SELECT submit_site_questionnaire($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
    [id(3),id(8),id(1),key,JSON.stringify(payload),source,'v2026-04-10',journey,journeyHash],
  ).then(r=>r.rows[0].result);
  return {db,submit};
}
async function counts(db) {
  return (await db.query(`SELECT (SELECT count(*)::int FROM site_form_submissions) submissions,
    (SELECT count(*)::int FROM orders_v2) orders,(SELECT count(*)::int FROM domain_events) events,
    (SELECT count(*)::int FROM consent_logs) consents,(SELECT count(*)::int FROM audit_logs) audits,
    (SELECT count(*)::int FROM commercial_access) access`)).rows[0];
}
test('sales identity requires this saved questionnaire and the genuinely linked Telegram recipient', async()=>{
  const {db,submit}=await fixture();try {
    await db.exec(salesIdentityMigration);
    const eligible=async(page=id(3),block=id(8),user=id(1),telegram=123)=>(await db.query(
      'SELECT site_questionnaire_sales_identity($1,$2,$3,$4) eligible',[page,block,user,telegram])).rows[0].eligible;
    assert.equal(await eligible(),false);
    await submit();const before=await counts(db);
    assert.equal(await eligible(),true);
    for(const args of [[id(99),id(8),id(1),123],[id(3),id(99),id(1),123],[id(3),id(8),id(99),123],[id(3),id(8),id(1),999]]) {
      assert.equal(await eligible(...args),false);
    }
    assert.deepEqual(await counts(db),before,'identity reads create no orders, grants or messages');
    await db.exec('DELETE FROM telegram_access_audit');
    assert.equal(await eligible(),false,'a manually entered Telegram ID is not a support-bot connection');
  }finally{await db.close()}
});

test('sales identity stops on blocked, archived, merged, unverified or disabled form state',async()=>{
  const {db,submit}=await fixture();try {
    await db.exec(salesIdentityMigration);await submit();
    const eligible=async()=>(await db.query('SELECT site_questionnaire_sales_identity($1,$2,$3,123) eligible',[id(3),id(8),id(1)])).rows[0].eligible;
    for(const change of [
      "UPDATE auth.users SET banned_until=now()+interval '1 day'",
      'UPDATE auth.users SET email_confirmed_at=null',
      'UPDATE auth.users SET deleted_at=now()',
      "UPDATE profiles SET status='blocked'",
      'UPDATE profiles SET is_archived=true',
      `UPDATE profiles SET merged_to_profile_id='${id(99)}'`,
      "UPDATE site_pages SET status='draft'",
      "UPDATE site_pages SET blocks=jsonb_set(blocks,'{0,content,questionnaire_first}','false')",
      "UPDATE site_form_submissions SET metadata=metadata-'questionnaire_first'",
      "UPDATE site_form_submissions SET status='pending'",
    ]) {
      await db.exec('BEGIN');try {await db.exec(change);assert.equal(await eligible(),false,change);}finally{await db.exec('ROLLBACK')}
    }
    assert.equal(await eligible(),true);
  }finally{await db.close()}
});

test('sales identity RPC is service-only and does not expose auth rows to its caller',async()=>{
  const {db,submit}=await fixture();try {
    await db.exec(salesIdentityMigration);await submit();
    for(const role of ['anon','authenticated','service_role']) {
      const privilege=(await db.query("SELECT has_function_privilege($1,'public.site_questionnaire_sales_identity(uuid,uuid,uuid,bigint)','EXECUTE') allowed",[role])).rows[0].allowed;
      assert.equal(privilege,role==='service_role');
    }
    await db.exec('SET ROLE service_role');
    assert.equal((await db.query('SELECT site_questionnaire_sales_identity($1,$2,$3,123) eligible',[id(3),id(8),id(1)])).rows[0].eligible,true);
    await assert.rejects(db.query('SELECT * FROM auth.users'),/permission denied/);
    await db.exec('RESET ROLE');
  }finally{await db.close()}
});
async function notifications(db) {
  await db.exec(`CREATE TABLE broadcast_templates(id uuid PRIMARY KEY,channel text,channels text[],trigger_kind text,status text,approval_status text,metadata jsonb,
      CONSTRAINT broadcast_templates_trigger_kind_check CHECK(trigger_kind IN ('manual','lesson_event','scheduled_condition')));
    CREATE TABLE broadcast_automation_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid,user_id uuid,event_key text,status text DEFAULT 'pending',
      created_at timestamptz DEFAULT now(),attempted_at timestamptz,error text,
      UNIQUE(template_id,user_id,event_key));`);
  await db.exec(notificationsMigration);
  await db.query(`INSERT INTO broadcast_templates VALUES($1,'email',ARRAY['email','telegram'],'site_form_event','recurring','approved',$2)`,
    [id(60),JSON.stringify({site_form_condition:{page_id:id(3),block_id:id(8),event:'submitted'}})]);
}

test('new questionnaire entrants wait for the configured delay and retries do not reset or duplicate delivery',async()=>{
  const {db,submit}=await fixture();try{
    await notifications(db);
    await db.exec("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$");
    await db.exec(remindersMigration); await db.exec(submissionDelayMigration);
    await db.query("UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,delay_minutes}','90'::jsonb) WHERE id=$1",[id(60)]);
    await submit(); await submit();
    const delivery=(await db.query('SELECT * FROM broadcast_automation_deliveries')).rows[0];
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,2);
    assert.equal((await db.query('SELECT * FROM claim_broadcast_automation_deliveries(50)')).rows.length,0);
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery.id])).rows[0].allowed,false);
    await db.exec("UPDATE broadcast_automation_deliveries SET created_at=now()-interval '91 minutes',available_at=now()-interval '1 minute'");
    assert.equal((await db.query('SELECT * FROM claim_broadcast_automation_deliveries(50)')).rows.length,2);
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery.id])).rows[0].allowed,true);
    await submit(id(11));
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,2);
    assert.equal((await counts(db)).access,0);
  }finally{await db.close()}
});

test('incomplete reminders require verified identity, wait until due and stop after a completed form',async()=>{
  const {db,submit}=await fixture();try{
    await notifications(db);
    await db.exec("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$");
    await db.exec(remindersMigration);
    await db.query(`INSERT INTO broadcast_templates VALUES($1,'email',ARRAY['email'],'site_form_event','recurring','approved',$2)`,
      [id(61),JSON.stringify({site_form_condition:{page_id:id(3),block_id:id(8),event:'email_confirmed_incomplete',delay_minutes:60}})]);
    const confirm=()=>db.query('SELECT record_site_questionnaire_confirmation($1,$2,$3)',[id(3),id(8),id(1)]);
    await db.exec('UPDATE auth.users SET email_confirmed_at=null');
    await assert.rejects(confirm(),/questionnaire_identity_invalid/);
    await db.exec('UPDATE auth.users SET email_confirmed_at=now()');
    await confirm();await confirm();
    assert.equal((await db.query('SELECT count(*)::int n FROM site_questionnaire_confirmations')).rows[0].n,1);
    assert.equal((await db.query('SELECT * FROM claim_broadcast_automation_deliveries(50)')).rows.length,0);
    const delivery=(await db.query('SELECT id FROM broadcast_automation_deliveries WHERE template_id=$1',[id(61)])).rows[0].id;
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery])).rows[0].allowed,false);
    await db.exec("UPDATE broadcast_automation_deliveries SET available_at=now()-interval '1 second'");
    await db.exec("UPDATE site_questionnaire_confirmations SET confirmed_at=now()-interval '61 minutes'");
    assert.equal((await db.query('SELECT * FROM claim_broadcast_automation_deliveries(50)')).rows.length,1);
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery])).rows[0].allowed,true);
    await db.query("UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,delay_minutes}','120'::jsonb) WHERE id=$1",[id(61)]);
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery])).rows[0].allowed,false);
    await db.query("UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,delay_minutes}','60'::jsonb),channels=ARRAY['telegram'] WHERE id=$1",[id(61)]);
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery])).rows[0].allowed,false);
    await db.query("UPDATE broadcast_templates SET channels=ARRAY['email'] WHERE id=$1",[id(61)]);
    // Completion during an already claimed reminder still suppresses dispatch.
    await submit();
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[delivery])).rows[0].allowed,false);
    const completedDelivery=(await db.query('SELECT id FROM broadcast_automation_deliveries WHERE template_id=$1',[id(60)])).rows[0].id;
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[completedDelivery])).rows[0].allowed,true);
    await db.query("UPDATE broadcast_automation_deliveries SET status='pending' WHERE id=$1",[delivery]);
    await submit(id(11));
    assert.deepEqual((await db.query('SELECT status,error FROM broadcast_automation_deliveries WHERE id=$1',[delivery])).rows[0],{status:'failed',error:'questionnaire_completed'});
    await confirm();
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries WHERE template_id=$1',[id(61)])).rows[0].n,1);
    assert.equal((await counts(db)).access,0);
  }finally{await db.close()}
});

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
    const grants=(await db.query("SELECT has_function_privilege('anon','submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)','EXECUTE') anon, has_function_privilege('authenticated','submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)','EXECUTE') authenticated,has_function_privilege('service_role','submit_site_questionnaire(uuid,uuid,uuid,uuid,jsonb,text,text,uuid,text)','EXECUTE') service")).rows[0];
    assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
  }finally{await db.close()}
});
test('service-only submission works without granting service_role access to auth.users',async()=>{
  const {db,submit}=await fixture();try{
    await db.exec('GRANT USAGE ON SCHEMA auth TO service_role');
    assert.equal((await db.query("SELECT has_table_privilege('service_role','auth.users','SELECT') allowed")).rows[0].allowed,false);
    await db.exec('SET ROLE service_role');
    assert.equal((await submit()).success,true);
    await db.exec('RESET ROLE');
    assert.equal((await counts(db)).submissions,1);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(submit(),/permission denied for function/);
    await db.exec('RESET ROLE');
  }finally{await db.close()}
});
test('completed questionnaires queue both channels once after verified bot linking',async()=>{
  const {db,submit}=await fixture();try{
    await notifications(db);await submit();
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


test('questionnaire requires a genuine primary support-bot binding before any writes',async()=>{
  const {db,submit}=await fixture();try{
    await db.exec("UPDATE profiles SET telegram_link_status='not_linked'");
    await assert.rejects(submit(),/questionnaire_telegram_link_required/);
    assert.equal((await counts(db)).submissions,0);
    await db.exec("UPDATE profiles SET telegram_link_status='active'; DELETE FROM telegram_access_audit");
    await assert.rejects(submit(),/questionnaire_telegram_link_required/);
    await db.query("INSERT INTO telegram_access_audit VALUES($1,123,'telegram_link_confirmed',$2,now())",[id(1),JSON.stringify({bot_id:id(90)})]);
    await db.exec('UPDATE telegram_bots SET is_primary=false');
    await assert.rejects(submit(),/questionnaire_telegram_link_required/);
    await db.exec('UPDATE telegram_bots SET is_primary=true');
    assert.equal((await submit()).success,true);
    assert.equal((await counts(db)).access,0);
  }finally{await db.close();}
});


test('saved questionnaires bind the verified first-touch journey atomically, without allowing a retry to switch sources',async()=>{
 const {db,submit}=await fixture();try{
  await db.exec("CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT null::uuid$$; CREATE FUNCTION has_admin_resource_access(uuid,text,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;");
  await db.exec(journeysMigration);
  const key='a'.repeat(64),ip='b'.repeat(64);
  await db.query('SELECT track_site_questionnaire_visit($1,$2,$3,$4,$5,$6)',[id(80),key,id(81),id(3),JSON.stringify({utm_source:'Stories',utm_campaign:'ЦБ21'}),ip]);
  await assert.rejects(submit(id(10),answers,'reels',id(80),'c'.repeat(64)),/journey_binding_invalid/);
  assert.equal((await counts(db)).submissions,0);
  const saved=await submit(id(10),answers,'reels',id(80),key);
  const metadata=(await db.query('SELECT metadata FROM site_form_submissions WHERE id=$1',[saved.submission_id])).rows[0].metadata;
  assert.equal(metadata.utm_source,'Stories');assert.equal(metadata.journey_id,id(80));
  assert.equal((await db.query('SELECT profile_id FROM site_questionnaire_journeys WHERE id=$1',[id(80)])).rows[0].profile_id,id(2));
  assert.equal((await submit(id(10),answers,'reels',id(80),key)).replayed,true);
  await assert.rejects(submit(id(10)),/questionnaire_retry_conflict/);
  assert.equal((await counts(db)).submissions,1);assert.equal((await counts(db)).access,0);
 }finally{await db.close();}
});

// Reproduce the published failure using the actual tariff_offers price column.
test('production offer schema rejects old RPC atomically; migration uses amount and preserves retry safety', async () => {
  const {db,submit} = await fixture({applyOfferPriceFix:false});
  try {
    await assert.rejects(submit(), error => error.code === '42703');
    assert.deepEqual(await counts(db),{submissions:0,orders:0,events:0,consents:0,audits:0,access:0});
    await db.query('INSERT INTO tariff_offers(id,tariff_id,is_active,is_primary,amount) VALUES($1,$2,true,true,442)',[id(91),id(5)]);
    await db.exec(offerPriceMigration);
    const saved=await submit();
    const replay=await submit();
    assert.equal(saved.success,true);
    assert.equal(replay.replayed,true);
    assert.equal(saved.order_id,replay.order_id);
    const order=(await db.query('SELECT offer_id,base_price,final_price,status FROM orders_v2')).rows[0];
    assert.deepEqual(order,{offer_id:id(91),base_price:'442',final_price:'442',status:'draft'});
    assert.deepEqual(await counts(db),{submissions:1,orders:1,events:1,consents:1,audits:1,access:0});
  } finally {await db.close()}
});

const cutoffMigration=await readFile(new URL('../../supabase/migrations/20261010150000_questionnaire_notification_cutoff.sql',import.meta.url),'utf8');
test('activation cutoff rejects historic/relinked forms and is checked again at dispatch',async()=>{
  const {db,submit}=await fixture();try{
    await notifications(db);await db.exec("CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$");await db.exec(remindersMigration);await db.exec(submissionDelayMigration);await db.exec(cutoffMigration);
    await db.query("UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,submissions_from}',$1::jsonb)",[JSON.stringify(new Date(Date.now()+3600000).toISOString())]);
    await submit();
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,0);
    const submission=(await db.query('SELECT id FROM site_form_submissions')).rows[0].id;
    await db.query('SELECT queue_site_questionnaire_broadcasts($1,\'telegram\')',[submission]);
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,0,'late Telegram link must not backfill');
    await db.query("UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,submissions_from}',$1::jsonb)",[JSON.stringify(new Date(Date.now()+-3600000).toISOString())]);
    await db.query('SELECT queue_site_questionnaire_broadcasts($1)',[submission]);
    const deliveries=(await db.query('SELECT id FROM broadcast_automation_deliveries')).rows;
    assert.equal(deliveries.length,2);
    await db.query('SELECT queue_site_questionnaire_broadcasts($1)',[submission]);
    assert.equal((await db.query('SELECT count(*)::int n FROM broadcast_automation_deliveries')).rows[0].n,2,'replay is idempotent');
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[deliveries[0].id])).rows[0].allowed,true);
    await db.exec("UPDATE site_form_submissions SET created_at=now()-interval '2 hours'");
    assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[deliveries[0].id])).rows[0].allowed,false);
    for(const cutoff of ['bad','2026-02-31T10:00:00Z','2026-10-10T10:00:00']){
      await db.query("UPDATE broadcast_templates SET metadata=jsonb_set(metadata,'{site_form_condition,submissions_from}',$1::jsonb)",[JSON.stringify(cutoff)]);
      assert.equal((await db.query('SELECT site_questionnaire_delivery_allowed($1) allowed',[deliveries[0].id])).rows[0].allowed,false);
    }
    for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query("SELECT has_function_privilege($1,'site_questionnaire_after_cutoff(timestamptz,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,role==='service_role');
    assert.equal((await counts(db)).access,0);
  }finally{await db.close();}
});
