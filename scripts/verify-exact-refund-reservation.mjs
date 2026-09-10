import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite();
const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TYPE order_status AS ENUM ('paid','refunded');
CREATE TABLE orders_v2(id uuid PRIMARY KEY,user_id uuid,profile_id uuid,currency text DEFAULT 'BYN',status order_status DEFAULT 'paid',order_number text,meta jsonb DEFAULT '{}',updated_at timestamptz);
CREATE TABLE audit_logs(actor_user_id uuid,target_user_id uuid,actor_type text,actor_label text,action text,meta jsonb);
CREATE TABLE payments_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,status text,is_deleted boolean,amount numeric,refunded_amount numeric,currency text,provider text,provider_payment_id text,transaction_type text,reference_payment_id uuid,meta jsonb,profile_id uuid,user_id uuid,paid_at timestamptz,updated_at timestamptz);
CREATE FUNCTION has_role_v2(uuid,text) RETURNS boolean LANGUAGE sql AS 'SELECT $1=''${uid(1)}''::uuid';
INSERT INTO orders_v2(id) VALUES ('${uid(2)}'),('${uid(3)}');
INSERT INTO payments_v2(id,order_id,status,is_deleted,amount,refunded_amount,currency,provider,provider_payment_id,transaction_type,reference_payment_id,meta) VALUES ('${uid(4)}','${uid(2)}','succeeded',false,663,0,'BYN','bepaid','third','payment',null,'{}');
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
const sql=readFileSync(new URL('../supabase/migrations/20260910191115_exact_payment_refund_requests.sql',import.meta.url),'utf8');
await db.exec(sql);await db.exec(sql);
let count=0;
const check=(a,b)=>{assert.deepEqual(a,b);count++;};
const reserve=async(key,amount=663,order=uid(2),actor=uid(1),action='keep')=>(await db.query('SELECT reserve_payment_refund_request($1,$2,$3,$4,$5,$6,$7,null,null,$8) r',[uid(key),order,uid(4),amount,'BYN',actor,action,'synthetic'])).rows[0].r;
const rejects=async(fn,pattern)=>{await assert.rejects(fn,pattern);count++;};
for(const role of ['anon','authenticated']){
 await db.exec(`SET ROLE ${role}`);
 await rejects(()=>db.query('SELECT * FROM payment_refund_requests'),/permission denied/);
 await rejects(()=>reserve(10),/permission denied/);
 await db.exec('RESET ROLE');
}
await db.exec('SET ROLE service_role');
await rejects(()=>reserve(10,663,uid(3)),/selected_payment/);
await rejects(()=>reserve(10,663,uid(2),uid(99)),/admin_required/);
for(const amount of [0,-1,664,1.001,'NaN','Infinity']) await rejects(()=>reserve(10,amount),/invalid|exceeds/);
check((await reserve(10)).reserved,true);
check((await reserve(10)).reserved,false);
await rejects(()=>reserve(10,662),/key_conflict/);
await rejects(()=>reserve(11),/requires_review/);
await db.exec(`UPDATE payment_refund_requests SET state='unknown' WHERE request_key='${uid(10)}'`);
await rejects(()=>reserve(11),/requires_review/);
await db.exec(`UPDATE payment_refund_requests SET state='failed' WHERE request_key='${uid(10)}'`);
check((await reserve(11)).reserved,true);
await db.exec(`UPDATE payment_refund_requests SET state='provider_succeeded',provider_refund_id='refund-third' WHERE request_key='${uid(11)}'`);
await rejects(()=>reserve(12),/requires_review/);
await db.exec('RESET ROLE');
await db.exec(`UPDATE payments_v2 SET refunded_amount=663 WHERE id='${uid(4)}';
INSERT INTO payments_v2(id,order_id,status,is_deleted,amount,refunded_amount,currency,provider,provider_payment_id,transaction_type,reference_payment_id,meta) VALUES ('${uid(5)}','${uid(2)}','refunded',false,-663,0,'BYN','bepaid','refund-third','refund','${uid(4)}','{}');`);
await db.exec('SET ROLE service_role');
await rejects(()=>reserve(12),/exceeds/);
check((await reserve(11)).reserved,false);
check((await db.query('SELECT count(*)::int n FROM payment_refund_requests')).rows[0].n,2);
await db.exec('RESET ROLE');
check((await db.query('SELECT amount::float amount,refunded_amount::float refunded_amount FROM payments_v2 WHERE id=$1',[uid(4)])).rows[0],{amount:663,refunded_amount:663});
// Canonical money recording: consecutive partial refunds must count counter+row once.
await db.exec(`INSERT INTO orders_v2(id) VALUES ('${uid(20)}');
INSERT INTO payments_v2(id,order_id,status,amount,refunded_amount,currency,provider,provider_payment_id,transaction_type)
VALUES ('${uid(21)}','${uid(20)}','succeeded',663,0,'BYN','bepaid','first-original','payment'),
('${uid(22)}','${uid(20)}','succeeded',663,0,'BYN','bepaid','second-original','payment'),
('${uid(23)}','${uid(20)}','succeeded',663,0,'BYN','bepaid','third-original','payment');`);
const record=async(parent,amount,refundUid,order=uid(20))=>(await db.query('SELECT record_refund_atomic($1,$2,$3,$4,$5,$6,$7,$8) r',
 [order,uid(parent),amount,refundUid,'Synthetic',uid(1),null,{}])).rows[0].r;
