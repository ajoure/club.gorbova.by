import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderBundleRepair, bundleDependencyExpression } from './render-bundle-repair.mjs';
const { PGlite } = await import(process.env.HISTORICAL_PGLITE_MODULE || '@electric-sql/pglite');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rule = '1b497fba-031a-4318-8d9f-2530f1bac116';
const business = '7c748940-dcad-4c7c-a92e-76a2344622d3';
const club = '11c9f1b8-0355-4753-bd74-40b42aa53616';
const cb = '7101ed3c-7839-4a74-ad95-aa0660369b22';
const ip = 'ea98d043-e852-443f-8807-6e77de6a5e1f';
const retail = 'abee24cd-5c8b-4111-a6cb-7dee7acf168c';
const end = '2099-01-31T12:00:00Z';
const tables = ['profiles','products_v2','orders_v2','payments_v2','subscriptions_v2','access_rules',
  'entitlements','entitlement_sources','provider_subscriptions','payment_reconcile_queue',
  'crm_pipeline_automation_jobs','referral_sale_attributions','notification_outbox',
  'pending_telegram_notifications','telegram_messages','access_grant_ledger','audit_logs'];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,is_archived boolean,merged_to_profile_id uuid);
    CREATE TABLE products_v2(id uuid PRIMARY KEY,code text);
    CREATE TABLE orders_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,product_id uuid,tariff_id uuid,
      status text,is_deleted boolean,is_trial boolean,base_price numeric,final_price numeric,paid_amount numeric,
      currency text,deal_date timestamptz,updated_at timestamptz,meta jsonb,purchase_snapshot jsonb);
    CREATE TABLE payments_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,order_id uuid,status text,
      amount numeric,currency text,refunded_amount numeric,is_deleted boolean);
    CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY,user_id uuid,product_id uuid,tariff_id uuid,order_id uuid,
      status text,is_trial boolean,access_start_at timestamptz,access_end_at timestamptz);
    CREATE TABLE access_rules(id uuid PRIMARY KEY,is_active boolean,product_id uuid,tariff_id uuid,
      duration_days integer,grant_target_type text,conditions jsonb);
    CREATE TABLE entitlements(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,product_id uuid,product_code text,
      status text,expires_at timestamptz,order_id uuid,created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),meta jsonb,UNIQUE(user_id,product_code));
    CREATE UNIQUE INDEX entitlement_product ON entitlements(user_id,product_id) WHERE product_id IS NOT NULL;
    CREATE TABLE entitlement_sources(id uuid PRIMARY KEY,user_id uuid);
    CREATE TABLE provider_subscriptions(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,state text);
    CREATE TABLE payment_reconcile_queue(id uuid PRIMARY KEY,matched_profile_id uuid,matched_order_id uuid,processed_order_id uuid);
    CREATE TABLE crm_pipeline_automation_jobs(id uuid PRIMARY KEY,deal_id uuid);
    CREATE TABLE crm_pipeline_automation_rules(id uuid PRIMARY KEY,definition jsonb);
    CREATE TABLE referral_sale_attributions(id uuid PRIMARY KEY,order_id uuid);
    CREATE TABLE notification_outbox(id uuid PRIMARY KEY,user_id uuid,meta jsonb);
    CREATE TABLE pending_telegram_notifications(id uuid PRIMARY KEY,user_id uuid);
    CREATE TABLE telegram_messages(id uuid PRIMARY KEY,user_id uuid,bot_id uuid,business_account_id uuid,business_connection_id text);
    CREATE TABLE access_grant_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),execution_key text DEFAULT gen_random_uuid()::text,
      source_event_type text,source_event_key text UNIQUE,source_subject_type text,source_subject_ref text,
      source_subscription_id uuid,source_order_id uuid,action_type text,reason_code text,target_type text,
      target_key text,user_id uuid,profile_id uuid,order_id uuid,status text,result jsonb,metadata jsonb);
    CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),action text,actor_type text,
      actor_label text,target_user_id uuid,entity_type text,entity_id text,meta jsonb);
  `);
  await db.query('INSERT INTO profiles VALUES($1,$2,false,null)', [id(2),id(1)]);
  await db.query('INSERT INTO products_v2 VALUES($1,$2),($3,$4)',[ip,'cb_module_ip',retail,'cb_module_retail']);
  await db.query(`INSERT INTO orders_v2 VALUES
    ($1,$2,$3,$4,$5,'paid',false,false,2690,2690,0,'BYN','2024-05-23','2026-09-14',
      '{"deal_month":"2024-05","keep":{"legacy":true}}','{"historical_purchase_type":"base_tariff_purchase","legacy":["keep"]}'),
    ($6,$2,$3,$7,$8,'paid',false,false,250,250,250,'BYN','2026-10-26','2026-10-26','{}','{}')`,
    [id(3),id(1),id(2),cb,id(20),id(4),club,business]);
  await db.query("INSERT INTO payments_v2 VALUES($1,$2,$3,$4,'succeeded',250,'BYN',0,false)",[id(5),id(1),id(2),id(4)]);
  await db.query("INSERT INTO subscriptions_v2 VALUES($1,$2,$3,$4,$5,'active',false,'2025-01-01',$6)",
    [id(6),id(1),club,business,id(4),end]);
  await db.query("INSERT INTO access_rules VALUES($1,true,$2,$3,null,'product_access',$4)",
    [rule,club,business,{condition_type:'prior_purchase',match_mode:'per_product',target_product_ids:[ip,retail]}]);
  await db.query(`INSERT INTO entitlements(id,user_id,profile_id,product_id,product_code,status,expires_at,meta)
    VALUES($1,$2,$3,$4,'cb_module_ip','expired','2020-04-28',$5)`,[id(7),id(1),id(2),ip,
    {source:'historical_backfill',source_type:'batch',source_rule_id:rule,business_subscription_id:id(50),keep:{untouched:true}}]);
  for (const [i,product,code] of [[31,club,'club'],[32,cb,'cb20'],
    [33,'9187db54-8f57-42eb-bbcb-d7103d2459a9','cb_module_catering'],
    [34,'d7effaf4-9be0-4ce2-971b-e02fe2a85a9a','cb_module_marketplaces']]) {
    await db.query("INSERT INTO entitlements(id,user_id,profile_id,product_id,product_code,status,expires_at,meta) VALUES($1,$2,$3,$4,$5,'active',$6,'{\"keep\":true}')",
      [id(i),id(1),id(2),product,code,end]);
  }
  await db.query("INSERT INTO entitlements(id,user_id,product_code,status,meta) VALUES($1,$2,'unknown_legacy','expired','{\"keep\":true}')",[id(35),id(1)]);
  return db;
}

async function reviewed(db) {
  const h=(await db.query("SELECT md5(to_jsonb(o)::text) row_hash,md5(purchase_snapshot::text) snapshot_hash,md5(meta::text) meta_hash,updated_at FROM orders_v2 o WHERE id=$1",[id(3)])).rows[0];
  const e=(await db.query("SELECT md5(to_jsonb(e)::text) row_hash,md5(meta::text) meta_hash,updated_at FROM entitlements e WHERE id=$1",[id(7)])).rows[0];
  return {user_id:id(1),profile_id:id(2),history_order_id:id(3),ip_entitlement_id:id(7),retail_entitlement_id:id(8),
    business_order_id:id(4),business_payment_id:id(5),business_subscription_id:id(6),business_end_at:end,
    history_row_md5:h.row_hash,history_snapshot_md5:h.snapshot_hash,history_meta_md5:h.meta_hash,
    history_updated_at:new Date(h.updated_at).toISOString(),ip_row_md5:e.row_hash,ip_meta_md5:e.meta_hash,
    ip_updated_at:new Date(e.updated_at).toISOString(),repair_key:'CASE-SYNTHETIC-BUNDLE-1',proof_message_ids:[id(90),id(91)],
    dependency_md5:(await db.query(`SELECT ${bundleDependencyExpression()} AS hash`)).rows[0].hash};
}
async function dump(db) {
  return Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query(`SELECT to_jsonb(t) row FROM ${t} t ORDER BY id`)).rows])));
}
async function refuses(db,input,pattern) {
  const before=await dump(db);
  await assert.rejects(db.exec(renderBundleRepair(input,'execute')),pattern);
  await db.exec('ROLLBACK');
  assert.deepEqual(await dump(db),before);
}

test('read-only rehearsal changes nothing; canonical repair and second execution are fully idempotent',async()=>{
  const db=await fixture();try {
    const input=await reviewed(db),before=await dump(db);
    await db.exec(renderBundleRepair(input,'dry-run'));assert.deepEqual(await dump(db),before);
    await db.exec(renderBundleRepair(input,'execute'));
    const after=await dump(db);
    for(const t of tables.filter(t=>!['orders_v2','entitlements','access_grant_ledger','audit_logs'].includes(t)))assert.deepEqual(after[t],before[t],t);
    const history=(await db.query('SELECT * FROM orders_v2 WHERE id=$1',[id(3)])).rows[0];
    assert.deepEqual(history.purchase_snapshot.legacy,['keep']);assert.deepEqual(history.meta,{deal_month:'2024-05',keep:{legacy:true}});
    assert.equal(Number(history.final_price),2690);assert.equal(Number(history.paid_amount),0);
    assert.deepEqual(history.purchase_snapshot.module_list_mapped,[ip,retail]);
    const grants=(await db.query('SELECT * FROM entitlements WHERE product_id=ANY($1) ORDER BY product_code',[[ip,retail]])).rows;
    assert.equal(grants.length,2);assert.equal(grants[0].meta.business_subscription_id,id(6));
    for(const g of grants){assert.equal(g.status,'active');assert.equal(new Date(g.expires_at).toISOString(),'2099-01-31T12:00:00.000Z');assert.deepEqual(g.meta.historical_module_product_ids,[ip,retail]);assert.equal(g.meta.prior_purchase_order_id,id(3));assert.equal(g.meta.source_access_kind,'subscription');}
    assert.deepEqual(grants[0].meta.keep,{untouched:true});assert.equal(grants[0].meta.previous_lineage.business_subscription_id,id(50));
    assert.equal(after.access_grant_ledger.length,2);assert.deepEqual(after.access_grant_ledger.map(x=>x.row.action_type).sort(),['grant','reactivate']);
    assert.equal(after.audit_logs.length,1);
    await db.exec(renderBundleRepair(input,'execute'));assert.deepEqual(await dump(db),after);
  }finally{await db.close()}
});

test('completed repair ignores later ordinary activity but still rejects changed repair outputs',async()=>{
  const db=await fixture();try {
    const input=await reviewed(db);
    await db.exec(renderBundleRepair(input,'execute'));
    await db.query("INSERT INTO audit_logs(action,target_user_id,meta) VALUES('unrelated.activity',$1,'{}'),('support.reply',$2,'{}')",[id(99),id(1)]);
    await db.query('INSERT INTO telegram_messages VALUES($1,$2,$3,null,null)',[id(98),id(1),'1a560e98-574e-4fd9-82ab-4b7bbdc300b4']);
    const afterActivity=await dump(db);
    await db.exec(renderBundleRepair(input,'execute'));
    assert.deepEqual(await dump(db),afterActivity,'completed re-entry must not repeat or undo any write');
    await db.query("UPDATE entitlements SET meta=meta||'{\"changed_after_repair\":true}' WHERE product_id=$1",[retail]);
    const afterDrift=await dump(db);
    await assert.rejects(db.exec(renderBundleRepair(input,'execute')),/Completed repair no longer matches/);
    await db.exec('ROLLBACK');
    assert.deepEqual(await dump(db),afterDrift,'changed output remains held without replacement grants');
  }finally{await db.close()}
});

test('observed history drift and stale entitlement hashes stop before any write',async()=>{
  for(const mutation of ["UPDATE orders_v2 SET meta=meta||'{\"newer\":true}' WHERE paid_amount=0", "UPDATE entitlements SET meta=meta||'{\"newer\":true}' WHERE product_code='cb_module_ip'"]){
    const db=await fixture();try{const input=await reviewed(db);await db.exec(mutation);await refuses(db,input,/CAS\/lineage\/coverage drift/);}finally{await db.close()}
  }
});
test('a refund, expired source or non-paid source blocks access',async()=>{
  for(const mutation of ["UPDATE payments_v2 SET refunded_amount=1", "UPDATE subscriptions_v2 SET access_end_at='2020-01-01'", "UPDATE orders_v2 SET status='pending' WHERE paid_amount=250"]){
    const db=await fixture();try{await db.exec(mutation);await refuses(db,await reviewed(db),/paid BUSINESS/);}finally{await db.close()}
  }
});
test('manual entitlement lineage and independent sources are protected even with fresh hashes',async()=>{
  for(const mutation of ["UPDATE entitlements SET meta=meta||'{\"source_type\":\"manual\"}' WHERE product_code='cb_module_ip'",`INSERT INTO entitlement_sources VALUES('${id(70)}','${id(1)}')`]){
    const db=await fixture();try{await db.exec(mutation);await refuses(db,await reviewed(db),/lineage|independent source/);}finally{await db.close()}
  }
});
test('unexpected notification INSERT or same-count financial UPDATE rolls the entire transaction back',async()=>{
  for(const body of [`INSERT INTO notification_outbox VALUES(gen_random_uuid(),'${id(1)}','{}');`,`UPDATE payments_v2 SET amount=amount+1;`]){
    const db=await fixture();try{await db.exec(`CREATE FUNCTION bad_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN ${body} RETURN NEW;END$$;CREATE TRIGGER bad AFTER UPDATE ON orders_v2 FOR EACH ROW EXECUTE FUNCTION bad_side_effect();`);await refuses(db,await reviewed(db),/Unexpected protected/);}finally{await db.close()}
  }
});
test('partial prior repair is held instead of creating replacement ledger or grants',async()=>{
  const db=await fixture();try{const input=await reviewed(db);await db.exec(renderBundleRepair(input,'execute'));await db.exec("DELETE FROM access_grant_ledger WHERE action_type='reactivate'");await refuses(db,input,/Completed repair/);}finally{await db.close()}
});
test('helper or CRM configuration drift after preflight stops before writes',async()=>{
  for(const mutation of ["CREATE FUNCTION public.changed_helper() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$",`INSERT INTO crm_pipeline_automation_rules VALUES('${id(85)}','{}')`]){
    const db=await fixture();try{const input=await reviewed(db);await db.exec(mutation);await refuses(db,input,/definitions changed/);}finally{await db.close()}
  }
});
test('unrendered input and untrusted payload fields fail closed',async()=>{
  const db=await fixture();try{await assert.rejects(db.exec(readFileSync(new URL('./repair-bundle.sql',import.meta.url),'utf8')),/Reviewed private input/);await db.exec('ROLLBACK');
    const input=await reviewed(db);assert.throws(()=>renderBundleRepair({...input,repair_key:"unsafe'; SELECT 1"},'execute'),/repair key/);assert.throws(()=>renderBundleRepair({...input,proof_message_ids:[]},'execute'),/proof/);assert.throws(()=>renderBundleRepair(input,'rollback'),/explicit/);
  }finally{await db.close()}
});
