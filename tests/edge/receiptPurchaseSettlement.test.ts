import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {describe,it,expect} from 'vitest';

const bootstrap=readFileSync('tests/edge/pendingPurchaseMigration.test.ts','utf8').match(/const bootstrap = `([\s\S]*?)`;/)![1];
const migrations=['20260913112356_crm_pending_purchase_claim.sql','20260913115920_crm_empty_deal_archive.sql',
  '20260913153500_crm_payment_status_compatibility.sql','20261026064402_renewal_checkout_cycle_month.sql',
  '20261026080528_receipt_purchase_settlement.sql'];
const user='00000000-0000-4000-8000-000000000001';
const product='00000000-0000-4000-8000-000000000002';
const tariff='00000000-0000-4000-8000-000000000003';
const receipt=(uid:string,amount=250,paid_at='2026-10-23T10:24:20Z')=>({provider:'bepaid',provider_payment_id:uid,
  amount,currency:'BYN',status:'succeeded',paid_at,provider_response:{status:'successful'},meta:{source:'link_payment_webhook'}});
const setup=async()=>{const db=new PGlite();await db.exec(bootstrap);for(const m of migrations)await db.exec(readFileSync('supabase/migrations/'+m,'utf8'));return db;};
const pending=async(db:PGlite,meta:any={payment_flow:'renewal_one_time',deal_month:'2026-09'})=>(await db.query<{id:string}>(
  `INSERT INTO orders_v2(user_id,product_id,tariff_id,base_price,final_price,paid_amount,currency,status,created_at,deal_date,meta)
   VALUES($1,$2,$3,250,250,0,'BYN','pending','2026-09-18T06:00:16Z','2026-09-18T06:00:16Z',$4) RETURNING id`,
  [user,product,tariff,JSON.stringify(meta)])).rows[0].id;
const settle=async(db:PGlite,id:string,p:any)=>(await db.query<{r:any}>(`SELECT crm_settle_one_time_receipt($1,$2) r`,[id,JSON.stringify(p)])).rows[0].r;