for(const role of ['anon','authenticated']) {
 await db.exec(`SET ROLE ${role}`); await rejects(()=>record(23,663,'r-third'),/permission denied/); await db.exec('RESET ROLE');
}
await db.exec('SET ROLE service_role');
await rejects(()=>record(23,663,'wrong-order',uid(2)),/parent_mismatch/);
for(const n of [0,-1,664,1.001,'NaN']) await rejects(()=>record(23,n,'bad'),/invalid|exceeds/);
let r=await record(23,663,'r-third'); check(r.refund_status,'partial');check(r.total_refunded_after,663);check(r.paid_sum,1989);
check((await record(23,663,'r-third')).idempotent,true);
await rejects(()=>record(22,663,'r-third'),/uid_parent_mismatch/);
await rejects(()=>record(23,1,'r-third-extra'),/exceeds/);
r=await record(22,663,'r-second');check(r.refund_status,'partial');check(r.total_refunded_after,1326);
r=await record(21,663,'r-first');check(r.refund_status,'full');check(r.total_refunded_after,1989);
await db.exec('RESET ROLE');
check((await db.query('SELECT count(*)::int n FROM payments_v2 WHERE order_id=$1 AND amount<0',[uid(20)])).rows[0].n,3);
// Legacy row-only refund is included once and also bounds the exact parent.
await db.exec(`INSERT INTO orders_v2(id) VALUES ('${uid(30)}');
INSERT INTO payments_v2(id,order_id,status,amount,refunded_amount,currency,provider,provider_payment_id,transaction_type,meta)
VALUES ('${uid(31)}','${uid(30)}','succeeded',100,0,'BYN','bepaid','legacy-parent','payment','{}'),
('${uid(32)}','${uid(30)}','refunded',-40,0,'BYN','bepaid','legacy-refund','refund','{"parent_payment_id":"${uid(31)}"}');`);
await db.exec('SET ROLE service_role');
await rejects(()=>db.query('SELECT reserve_payment_refund_request($1,$2,$3,$4,$5,$6,$7,null,null,$8)',[uid(35),uid(30),uid(31),61,'BYN',uid(1),'keep','Synthetic legacy']),/exceeds/);
await rejects(()=>record(31,61,'over-legacy',uid(30)),/exceeds/);
r=await record(31,60,'remaining-legacy',uid(30));check(r.total_refunded_after,100);check(r.refund_status,'full');
await db.exec('RESET ROLE');
console.log(`PASS ${count} checks: roles, exact payment, retries, unknown provider result, canonical idempotency, three partial refunds and legacy row-only refunds`);
await db.close();
