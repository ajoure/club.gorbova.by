import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe,it,expect } from 'vitest';
import { pendingPurchaseContext } from '../../supabase/functions/_shared/pending-purchase';
const user='00000000-0000-4000-8000-000000000001', product='00000000-0000-4000-8000-000000000002',tariff='00000000-0000-4000-8000-000000000003';
const proposal={user_id:user,product_id:product,tariff_id:tariff,final_price:250,currency:'BYN'};
const setup=`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE tariffs(id uuid,access_days int);INSERT INTO tariffs VALUES('${tariff}',30);
CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,product_id uuid,tariff_id uuid,status text,paid_amount numeric DEFAULT 0,is_deleted boolean DEFAULT false,meta jsonb,checkout_purchase_key text);
CREATE TABLE referral_customer_credit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),checkout_key text UNIQUE,profile_id uuid,amount_minor bigint,status text,applied_order_id uuid,expires_at timestamptz);
CREATE TABLE referral_bonus_reservations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),checkout_key text UNIQUE,partner_id uuid,amount_minor bigint,status text,applied_order_id uuid,expires_at timestamptz,updated_at timestamptz);
CREATE TABLE referral_balance_transactions(id uuid DEFAULT gen_random_uuid(),partner_id uuid,transaction_type text,idempotency_key text,source_type text,source_id uuid,description text);
CREATE TABLE referral_balance_entries(transaction_id uuid,partner_id uuid,bucket text,amount_minor bigint);
CREATE FUNCTION referral_reserve_customer_credit(u uuid,requested bigint,charge bigint,k text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r referral_customer_credit_entries%ROWTYPE;BEGIN
SELECT * INTO r FROM referral_customer_credit_entries WHERE checkout_key=k;
IF r.id IS NULL THEN INSERT INTO referral_customer_credit_entries(checkout_key,profile_id,amount_minor,status,expires_at) VALUES(k,u,-requested,'reserved',now()+interval '2 hours') RETURNING * INTO r;END IF;
RETURN jsonb_build_object('applied_minor',abs(r.amount_minor),'reservation_id',r.id);END $$;
CREATE FUNCTION referral_reserve_partner_bonus(u uuid,requested bigint,charge bigint,k text,p uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r referral_bonus_reservations%ROWTYPE;BEGIN
SELECT * INTO r FROM referral_bonus_reservations WHERE checkout_key=k;
IF r.id IS NULL THEN INSERT INTO referral_bonus_reservations(checkout_key,partner_id,amount_minor,status,expires_at) VALUES(k,u,requested,'reserved',now()+interval '2 hours') RETURNING * INTO r;END IF;
RETURN jsonb_build_object('applied_minor',r.amount_minor,'reservation_id',r.id);END $$;`;
describe('checkout discount intent',()=>{
 it('reserves once across concurrent provider attempts, holds 24h, retains failed attempts and separates paid purchases',async()=>{
  const db=new PGlite();try{
   await db.exec(setup);await db.exec(readFileSync('supabase/migrations/20260913124348_crm_checkout_discount_intents.sql','utf8'));
   await db.exec(`CREATE TRIGGER credit_order AFTER INSERT OR UPDATE OF status ON orders_v2 FOR EACH ROW EXECUTE FUNCTION referral_customer_credit_order_trigger();
   CREATE TRIGGER bonus_order AFTER INSERT OR UPDATE OF status ON orders_v2 FOR EACH ROW EXECUTE FUNCTION referral_apply_bonus_reservation_trigger();`);
   const reserve=async()=>(await db.query<{r:any}>(`SELECT crm_reserve_checkout_discounts($1,$2,5000,3000,1) r`,[JSON.stringify(proposal),JSON.stringify(pendingPurchaseContext(proposal,'one_time'))])).rows[0].r;
   const results=await Promise.all([reserve(),reserve()]);expect(results[0]).toEqual(results[1]);
   const r=results[0];expect(r.credit_minor).toBe(5000);expect(r.bonus_minor).toBe(3000);
   expect((await db.query(`SELECT count(*)::int n,bool_and(expires_at>now()+interval '23 hours') alive FROM referral_customer_credit_entries`)).rows).toEqual([{n:1,alive:true}]);
   const meta={checkout_discount_intent_id:r.intent_id,referral_customer_credit_reservation_id:r.credit_reservation_id,referral_partner_bonus_reservation_id:r.bonus_reservation_id};
   const id=(await db.query<{id:string}>(`INSERT INTO orders_v2(user_id,product_id,tariff_id,status,meta,checkout_purchase_key) VALUES($1,$2,$3,'pending',$4,'purchase') RETURNING id`,[user,product,tariff,JSON.stringify(meta)])).rows[0].id;
   await db.query(`UPDATE orders_v2 SET status='failed' WHERE id=$1`,[id]);
   expect((await reserve()).intent_id).toBe(r.intent_id);
   await db.query(`UPDATE orders_v2 SET status='paid',paid_amount=170 WHERE id=$1`,[id]);
   expect((await db.query(`SELECT status FROM referral_customer_credit_entries`)).rows).toEqual([{status:'consumed'}]);
   expect((await db.query(`SELECT status FROM referral_bonus_reservations`)).rows).toEqual([{status:'consumed'}]);
   expect((await reserve()).intent_id).not.toBe(r.intent_id);
   await db.exec('SET ROLE authenticated');await expect(reserve()).rejects.toMatchObject({code:'42501'});
  }finally{await db.close();}
 },20000);
});
