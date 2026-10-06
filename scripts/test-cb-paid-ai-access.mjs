// Run with PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-cb-paid-ai-access.mjs
// PostgreSQL executes the actual migration, using synthetic data only.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261006083514_cb_paid_installment_ai_access.sql', import.meta.url), 'utf8');
await db.exec(`
CREATE TABLE access_rules(id uuid,product_id uuid,tariff_id uuid,grant_target_type text,target_ref text,is_active boolean);
CREATE TABLE app_sections(id uuid,code text,is_active boolean);
CREATE TABLE subscriptions_v2(id uuid,user_id uuid,product_id uuid,tariff_id uuid,order_id uuid,status text,access_start_at timestamptz,access_end_at timestamptz,meta jsonb);
CREATE TABLE orders_v2(id uuid,user_id uuid,product_id uuid,tariff_id uuid,status text,currency text,meta jsonb);
CREATE TABLE entitlements(id uuid,user_id uuid,product_id uuid,order_id uuid,status text,expires_at timestamptz);
CREATE TABLE payments_v2(id uuid,order_id uuid,user_id uuid,currency text,provider text,provider_payment_id text,status text,amount numeric,refunded_amount numeric,is_deleted boolean,transaction_type text);
`);
await db.exec(migration);
// Applying twice must preserve the same behavior.
await db.exec(migration);
const ids = {user:'00000000-0000-0000-0000-000000000001',rule:'00000000-0000-0000-0000-000000000002',tariff:'00000000-0000-0000-0000-000000000003',order:'00000000-0000-0000-0000-000000000004',section:'00000000-0000-0000-0000-000000000005',sub:'00000000-0000-0000-0000-000000000006',ent:'00000000-0000-0000-0000-000000000007',product:'3e43fb28-8322-41bc-bfee-714731bdc630'};
async function reset() {
  await db.exec('TRUNCATE access_rules,app_sections,subscriptions_v2,orders_v2,entitlements,payments_v2;');
  await db.query('INSERT INTO app_sections VALUES($1,\'ai_bank_statement_analysis\',true)',[ids.section]);
  await db.query('INSERT INTO access_rules VALUES($1,$2,$3,\'section_access\',$4,true)',[ids.rule,ids.product,ids.tariff,ids.section]);
  await db.query('INSERT INTO subscriptions_v2 VALUES($1,$2,$3,$4,$5,\'expired\',now()-interval \'30 days\',now()+interval \'200 days\',NULL)',[ids.sub,ids.user,ids.product,ids.tariff,ids.order]);
  await db.query('INSERT INTO orders_v2 VALUES($1,$2,$3,$4,\'paid\',\'BYN\',$5)',[ids.order,ids.user,ids.product,ids.tariff,JSON.stringify({installment:{model:'bepaid_finite_subscription',infinite:false,original_order_id:ids.order,billing_cycles:2,effective_total_byn:1326,per_payment_byn:663}})]);
  await db.exec('UPDATE subscriptions_v2 SET meta=(SELECT meta FROM orders_v2 LIMIT 1)');
  await db.query('INSERT INTO entitlements VALUES($1,$2,$3,$4,\'active\',now()+interval \'200 days\')',[ids.ent,ids.user,ids.product,ids.order]);
  for (const uid of ['fixture1','fixture2']) await db.query('INSERT INTO payments_v2 VALUES(gen_random_uuid(),$1,$2,\'BYN\',\'bepaid\',$3,\'succeeded\',663,0,false,\'Платеж\')',[ids.order,ids.user,uid]);
}
let passed=0;
async function test(name, change, expected) {
  await reset(); if(change) await db.exec(change);
  const r=await db.query('SELECT user_has_access_to_rule($1,$2) AS allowed',[ids.user,ids.rule]);
  assert.equal(r.rows[0].allowed,expected,name); passed++; console.log(`PASS ${name}`);
}
await test('fully paid finite installment keeps AI during paid access',null,true);
for (const code of ['ai_asset_classifier','ai_act_reconciliation','ai_accounting_regulations']) {
  await test(`${code} uses the same paid access proof`, `UPDATE app_sections SET code='${code}'`, true);
}
await test('expired entitlement denies',"UPDATE entitlements SET expires_at=now()-interval '1 day'",false);
await test('different entitlement order denies',"UPDATE entitlements SET order_id=gen_random_uuid()",false);
await test('other product never gains access',"UPDATE access_rules SET product_id=gen_random_uuid()",false);
await test('cancelled completed billing keeps paid access',"UPDATE subscriptions_v2 SET status='canceled'",true);
await test('unpaid final cycle denies',"DELETE FROM payments_v2 WHERE provider_payment_id='fixture2'",false);
await test('refund denies',"UPDATE payments_v2 SET refunded_amount=1 WHERE provider_payment_id='fixture2'",false);
await test('expired paid period denies',"UPDATE subscriptions_v2 SET access_end_at=now()-interval '1 day'",false);
await test('revoked entitlement denies',"UPDATE entitlements SET status='revoked'",false);
await test('future course start denies',"UPDATE subscriptions_v2 SET access_start_at=now()+interval '1 day'",false);
await test('different tariff denies',"UPDATE subscriptions_v2 SET tariff_id=gen_random_uuid()",false);
await test('unpaid order denies',"UPDATE orders_v2 SET status='pending'",false);
await test('overpayment needs review',"INSERT INTO payments_v2 SELECT gen_random_uuid(),order_id,user_id,currency,provider,'extra','succeeded',663,0,false,transaction_type FROM payments_v2 LIMIT 1",false);
await test('identical duplicate requires review',"INSERT INTO payments_v2 SELECT gen_random_uuid(),order_id,user_id,currency,provider,provider_payment_id,status,amount,refunded_amount,is_deleted,transaction_type FROM payments_v2 LIMIT 1",false);
await test('conflicting duplicate denies',"INSERT INTO payments_v2 SELECT gen_random_uuid(),order_id,user_id,currency,provider,provider_payment_id,status,amount+1,refunded_amount,is_deleted,transaction_type FROM payments_v2 LIMIT 1",false);
await test('different payment owner denies',"UPDATE payments_v2 SET user_id=gen_random_uuid() WHERE provider_payment_id='fixture2'",false);
await test('other service never gains access',"UPDATE app_sections SET code='documents'",false);
await test('inactive rule denies fallback',"UPDATE access_rules SET is_active=false",false);
await test('inactive section denies fallback',"UPDATE app_sections SET is_active=false",false);
await test('invalid agreement metadata denies without cast errors',"UPDATE orders_v2 SET meta=jsonb_set(meta,'{installment,billing_cycles}','\"oops\"')",false);
await test('recurring subscription does not gain access',"UPDATE orders_v2 SET meta=jsonb_set(meta,'{installment,infinite}','true')",false);
await test('manual review denies',"UPDATE orders_v2 SET meta=meta || '{\"manual_review\":true}'::jsonb",false);
await test('subscription agreement mismatch denies',"UPDATE subscriptions_v2 SET meta=jsonb_set(meta,'{installment,billing_cycles}','3')",false);
await test('deleted refund still denies',"UPDATE payments_v2 SET is_deleted=true,refunded_amount=1 WHERE provider_payment_id='fixture2'",false);
await test('existing active branch preserved',"UPDATE subscriptions_v2 SET status='active'; DELETE FROM payments_v2",true);
await test('existing product entitlement branch preserved',"UPDATE access_rules SET tariff_id=NULL; DELETE FROM subscriptions_v2",true);
console.log(`${passed} PostgreSQL fixture cases passed`);
await db.close();
