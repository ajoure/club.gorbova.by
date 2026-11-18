import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || '@electric-sql/pglite');
const db = new PGlite();
const sql = readFileSync(new URL('../../supabase/migrations/20261118192000_zg27_eligibility.sql', import.meta.url), 'utf8');
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,user_id uuid);
 CREATE TABLE public.products_v2(id uuid PRIMARY KEY,code text);
 CREATE TABLE public.orders_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,product_id uuid,status text,is_deleted boolean,is_trial boolean,meta jsonb DEFAULT '{}',purchase_snapshot jsonb DEFAULT '{}',final_price numeric,deal_date timestamptz,currency text);
 CREATE TABLE public.payments_v2(id uuid,order_id uuid,status text,is_deleted boolean,refunded_amount numeric,transaction_type text,amount numeric,currency text);
 CREATE TABLE public.entitlements(id uuid,user_id uuid,profile_id uuid,product_id uuid,product_code text,status text,meta jsonb DEFAULT '{}',order_id uuid);
 CREATE TABLE public.subscriptions_v2(id uuid,user_id uuid,profile_id uuid,product_id uuid,order_id uuid,status text,is_trial boolean,access_start_at timestamptz,meta jsonb DEFAULT '{}');`);
await db.exec(sql);
await db.exec(sql); // The function migration must be replay-safe.
const user='00000000-0000-4000-8000-000000000001';
const profile='00000000-0000-4000-8000-000000000002';
const other='00000000-0000-4000-8000-000000000003';
const cb='7101ed3c-7839-4a74-ad95-aa0660369b22';
const old='73c29914-63a3-4f4f-ac42-9f5287e58696';
const product='e71c0dbb-baf2-4b6c-a950-bf0f728708af';
const order='00000000-0000-4000-8000-000000000010';
const checks=[];
async function reset(){ await db.exec('TRUNCATE profiles,products_v2,orders_v2,payments_v2,entitlements,subscriptions_v2;'); await db.query('INSERT INTO profiles VALUES($1,$2)',[profile,user]); await db.query('INSERT INTO products_v2 VALUES($1,$2)',[cb,'cb20']); }
async function result(actor=user, prod=product){ return (await db.query('SELECT zg27_purchase_eligibility_v1($1,$2) result',[actor,prod])).rows[0].result; }
async function expectCategory(name,expected,actor=user,prod=product){ const r=await result(actor,prod); if(r.category!==expected || r.eligible!==(expected==='first'||expected==='repeat')) throw Error(name+JSON.stringify(r)); checks.push(name); }
async function enroll(pid=cb,meta={},actor=user,status='expired',oid=null){ await db.query('INSERT INTO entitlements(user_id,product_id,status,meta,order_id) VALUES($1,$2,$3,$4,$5)',[actor,pid,status,meta,oid]); }
async function paid(meta={},actor=user,pid=cb,price=100){ await db.query("INSERT INTO orders_v2(id,user_id,product_id,status,final_price,deal_date,currency,meta) VALUES($1,$2,$3,'paid',$4,'2025-01-01','BYN',$5)",[order,actor,pid,price,meta]); }
await reset(); await expectCategory('outsider','not_eligible'); await expectCategory('anonymous','not_eligible',null);
await enroll(); await expectCategory('expired full-course enrollment counts','first');
await enroll(old); await expectCategory('historic old-ZG enrollment -> repeat','repeat');
await expectCategory('foreign recipient cannot borrow eligibility','not_eligible',other);
await expectCategory('wrong product cannot reuse capability','not_eligible',user,old);
await reset(); await enroll(old); await expectCategory('old-ZG alone lacks CB','not_eligible');
await reset(); await enroll(cb,{historical_purchase_type:'module_only_standalone'}); await expectCategory('standalone module is not full course','not_eligible');
await reset(); await enroll(cb,{granted_by:'rule_engine_product_access'}); await expectCategory('unproved derived access is not enrollment','not_eligible');
await reset(); await enroll(cb,{},user,'revoked'); await expectCategory('revoked enrollment excluded','not_eligible');
await reset(); await paid(); await expectCategory('unverified paid deal lacks receipt','not_eligible');
await db.query("INSERT INTO payments_v2(order_id,status,amount,currency) VALUES($1,'succeeded',100,'BYN')",[order]); await expectCategory('confirmed receipt','first');
await db.query('UPDATE payments_v2 SET refunded_amount=10'); await expectCategory('refunded receipt excluded','not_eligible');
await reset(); await paid({import_source:'patch4',gc_deal_id:'legacy-deal'}); await expectCategory('GetCourse historical import','first');
await db.query('UPDATE orders_v2 SET user_id=NULL,profile_id=$1',[profile]); await expectCategory('profile-only imported order resolves recipient','first');
await reset(); await paid({import_source:'csv_active_import',source_file:'synthetic.csv',source_row_num:5}); await expectCategory('confirmed CSV history','first');
await reset(); await paid({import_source:'revision_7101ed3c'}); await expectCategory('reviewed CB revision import','first');
await reset(); await paid({import_source:'unknown'}); await expectCategory('unknown import is not purchase proof','not_eligible');
await reset(); await enroll(cb,{is_test:true}); await expectCategory('test enrollment excluded','not_eligible');
await reset(); await paid({import_source:'patch4',gc_deal_id:'x',is_trial:true}); await db.query('UPDATE orders_v2 SET is_trial=true'); await expectCategory('trial import excluded','not_eligible');
await reset(); await db.query("INSERT INTO entitlements(user_id,product_code,status) VALUES($1,'cb20','expired')",[user]); await expectCategory('legacy product-code enrollment','first');
await reset(); await db.query("INSERT INTO subscriptions_v2(user_id,product_id,status,is_trial,access_start_at) VALUES($1,$2,'superseded',false,'2025-01-01')",[user,cb]); await expectCategory('superseded enrollment remains history','first');
await db.exec('TRUNCATE subscriptions_v2'); await db.query("INSERT INTO subscriptions_v2(user_id,product_id,status,is_trial,access_start_at) VALUES($1,$2,'expired',true,'2025-01-01')",[user,cb]); await expectCategory('trial subscription excluded','not_eligible');
await reset(); await db.query("INSERT INTO orders_v2(id,user_id,product_id,status,meta) VALUES($1,$2,$3,'pending','{}')",[order,user,cb]); await enroll(cb,{},user,'active',order); await expectCategory('pending payment is not confirmed enrollment','not_eligible');
for(const role of ['anon','authenticated']){
 const r=await db.query("SELECT has_function_privilege($1,'public.zg27_purchase_eligibility_v1(uuid,uuid)','EXECUTE') allowed",[role]); if(r.rows[0].allowed)throw Error('public role capability leak');checks.push(role+' cannot call service proof');
}
console.log(JSON.stringify({status:'PASS',tests:checks.length,checks},null,2)); await db.close();
