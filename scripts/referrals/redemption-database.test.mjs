import { PGlite } from '@electric-sql/pglite';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const fixtureStatements=[];
const execute=db.exec.bind(db);
db.exec=async(sql)=>{fixtureStatements.push(sql);return execute(sql);};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),buyer=id(2),partner=id(3),profile=id(4),product=id(5),tariff=id(6),offer=id(7);
const migration=await readFile(new URL('../../supabase/migrations/20261002113949_referral_product_redemption.sql',import.meta.url),'utf8');
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
CREATE FUNCTION public.has_admin_section_access(uuid,text,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.referral_is_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE);
CREATE TABLE permissions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,name text,category text);
CREATE TABLE role_permissions(role_id uuid,permission_id uuid,UNIQUE(role_id,permission_id));
CREATE TABLE user_roles_v2(user_id uuid,role_id uuid);
CREATE TABLE profiles(id uuid PRIMARY KEY,user_id uuid,full_name text,created_at timestamptz DEFAULT now());
CREATE TABLE referral_partners(id uuid PRIMARY KEY,profile_id uuid,status text);
CREATE TABLE referral_program_settings(singleton boolean,is_enabled boolean,partner_bonus_enabled boolean,accrual_enabled boolean);
CREATE TABLE products_v2(id uuid PRIMARY KEY,name text,code text,is_active boolean,referral_bonus_eligible boolean,referral_settings_mode text);
CREATE TABLE tariffs(id uuid PRIMARY KEY,product_id uuid,name text,is_active boolean,sort_order integer,display_order integer,meta jsonb DEFAULT '{}');
CREATE TABLE tariff_offers(id uuid PRIMARY KEY,tariff_id uuid,amount numeric,is_active boolean,meta jsonb DEFAULT '{}');
CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text UNIQUE,user_id uuid,profile_id uuid,product_id uuid,tariff_id uuid,offer_id uuid,base_price numeric,final_price numeric,paid_amount numeric,currency text,status text,is_trial boolean,meta jsonb);
CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,product_id uuid,tariff_id uuid,status text,access_end_at timestamptz,created_at timestamptz DEFAULT now(),auto_renew boolean,meta jsonb);
CREATE TABLE entitlements(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,profile_id uuid,product_id uuid,product_code text,status text,expires_at timestamptz,meta jsonb,updated_at timestamptz,UNIQUE(user_id,product_code));
CREATE TABLE referral_relationships(id uuid PRIMARY KEY);
CREATE TABLE payments_v2(id uuid PRIMARY KEY,order_id uuid,status text,amount numeric,is_recurring boolean,is_deleted boolean,paid_at timestamptz,created_at timestamptz,refunded_amount numeric,transaction_type text);
CREATE TABLE referral_sale_attributions(id uuid PRIMARY KEY,partner_id uuid,status text,available_at timestamptz,commission_minor bigint,reversed_minor bigint,rule_snapshot jsonb,updated_at timestamptz,order_id uuid,commission_basis_minor bigint);
CREATE TABLE referral_balance_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),partner_id uuid,transaction_type text,idempotency_key text UNIQUE,source_type text,source_id uuid,description text,created_by uuid,metadata jsonb);
CREATE TABLE referral_balance_entries(transaction_id uuid,partner_id uuid,bucket text,amount_minor bigint CHECK(amount_minor<>0));
CREATE TABLE referral_bonus_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),partner_id uuid,amount_minor bigint,checkout_key text UNIQUE,product_id uuid,status text DEFAULT 'reserved',expires_at timestamptz DEFAULT now()+interval '30 minutes',updated_at timestamptz);
CREATE TABLE referral_payout_requests(id uuid PRIMARY KEY,partner_id uuid,amount_minor bigint,status text);
INSERT INTO roles(code) VALUES('admin');
INSERT INTO user_roles_v2 SELECT '${actor}',id FROM roles;
INSERT INTO profiles(id,user_id) VALUES('${profile}','${buyer}');
INSERT INTO referral_partners VALUES('${partner}','${profile}','active');
INSERT INTO referral_program_settings VALUES(true,true,true,true);
INSERT INTO products_v2 VALUES('${product}','Business','BUSINESS',true,true,'inherit');
INSERT INTO tariffs(id,product_id,name,is_active,sort_order,display_order) VALUES('${tariff}','${product}','Business',true,1,1);
INSERT INTO tariff_offers VALUES('${offer}','${tariff}',250,true,'{"recurring":{"is_recurring":true,"billing_period_mode":"month"}}');
`);
const sources=await readFile(new URL('../../supabase/migrations/20260712093753_274ad033-cb45-4254-ab50-87c440e04c75.sql',import.meta.url),'utf8');
await db.exec(sources.slice(sources.indexOf('CREATE TABLE IF NOT EXISTS public.entitlement_sources'),sources.indexOf('-- 2. GRANTs')));
await db.exec(`ALTER TABLE entitlement_sources DROP CONSTRAINT entitlement_sources_type_chk; ALTER TABLE entitlement_sources ADD CONSTRAINT entitlement_sources_type_chk CHECK(source_type IN ('order','manual_grant','subscription','upgrade','migration','bonus'));`);
const ledger=await readFile(new URL('../../supabase/migrations/20260329225549_dc31c051-244d-41f5-a17d-7e2a4bd390bd.sql',import.meta.url),'utf8');
await db.exec(ledger.slice(ledger.indexOf('CREATE TABLE public.access_grant_ledger'),ledger.indexOf('-- Indexes')));
const aggregate=await readFile(new URL('../../supabase/migrations/20260810170000_club_bonus_independent_sources.sql',import.meta.url),'utf8');
await db.exec(aggregate.slice(aggregate.indexOf('CREATE OR REPLACE FUNCTION public.tariff_access_rank'),aggregate.indexOf('CREATE OR REPLACE FUNCTION public.upsert_club_bonus_entitlement_source')));
await db.exec(migration);
await db.exec(`SELECT set_config('test.uid','${actor}',false); SELECT set_config('test.jwt','{"role":"service_role"}',false);`);
async function seedWallet(){await db.exec(`INSERT INTO referral_balance_transactions(id,partner_id,transaction_type,idempotency_key,source_type) VALUES('${id(10)}','${partner}','manual_adjustment','seed','test'); INSERT INTO referral_balance_entries VALUES('${id(10)}','${partner}','internal',177000),('${id(10)}','${partner}','available',118000);`);}
await seedWallet();
if(process.env.REFERRAL_SQL_FIXTURE_PATH){
 await writeFile(process.env.REFERRAL_SQL_FIXTURE_PATH,fixtureStatements.join("\n"));
 await db.close();process.exit(0);
}
const base={reason:'Approved referral exchange',cash_minor:118000,consent_reference:'Customer CRM consent record',allow_subsidy:true,items:[{product_id:product,tariff_id:tariff,offer_id:offer,period_unit:'months',period_count:12,start_mode:'now'}]};
async function quote(request=base){return (await db.query('SELECT public.referral_admin_quote_redemption($1,$2::jsonb) result',[partner,JSON.stringify(request)])).rows[0].result;}
async function commit(q){return (await db.query('SELECT public.referral_admin_commit_redemption($1) result',[q.quote_id])).rows[0].result;}
const rejected=async(action,pattern)=>{await assert.rejects(action,pattern);};
await rejected(()=>quote({...base,consent_reference:''}),/cash_consent/);
await rejected(()=>quote({...base,cash_minor:118001}),/invalid_cash/);
await rejected(()=>quote({...base,allow_subsidy:false}),/insufficient_bonus/);
await rejected(()=>quote({...base,items:[base.items[0],base.items[0]]}),/duplicate_product/);
await db.exec(`SELECT set_config('test.uid','${buyer}',false);`);
await rejected(()=>quote(),/forbidden/);
await db.exec(`SELECT set_config('test.uid','${actor}',false);`);
const ctx=(await db.query('SELECT public.referral_admin_redemption_context($1) result',[partner])).rows[0].result;
assert.equal(ctx.registered,true);assert.equal(ctx.catalog.length,1);assert.equal(ctx.permissions.subsidy,true);
const q=await quote();
assert.equal(q.total_minor,300000);assert.equal(q.internal_minor,177000);assert.equal(q.converted_cash_minor,118000);assert.equal(q.subsidy_minor,5000);
assert.equal(new Date(q.items[0].expires_at).getUTCFullYear()-new Date(q.items[0].starts_at).getUTCFullYear(),1);
await db.exec(`UPDATE tariff_offers SET amount=251 WHERE id='${offer}';`);
await rejected(()=>commit(q),/quote_stale/);
assert.equal((await db.query('SELECT count(*) n FROM referral_redemptions')).rows[0].n,0);
await db.exec(`UPDATE tariff_offers SET amount=250 WHERE id='${offer}';`);
// A provider-linked expired subscription still requires acknowledgement; no automatic cancellation.
await db.exec(`INSERT INTO subscriptions_v2(user_id,product_id,tariff_id,status,access_end_at,auto_renew,meta) VALUES('${buyer}','${product}','${tariff}','expired',now()-interval '2 days',true,'{"bepaid_subscription_id":"fixture-only"}');`);
await rejected(()=>quote(),/provider_subscription_acknowledgement/);
const request={...base,provider_acknowledged:true};
const confirmed=await quote(request);
const result=await commit(confirmed);
assert.equal(result.balances.internal,0); assert.equal(result.balances.available,0);
assert.equal((await commit(confirmed)).status,'already_completed');
assert.equal((await db.query('SELECT count(*) n FROM orders_v2')).rows[0].n,1);
assert.equal((await db.query('SELECT count(*) n FROM payments_v2')).rows[0].n,0);
assert.equal((await db.query('SELECT count(*) n FROM referral_balance_transactions WHERE transaction_type=\'bonus_spend\'')).rows[0].n,1);
assert.equal((await db.query('SELECT status FROM entitlements')).rows[0].status,'active');
assert.equal((await db.query('SELECT status,auto_renew FROM subscriptions_v2')).rows[0].status,'expired');
await rejected(()=>db.query('SELECT public.referral_admin_reverse_redemption($1,$2,false)',[confirmed.quote_id,'Operator correction']),/consumed_access/);
// Another independent access must survive reversal, even if it overlaps the same product.
await db.exec(`INSERT INTO entitlement_sources(source_type,source_ref,user_id,profile_id,product_id,tariff_id,starts_at,expires_at,status) VALUES('manual_grant','other-source','${buyer}','${profile}','${product}','${tariff}',now()-interval '1 day',now()+interval '2 years','active');`);
await db.query('SELECT public.referral_admin_reverse_redemption($1,$2,true)',[confirmed.quote_id,'Operator correction']);
let balances=(await db.query('SELECT referral_private.balance($1) b',[partner])).rows[0].b;
assert.equal(balances.internal,177000);assert.equal(balances.available,118000);
assert.equal((await db.query('SELECT status FROM entitlement_sources WHERE source_ref=\'other-source\'')).rows[0].status,'active');
assert.equal((await db.query('SELECT status FROM entitlements')).rows[0].status,'active');
// Future start has no premature activation. Tick crosses boundaries deterministically.
await db.exec(`UPDATE entitlement_sources SET status='expired' WHERE source_ref='other-source'; UPDATE entitlements SET status='expired';`);
const future=await quote({...request,items:[{...base.items[0],start_mode:'date',starts_at:new Date(Date.now()+86400000).toISOString()}]});
await commit(future);
assert.equal((await db.query('SELECT status FROM entitlements')).rows[0].status,'expired');
await db.exec(`UPDATE referral_redemption_items SET starts_at=now()-interval '1 minute' WHERE redemption_id='${future.quote_id}'; UPDATE entitlement_sources SET starts_at=now()-interval '1 minute' WHERE meta->>'redemption_id'='${future.quote_id}';`);
await db.query('SELECT public.referral_redemption_tick(100)');
assert.equal((await db.query('SELECT status FROM entitlements')).rows[0].status,'active');
await db.exec(`UPDATE referral_redemption_items SET expires_at=now()-interval '1 second' WHERE redemption_id='${future.quote_id}'; UPDATE entitlement_sources SET expires_at=now()-interval '1 second' WHERE meta->>'redemption_id'='${future.quote_id}';`);
await db.query('SELECT public.referral_redemption_tick(100)');
assert.equal((await db.query('SELECT status FROM entitlements')).rows[0].status,'expired');
// Multi-position rollback: inject failure on the second source, after the debit.
await db.query('SELECT public.referral_admin_reverse_redemption($1,$2,true)',[future.quote_id,'Rollback test correction']);
await db.exec(`INSERT INTO products_v2 VALUES('${id(20)}','Second','SECOND',true,true,'inherit'); INSERT INTO tariffs(id,product_id,name,is_active,sort_order,display_order) VALUES('${id(21)}','${id(20)}','Second',true,1,1); INSERT INTO tariff_offers VALUES('${id(22)}','${id(21)}',100,true,'{}');`);
const multi=await quote({...request,items:[base.items[0],{...base.items[0],product_id:id(20),tariff_id:id(21),offer_id:id(22)}]});
const before=(await db.query('SELECT count(*) n FROM orders_v2')).rows[0].n;
await db.exec(`CREATE FUNCTION test_source_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.product_id='${id(20)}' THEN RAISE EXCEPTION 'injected_source_failure'; END IF; RETURN NEW; END$$; CREATE TRIGGER test_source_failure BEFORE INSERT ON entitlement_sources FOR EACH ROW EXECUTE FUNCTION test_source_failure();`);
await rejected(()=>commit(multi),/injected_source_failure/);
assert.equal((await db.query('SELECT count(*) n FROM orders_v2')).rows[0].n,before);
balances=(await db.query('SELECT referral_private.balance($1) b',[partner])).rows[0].b;
assert.equal(balances.internal,177000);assert.equal(balances.available,118000);
await db.exec('DROP TRIGGER test_source_failure ON entitlement_sources');
await commit(multi);
assert.equal((await db.query('SELECT count(*) n FROM orders_v2')).rows[0].n,before+2);
// Owner history is minimal; staff reasons/consent never appear in its payload.
await db.exec(`SELECT set_config('test.uid','${buyer}',false);`);
const own=(await db.query('SELECT public.referral_get_my_redemptions() data')).rows[0].data;
assert.equal(own.length,3);assert.ok(own.every(x=>!('reason' in x)&&!('actor_id' in x)&&!('consent_reference' in x)));
await db.exec(`SELECT set_config('test.uid','${actor}',false);`);
// Strict grants: no direct write, private quote reads or staff-only fields from customer API.
await db.exec('SET ROLE authenticated');
await rejected(()=>db.query('SELECT * FROM referral_private.quotes'),/permission denied/);
await rejected(()=>db.query('SELECT reason FROM referral_redemptions'),/permission denied/);
await rejected(()=>db.query('INSERT INTO referral_redemptions(id) VALUES(gen_random_uuid())'),/permission denied/);
await rejected(()=>db.query('SELECT public.referral_redemption_tick(100)'),/permission denied/);
await db.exec('RESET ROLE');
// Independent derived source has a bounded window and reverses with its owner.
const multiItem=(await db.query('SELECT id FROM referral_redemption_items WHERE redemption_id=$1 ORDER BY product_id LIMIT 1',[multi.quote_id])).rows[0].id;
await db.exec(`INSERT INTO products_v2 VALUES('${id(30)}','Derived','DERIVED',true,true,'inherit');`);
const source=(await db.query("SELECT public.referral_project_secondary_source($1,$2,$3,now()+interval '2 years',$4::jsonb) id",[multiItem,id(31),id(30),JSON.stringify({scope_resolution_mode:'module_scope_only',historical_module_product_ids:[id(30)]})])).rows[0].id;
assert.ok((await db.query("SELECT expires_at<now()+interval '13 months' bounded FROM entitlement_sources WHERE id=$1",[source])).rows[0].bounded);
assert.equal((await db.query("SELECT meta->>'scope_resolution_mode' scope FROM entitlements WHERE product_id=$1",[id(30)])).rows[0].scope,'module_scope_only');
await db.query('SELECT public.referral_admin_reverse_redemption($1,$2,true)',[multi.quote_id,'Derived rollback']);
assert.equal((await db.query('SELECT status FROM entitlement_sources WHERE id=$1',[source])).rows[0].status,'revoked');
assert.equal((await db.query('SELECT status FROM entitlements WHERE product_id=$1',[id(30)])).rows[0].status,'expired');
await rejected(()=>db.query("SELECT public.referral_project_secondary_source($1,$2,$3,now()+interval '1 year','{}')",[multiItem,id(31),id(30)]),/source_not_active/);
// Maturation uses original split and skips a ledger mismatch/paused partner.
await db.exec(`INSERT INTO referral_sale_attributions VALUES('${id(40)}','${partner}','pending',now()-interval '1 day',101,1,'{"split_60_40_enabled":true,"withdrawable_percent_bps":4000}',now(),'${id(42)}',1010);
INSERT INTO referral_balance_transactions(id,partner_id,transaction_type,idempotency_key,source_type,source_id) VALUES('${id(41)}','${partner}','commission_pending','maturity-seed','sale_attribution','${id(40)}');
INSERT INTO referral_balance_entries VALUES('${id(41)}','${partner}','pending',40),('${id(41)}','${partner}','internal_pending',60);`);
let manifest=(await db.query('SELECT public.referral_maturation_manifest() m')).rows[0].m;
assert.equal(manifest.eligible_count,1);assert.equal(manifest.cash_minor,40);assert.equal(manifest.internal_minor,60);
await db.exec(`UPDATE referral_partners SET status='paused' WHERE id='${partner}';`);
assert.equal((await db.query('SELECT public.referral_mature_due_commissions(20) n')).rows[0].n,0);
await db.exec(`UPDATE referral_partners SET status='active' WHERE id='${partner}'; UPDATE referral_balance_entries SET amount_minor=41 WHERE transaction_id='${id(41)}' AND bucket='pending';`);
assert.equal((await db.query('SELECT public.referral_maturation_manifest() m')).rows[0].m.anomaly_count,1);
assert.equal((await db.query('SELECT public.referral_mature_due_commissions(20) n')).rows[0].n,0);
await db.exec(`UPDATE referral_balance_entries SET amount_minor=40 WHERE transaction_id='${id(41)}' AND bucket='pending';`);
await db.exec(`INSERT INTO payments_v2(id,order_id,status,amount,is_deleted,refunded_amount) VALUES('${id(43)}','${id(42)}','succeeded',10.10,false,5);`);
assert.equal((await db.query('SELECT public.referral_mature_due_commissions(20) n')).rows[0].n,0);
assert.equal((await db.query('SELECT public.referral_maturation_manifest() m')).rows[0].m.anomaly_count,1);
await db.exec(`UPDATE payments_v2 SET refunded_amount=0 WHERE id='${id(43)}';`);
assert.equal((await db.query('SELECT public.referral_mature_due_commissions(20) n')).rows[0].n,1);
assert.equal((await db.query('SELECT public.referral_mature_due_commissions(20) n')).rows[0].n,0);
assert.equal((await db.query('SELECT status FROM referral_sale_attributions WHERE id=$1',[id(40)])).rows[0].status,'available');
// All ledger rows participate, not only the API's first 1000.
await db.exec(`INSERT INTO referral_balance_entries SELECT '${id(10)}','${partner}','internal',1 FROM generate_series(1,1100); SELECT set_config('test.uid','${buyer}',false);`);
assert.equal((await db.query('SELECT public.referral_get_partner_balance($1) b',[partner])).rows[0].b.internal,178160);
// Serial outbox: one event per item even after its reversal queued another event.
const claimed=(await db.query('SELECT * FROM public.referral_redemption_claim_outbox(50)')).rows;
assert.equal(new Set(claimed.map(event=>event.item_id)).size,claimed.length);
const secondClaim=(await db.query('SELECT * FROM public.referral_redemption_claim_outbox(50)')).rows;
assert.equal(secondClaim.length,0);
await db.exec(migration); // A repeat managed apply is harmless.
await db.close();
console.log('PASS: prices, cash consent, granular permission, quote staleness, provider guard, atomic debit, replay, no payments, independent access, reversal split, future activation/expiry and grants');