describe('atomic receipt purchase settlement',()=>{
  it('dates the first old reminder receipt and separates each new UID without moving old money',async()=>{
    const db=await setup();try{
      const id=await pending(db);
      const first=await settle(db,id,receipt('first'));
      expect(first.order_id).toBe(id);
      const paid=(await db.query<any>(`SELECT created_at,deal_date,meta,paid_amount FROM orders_v2 WHERE id=$1`,[id])).rows[0];
      expect(new Date(paid.created_at).toISOString()).toBe('2026-09-18T06:00:16.000Z');
      expect(new Date(paid.deal_date).toISOString()).toBe('2026-10-23T10:24:20.000Z');
      expect(paid.meta.deal_month).toBe('2026-10');
      // Two independent provider events race on the same already-paid source.
      const pair=await Promise.all([settle(db,id,receipt('next-a',250,'2026-10-31T21:00:00Z')),
        settle(db,id,receipt('next-b',250,'2026-10-31T21:00:01Z'))]);
      expect(new Set(pair.map(x=>x.order_id)).size).toBe(2);
      expect(pair.every(x=>x.order_id!==id&&x.split)).toBe(true);
      const retries=await Promise.all([settle(db,id,receipt('next-a',250,'2026-10-31T21:00:00Z')),
        settle(db,id,receipt('next-a',250,'2026-10-31T21:00:00Z'))]);
      expect(retries.every(x=>x.duplicate&&x.order_id===pair[0].order_id)).toBe(true);
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:3}]);
      expect((await db.query(`SELECT count(*)::int n FROM payments_v2`)).rows).toEqual([{n:3}]);
      expect((await db.query(`SELECT paid_amount::int n FROM orders_v2 WHERE id=$1`,[id])).rows).toEqual([{n:250}]);
      expect((await db.query(`SELECT order_id FROM payments_v2 WHERE provider_payment_id='first'`)).rows).toEqual([{order_id:id}]);
      const child=(await db.query<any>(`SELECT meta,checkout_purchase_key FROM orders_v2 WHERE id=$1`,[pair[0].order_id])).rows[0];
      expect(child.meta.deal_month).toBe('2026-11');expect(child.meta.receipt_parent_order_id).toBe(id);
      expect(child.checkout_purchase_key).toBeNull();
    }finally{await db.close();}
  },20000);

  it('retains installments, explicit service months and manual dates; rejects invalid receipts atomically',async()=>{
    const db=await setup();try{
      const installment=await pending(db,{flow:'rr_installment',deal_month:'2026-09',installment_count:2});
      await settle(db,installment,receipt('part-a',100));await settle(db,installment,receipt('part-b',150));
      expect((await db.query(`SELECT paid_amount::int n,meta->>'deal_month' m FROM orders_v2 WHERE id=$1`,[installment])).rows).toEqual([{n:250,m:'2026-09'}]);
      const explicit=await pending(db,{payment_flow:'renewal_one_time',deal_month:'2026-08',contractual_month:'2026-08'});
      await settle(db,explicit,receipt('explicit'));
      expect((await db.query(`SELECT meta->>'deal_month' m FROM orders_v2 WHERE id=$1`,[explicit])).rows).toEqual([{m:'2026-08'}]);
      const manual=await pending(db);await db.query(`INSERT INTO audit_logs(action,meta) VALUES('deal.deal_month.updated',jsonb_build_object('order_id',$1::text))`,[manual]);
      await settle(db,manual,receipt('manual'));
      expect((await db.query(`SELECT meta->>'deal_month' m FROM orders_v2 WHERE id=$1`,[manual])).rows).toEqual([{m:'2026-09'}]);
      await expect(settle(db,manual,receipt('manual',249))).rejects.toThrow('receipt_already_settled_elsewhere');
      await expect(settle(db,manual,{...receipt('currency'),currency:'EUR'})).rejects.toThrow('purchase_receipt_source_mismatch');
      await expect(settle(db,manual,{...receipt('authorized'),provider_response:{status:'authorized'}})).rejects.toThrow('invalid_purchase_receipt');
      await expect(settle(db,manual,{...receipt('verification'),payment_classification:'card_verification'})).rejects.toThrow('invalid_purchase_receipt');
      await expect(settle(db,manual,{...receipt('undated'),paid_at:null})).rejects.toThrow('invalid_purchase_receipt');
      await expect(settle(db,manual,receipt('wrong-price',100))).rejects.toThrow('receipt_split_requires_review');
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:3}]);
      await db.exec('SET ROLE authenticated');
      await expect(settle(db,manual,receipt('forbidden'))).rejects.toMatchObject({code:'42501'});
    }finally{await db.close();}
  },20000);

  it('completes a pending UID in place and leaves refunded, composed and foreign purchases for review',async()=>{
    const db=await setup();try{
      const id=await pending(db,{payment_flow:'renewal_one_time',deal_month:'2026-09',active_checkout_token:'old',grant_status:'old',replacement_of_subscription_v2_id:'old',crm_routing_snapshot:{pipeline:'retained'}});
      await db.query(`INSERT INTO payments_v2(order_id,provider,provider_payment_id,status,amount,currency) VALUES($1,'bepaid','processing','processing',250,'BYN')`,[id]);
      const first=await settle(db,id,receipt('processing'));
      const next=await settle(db,id,receipt('child'));
      expect(first.order_id).toBe(id);expect(next.order_id).not.toBe(id);
      const child=(await db.query<any>(`SELECT meta FROM orders_v2 WHERE id=$1`,[next.order_id])).rows[0].meta;
      expect(child).toHaveProperty('crm_routing_snapshot');
      for(const key of ['active_checkout_token','grant_status','replacement_of_subscription_v2_id'])expect(child).not.toHaveProperty(key);
      const foreign=await pending(db);
      await expect(settle(db,foreign,receipt('child'))).rejects.toThrow('receipt_already_settled_elsewhere');
      await db.query(`UPDATE payments_v2 SET refunded_amount=250,status='refunded' WHERE provider_payment_id='processing'`);
      await expect(settle(db,id,receipt('post-refund'))).rejects.toThrow('receipt_split_requires_review');
      expect((await settle(db,id,receipt('processing'))).duplicate).toBe(true);
      expect((await db.query(`SELECT count(*)::int n FROM payments_v2`)).rows).toEqual([{n:2}]);
    }finally{await db.close();}
  },20000);

  it('previews bounded historical repairs, checks the exact fingerprint and never touches access or money',async()=>{
    const db=await setup();try{
      const id=await pending(db);
      await db.query(`UPDATE orders_v2 SET status='paid',paid_amount=250 WHERE id=$1`,[id]);
      await db.query(`INSERT INTO payments_v2(order_id,provider,provider_payment_id,amount,currency,status,paid_at)
        VALUES($1,'bepaid','historic',250,'BYN','succeeded','2026-10-23T10:24:20Z')`,[id]);
      // A month mismatch alone is insufficient evidence.
      const preview=async()=>(await db.query<any>(`SELECT * FROM crm_preview_renewal_period(ARRAY[$1::uuid])`,[id])).rows[0];
      expect((await preview()).eligible).toBe(false);
      await db.query(`INSERT INTO crm_checkout_attempts(order_id,provider,state) VALUES($1,'bepaid','ready')`,[id]);
      const plan=await preview();expect(plan.eligible).toBe(true);
      await expect(db.query(`SELECT crm_apply_renewal_period($1,'wrong-hash')`,[id])).rejects.toThrow('renewal_period_repair_preflight_changed');
      const apply=async()=>(await db.query<any>(`SELECT crm_apply_renewal_period($1,$2) r`,[id,plan.expected_hash])).rows[0].r;
      expect((await apply()).updated).toBe(true);expect((await apply()).already_applied).toBe(true);
      expect((await preview()).eligible).toBe(false);
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:1}]);
      expect((await db.query(`SELECT count(*)::int n FROM payments_v2`)).rows).toEqual([{n:1}]);
      expect((await db.query(`SELECT count(*)::int n FROM subscriptions_v2`)).rows).toEqual([{n:0}]);
      expect((await db.query(`SELECT paid_amount::int n,meta->>'deal_month' m FROM orders_v2 WHERE id=$1`,[id])).rows).toEqual([{n:250,m:'2026-10'}]);
      await db.exec('SET ROLE authenticated');
      await expect(preview()).rejects.toMatchObject({code:'42501'});
    }finally{await db.close();}
  },20000);

  it('finishes the period stamp when inline recovery already recorded the first receipt',async()=>{
    const db=await setup();try{
      const id=await pending(db);
      await db.query(`INSERT INTO payments_v2(order_id,provider,provider_payment_id,amount,currency,status,paid_at)
        VALUES($1,'bepaid','inline-recovery',250,'BYN','succeeded','2026-10-23T10:24:20Z')`,[id]);
      await db.query(`UPDATE orders_v2 SET status='paid',paid_amount=250 WHERE id=$1`,[id]);
      expect((await settle(db,id,receipt('inline-recovery'))).duplicate).toBe(true);
      expect((await db.query(`SELECT paid_amount::int n,meta->>'deal_month' m FROM orders_v2 WHERE id=$1`,[id])).rows).toEqual([{n:250,m:'2026-10'}]);
      expect((await db.query(`SELECT count(*)::int n FROM payments_v2`)).rows).toEqual([{n:1}]);
    }finally{await db.close();}
  },20000);
});
