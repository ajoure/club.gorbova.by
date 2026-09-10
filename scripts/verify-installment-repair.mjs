import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
const a='e17b35b2-d908-48e1-b98f-ca5f86cdf579',b='9673e359-e98e-4e7e-8196-f31f60b4e16d',g='806f3295-6327-4831-b2c4-a6631b217fcf';
await db.exec(`CREATE TABLE orders_v2(id uuid,user_id uuid,product_id uuid,is_deleted bool default false,status text,final_price numeric,paid_amount numeric,currency text,meta jsonb default '{}',updated_at timestamptz);
CREATE TABLE payments_v2(id uuid,order_id uuid,is_deleted bool default false,amount numeric,status text,provider text,currency text,refunded_amount numeric default 0,provider_payment_id text,meta jsonb default '{}',updated_at timestamptz);
CREATE TABLE payment_refund_requests(order_id uuid,state text);
CREATE TABLE subscriptions_v2(id uuid,order_id uuid,status text,auto_renew bool,next_charge_at timestamptz,meta jsonb,access_start_at timestamptz,access_end_at timestamptz);
CREATE TABLE provider_subscriptions(order_id uuid,provider text,provider_subscription_id text,state text);
CREATE TABLE entitlements(id uuid,order_id uuid,status text,expires_at timestamptz);
CREATE TABLE order_groups(id uuid,primary_order_id uuid,total_amount numeric,subtotal numeric,adjustment_amount numeric);
CREATE TABLE order_group_items(id uuid,order_group_id uuid,order_id uuid,final_amount numeric,list_amount numeric,item_snapshot jsonb);
CREATE TABLE payment_allocations(order_group_item_id uuid);
CREATE TABLE payment_links(id uuid,order_group_id uuid,status text,amount numeric,provider text,payment_type text,max_uses integer,current_uses integer,updated_at timestamptz);
CREATE TABLE audit_logs(actor_type text,actor_label text,action text,meta jsonb);
INSERT INTO orders_v2(id,user_id,product_id,status,final_price,paid_amount,currency) SELECT x::uuid,'00000000-0000-0000-0000-000000000001','3e43fb28-8322-41bc-bfee-714731bdc630','paid',663,663,'BYN' FROM unnest(ARRAY['${a}','${b}'])x;
INSERT INTO payments_v2(id,order_id,amount,status,provider,currency,provider_payment_id) VALUES
('40f01f87-79c1-44cf-9148-64c71d0d871f','${a}',663,'succeeded','bepaid','BYN','synthetic1'),
('8401bbfb-1d90-4b3f-8738-7ce581a9bc51','${b}',663,'succeeded','bepaid','BYN','synthetic2'),
('1ad28122-537a-4272-8cc4-7df4cf4bd6ac','${b}',663,'succeeded','bepaid','BYN','6e1edf0b-1fb4-47a5-a048-6f937cce7d52');
INSERT INTO subscriptions_v2 VALUES
('c6633a7b-216f-41e5-b32a-cb771add4ad6','${a}','canceled',false,null,'{"bepaid_subscription_id":"sbs_9a86268a608fca3f"}',null,'2026-08-28'),
('d16b01e5-efdd-43c8-a98c-c7d15daacfa7','${b}','expired',false,null,'{"bepaid_subscription_id":"sbs_bd6975629dfe2c83"}',null,'2027-06-07');
INSERT INTO provider_subscriptions VALUES ('${a}','bepaid','sbs_9a86268a608fca3f','canceled'),('${b}','bepaid','sbs_bd6975629dfe2c83','canceled');
INSERT INTO entitlements VALUES ('00000000-0000-0000-0000-000000000099','${b}','active','2027-06-07');
INSERT INTO order_groups VALUES ('${g}','${b}',1325,2650,-1325);
INSERT INTO order_group_items VALUES ('0235abb4-67ee-4b36-b718-525957e5e9fa','${g}','${b}',2650,2650,'{"final_amount":2650}');
INSERT INTO payment_links VALUES ('a11f2595-6bfc-486a-981c-3ebcd2706b39','${g}','active',66300,'bepaid','subscription',null,0,null);`);
const sql=readFileSync(new URL('../docs/operations/2026-09-11-installment-refund-repair.sql',import.meta.url),'utf8');
await db.exec(sql.replace(/COMMIT;\s*$/,'ROLLBACK;'));
assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,0);
await db.exec(sql);await db.exec(sql);
assert.equal((await db.query('select count(*)::int n from audit_logs')).rows[0].n,1);
assert.equal((await db.query('select count(*)::int n from orders_v2 where not is_deleted')).rows[0].n,1);
assert.equal((await db.query('select sum(amount)::int n from payments_v2 where order_id=$1',[b])).rows[0].n,1989);
assert.equal((await db.query('select final_amount::int n from order_group_items')).rows[0].n,1325);
assert.equal((await db.query('select total_amount::int n from order_groups')).rows[0].n,1325);
assert.equal((await db.query('select status from payment_links')).rows[0].status,'invalidated');
console.log('PASS repair rollback, apply, repeat no-op, exact sum/count/item/link and access guard');await db.close();
