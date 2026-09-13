import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { pendingPurchaseContext } from '../../supabase/functions/_shared/pending-purchase';
import { isPaymentCheckoutAlive, PAYMENT_CHECKOUT_LIFETIME_MS } from '../../supabase/functions/_shared/payment-checkout-lifetime';

const order = { user_id: '00000000-0000-4000-8000-000000000001', product_id: '00000000-0000-4000-8000-000000000002', tariff_id: '00000000-0000-4000-8000-000000000003', status: 'pending', base_price: 250, final_price: 250, currency: 'BYN', paid_amount: 0, meta: {} };
const bootstrap = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE order_status AS ENUM ('pending','paid','partial','refunded','failed','canceled');
CREATE TABLE orders_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_number text,user_id uuid,profile_id uuid,
product_id uuid,tariff_id uuid,offer_id uuid,responsible_user_id uuid,company_id uuid,base_price numeric,final_price numeric,
paid_amount numeric,currency text,status order_status,provider text,provider_payment_id text,payer_type text,reconcile_source text,customer_ip text,customer_email text,customer_phone text,
is_trial boolean DEFAULT false,trial_end_at timestamptz,created_at timestamptz DEFAULT now(),deal_date timestamptz,meta jsonb,pipeline_id uuid,pipeline_stage_id uuid,purchase_snapshot jsonb,is_deleted boolean DEFAULT false);
CREATE TABLE payments_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid REFERENCES orders_v2(id),
provider text,provider_payment_id text,amount numeric,currency text,status text,is_deleted boolean DEFAULT false,transaction_type text,paid_at timestamptz,meta jsonb);
CREATE TABLE subscriptions_v2(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,status text,auto_renew boolean,meta jsonb);
CREATE TABLE provider_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),subscription_v2_id uuid,provider_subscription_id text,order_id uuid,provider text,state text,meta jsonb);
CREATE TABLE audit_logs(id uuid DEFAULT gen_random_uuid(),actor_type text,action text,entity_type text,entity_id uuid,meta jsonb);
CREATE FUNCTION generate_order_number() RETURNS text LANGUAGE sql AS 'SELECT gen_random_uuid()::text';`;

describe('pending purchase contract', () => {
  it('24 hours from attempt issuance, inclusive at issuance and exclusive at expiry', () => {
    const now = Date.parse('2026-09-13T00:00:00Z');
    expect(isPaymentCheckoutAlive(new Date(now).toISOString(), now)).toBe(true);
    expect(isPaymentCheckoutAlive(new Date(now).toISOString(), now + 16*60_000)).toBe(true);
    expect(isPaymentCheckoutAlive(new Date(now).toISOString(), now + PAYMENT_CHECKOUT_LIFETIME_MS-1)).toBe(true);
    expect(isPaymentCheckoutAlive(new Date(now).toISOString(), now + PAYMENT_CHECKOUT_LIFETIME_MS)).toBe(false);
    expect(isPaymentCheckoutAlive('invalid', now)).toBe(false);
    expect(isPaymentCheckoutAlive(new Date(now+1).toISOString(), now)).toBe(false);
  });
  it('ignores provider, link and manager but distinguishes month and composition', () => {
    const context = pendingPurchaseContext(order, 'one_time');
    expect(pendingPurchaseContext({ ...order, provider:'stripe', responsible_user_id:'manager', meta:{payment_link_id:'link'} }, 'one_time')).toEqual(context);
    expect(pendingPurchaseContext({ ...order, meta:{deal_month:'2026-10'} }, 'one_time')).not.toEqual(context);
    expect(pendingPurchaseContext({ ...order, meta:{composable_checkout:{items:[{product_id:'addon',tariff_id:'t',offer_id:'o',final_amount:50}]}} }, 'one_time')).not.toEqual(context);
  });
  it('serializes concurrent claims, preserves order through provider change and expiry, separates paid purchases', async () => {
    const db = new PGlite();
    try {
      await db.exec(bootstrap);
      await db.exec(readFileSync('supabase/migrations/20260913112356_crm_pending_purchase_claim.sql','utf8'));
      const claim = async (provider='bepaid', proposal=order) => {
        const r=await db.query<{result:any}>(`SELECT crm_claim_pending_purchase($1,$2,$3,'') AS result`,[JSON.stringify(proposal),JSON.stringify(pendingPurchaseContext(proposal,'one_time')),provider]);
        return r.rows[0].result;
      };
      const results=await Promise.all([claim(),claim()]);
      expect(results.map(r=>r.state).sort()).toEqual(['claimed','in_progress']);
      expect(results[0].order.id).toBe(results[1].order.id);
      const first=results.find(r=>r.state==='claimed');
      const ready={success:true,redirect_url:'https://checkout.example.test/session',order_id:first.order.id};
      await db.query(`SELECT crm_finish_checkout_attempt($1,'ready',$2)`,[first.attempt_id,JSON.stringify(ready)]);
      expect((await claim()).result).toEqual(ready);
      const second=await claim('stripe');
      expect(second.state).toBe('claimed'); expect(second.order.id).toBe(first.order.id);
      await db.query(`SELECT crm_finish_checkout_attempt($1,'failed',$2)`,[second.attempt_id,'{"success":false}']);
      await db.exec(`UPDATE crm_checkout_attempts SET expires_at=now()-interval '1 second'`);
      const expired=await claim(); expect(expired.order.id).toBe(first.order.id); expect(expired.attempt_id).not.toBe(first.attempt_id);
      await db.query(`SELECT crm_finish_checkout_attempt($1,'unknown',$2)`,[expired.attempt_id,'{"success":false}']);
      expect((await claim()).state).toBe('in_progress');
      await db.query(`UPDATE orders_v2 SET status='paid',paid_amount=250 WHERE id=$1`,[first.order.id]);
      const newPurchase=await claim(); expect(newPurchase.order.id).not.toBe(first.order.id);
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:2}]);
      await db.exec('SET ROLE authenticated');
      await expect(claim()).rejects.toMatchObject({code:'42501'});
    } finally { await db.close(); }
  },20000);
  it('normalizes legacy contracts identically and adopts only an unpaid matching purchase', async () => {
    const db = new PGlite();
    try {
      await db.exec(bootstrap);
      await db.exec(readFileSync('supabase/migrations/20260913112356_crm_pending_purchase_claim.sql','utf8'));
      const cases = [order,
        {...order, payer_type:'individual', is_trial:null, meta:{cohort_id:null}},
        {...order, meta:{composable_checkout:{items:[{...order, role:'primary', quantity:1}]}}},
        {...order, meta:{composable_checkout:{items:[{product_id:'z',amount:2}, {product_id:'a', amount:1,offer_id:null}, {product_id:'a',amount:0}]}}},
        {...order, meta:{composable_checkout:{items:[{...order, role:'primary', quantity:2}]}}},
      ];
      for (const proposal of cases) {
        const actual=(await db.query<{r:any}>(`SELECT crm_checkout_context_from_order($1,'one_time') r`,[JSON.stringify(proposal)])).rows[0].r;
        expect(actual).toEqual(pendingPurchaseContext(proposal,'one_time'));
      }
      const id=(await db.query<{id:string}>(`INSERT INTO orders_v2(user_id,product_id,tariff_id,base_price,final_price,paid_amount,currency,status,meta)
        SELECT user_id,product_id,tariff_id,250,250,0,'BYN','pending','{}' FROM jsonb_populate_record(NULL::orders_v2,$1) RETURNING id`,[JSON.stringify(order)])).rows[0].id;
      const claim=()=>db.query<{r:any}>(`SELECT crm_claim_pending_purchase($1,$2,'bepaid') r`,[JSON.stringify(order),JSON.stringify(pendingPurchaseContext(order,'one_time'))]);
      await db.query(`INSERT INTO payments_v2(order_id,amount,status) VALUES($1,250,'processing')`,[id]);
      await expect(claim()).rejects.toThrow('checkout_legacy_payment_in_progress');
      await db.query(`UPDATE payments_v2 SET status='failed' WHERE order_id=$1`,[id]);
      expect((await claim()).rows[0].r.order.id).toBe(id);
      await db.query(`INSERT INTO payments_v2(order_id,amount,status) VALUES($1,250,'succeeded')`,[id]);
      await expect(claim()).rejects.toThrow('checkout_purchase_has_money');
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:1}]);
    } finally { await db.close(); }
  },20000);
  it('holds a charge through expiry and releases only a verified provider decline', async () => {
    const db = new PGlite();
    try {
      await db.exec(bootstrap);
      await db.exec(readFileSync('supabase/migrations/20260913112356_crm_pending_purchase_claim.sql','utf8'));
      const claim=async(kind='charge')=>(await db.query<{r:any}>(`SELECT crm_claim_pending_purchase($1,$2,'bepaid','',$3) r`,
        [JSON.stringify(order),JSON.stringify(pendingPurchaseContext(order,'one_time')),kind])).rows[0].r;
      const first=await claim();
      const ready={success:true,order_id:first.order.id};
      await db.query(`SELECT crm_finish_checkout_attempt($1,'ready',$2)`,[first.attempt_id,JSON.stringify(ready)]);
      await db.exec(`UPDATE crm_checkout_attempts SET expires_at=now()-interval '1 day'`);
      expect((await claim()).result).toEqual(ready);
      expect((await claim('checkout')).state).toBe('in_progress');
      await db.query(`INSERT INTO payments_v2(order_id,amount,status,meta) VALUES($1,250,'failed',$2)`,
        [first.order.id,JSON.stringify({checkout_attempt_id:first.attempt_id})]);
      expect((await claim('checkout')).state).toBe('in_progress');
      await db.query(`UPDATE payments_v2 SET provider_payment_id='verified_declined_uid' WHERE order_id=$1`,[first.order.id]);
      const retry=await claim(); expect(retry.state).toBe('claimed');expect(retry.order.id).toBe(first.order.id);
      // A callback can arrive before the HTTP response. A late response must not revive a declined attempt.
      await db.query(`INSERT INTO payments_v2(order_id,amount,status,provider_payment_id,meta) VALUES($1,250,'failed','declined2',$2)`,
        [first.order.id,JSON.stringify({checkout_attempt_id:retry.attempt_id})]);
      expect((await db.query<{r:boolean}>(`SELECT crm_finish_checkout_attempt($1,'ready',$2) r`,[retry.attempt_id,JSON.stringify(ready)])).rows[0].r).toBe(false);
    } finally { await db.close(); }
  },20000);
  it('settles the initial invoice on the pending purchase, preserves renewals, and rolls back invalid receipts', async () => {
    const db = new PGlite();
    try {
      await db.exec(bootstrap);
      await db.exec(readFileSync('supabase/migrations/20260913112356_crm_pending_purchase_claim.sql','utf8'));
      const proposal = { ...order, meta: { marker:'preserved' } };
      const claimArgs = [JSON.stringify(proposal), JSON.stringify(pendingPurchaseContext(proposal,'subscription'))];
      const claimed = (await db.query<{r:any}>(`SELECT crm_claim_pending_purchase($1,$2,'stripe','poland') r`, claimArgs)).rows[0].r;
      const pendingId = claimed.order.id;
      const settle = async (invoice:string, pending:string|null, recipient=order.user_id, amount=250) => {
        const stripe = {invoice_id:invoice,account_code:'poland'};
        const paid = { ...order,user_id:recipient,order_number:invoice,status:'paid',paid_amount:amount,
          provider:'stripe',provider_payment_id:invoice,payer_type:'individual',meta:{stripe} };
        const payment = {provider:'stripe',provider_payment_id:invoice,amount,currency:'BYN',status:'succeeded',meta:{stripe}};
        return (await db.query<{r:any}>(`SELECT crm_settle_stripe_invoice($1,$2,$3) r`, [JSON.stringify(paid),pending,JSON.stringify(payment)])).rows[0].r;
      };
      const pair = await Promise.all([settle('in_first',pendingId),settle('in_first',pendingId)]);
      expect(pair[0].order_id).toBe(pendingId); expect(pair[1].order_id).toBe(pendingId);
      expect(pair.map(r=>r.duplicate).sort()).toEqual([false,true]);
      expect((await db.query(`SELECT paid_amount::int n,meta->>'marker' marker FROM orders_v2 WHERE id=$1`,[pendingId])).rows)
        .toEqual([{n:250,marker:'preserved'}]);
      const renewal=await settle('in_renewal',null);
      expect(renewal.order_id).not.toBe(pendingId);
      await expect(settle('in_wrong_owner',pendingId,'00000000-0000-4000-8000-000000000009')).rejects.toThrow('stripe_pending_purchase_mismatch');
      await expect(settle('in_invalid_amount',null,order.user_id,-1)).rejects.toThrow('invalid_stripe_invoice_settlement');
      expect((await db.query(`SELECT count(*)::int n FROM payments_v2`)).rows).toEqual([{n:2}]);
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:2}]);
      // A second actual receipt is money, even on an already-paid purchase.
      await settle('in_another_receipt',pendingId);
      expect((await settle('in_first',pendingId)).duplicate).toBe(true);
      expect((await db.query(`SELECT paid_amount::int n FROM orders_v2 WHERE id=$1`,[pendingId])).rows).toEqual([{n:500}]);
    } finally { await db.close(); }
  },20000);
  it('rolls up real money without counting voids or deleted receipts and restores an archived purchase', async () => {
    const db = new PGlite();
    try {
      await db.exec(bootstrap);
      await db.exec(readFileSync('supabase/migrations/20260913112356_crm_pending_purchase_claim.sql','utf8'));
      const id=(await db.query<{id:string}>(`INSERT INTO orders_v2(final_price,paid_amount,currency,status,is_deleted) VALUES(250,0,'BYN','failed',true) RETURNING id`)).rows[0].id;
      await db.query(`INSERT INTO payments_v2(order_id,amount,currency,status,transaction_type,is_deleted) VALUES
        ($1,100,'BYN','succeeded','payment',false),($1,150,'BYN','succeeded','Платеж',false),
        ($1,250,'BYN','succeeded','void',false),($1,999,'BYN','succeeded','payment',true)`,[id]);
      await db.query(`SELECT crm_refresh_paid_purchase($1)`,[id]);
      await db.query(`SELECT crm_refresh_paid_purchase($1)`,[id]);
      expect((await db.query(`SELECT paid_amount::int n,status,is_deleted FROM orders_v2 WHERE id=$1`,[id])).rows)
        .toEqual([{n:250,status:'paid',is_deleted:false}]);
    } finally { await db.close(); }
  },20000);

  it('RR reuses a created request beyond 30 minutes and never releases an unknown provider outcome', async () => {
    const db = new PGlite();
    try {
      await db.exec(bootstrap);
      await db.exec(readFileSync('supabase/migrations/20260913112356_crm_pending_purchase_claim.sql','utf8'));
      const offer='00000000-0000-4000-8000-000000000004';
      const rrClaim=async()=> (await db.query<{order_id:string;was_reused:boolean}>(
        `SELECT * FROM rr_get_or_create_pending_order($1,$2,NULL,NULL,$3,$4,250,'BYN',NULL,NULL,NULL,$5,NULL,NULL,NULL,'same-composition')`,
        [offer,order.user_id,order.product_id,order.tariff_id,JSON.stringify({flow:'rr_installment',rr:{initiation_status:'pending',upstream_call_state:'not_started'}})]
      )).rows[0];
      const first=await rrClaim(); expect(first.was_reused).toBe(false);
      await db.query(`UPDATE orders_v2 SET created_at=now()-interval '2 days',meta=meta||'{"rr":{"initiation_status":"created","payment_url":"https://payments.example.test"}}'::jsonb WHERE id=$1`,[first.order_id]);
      const reused=await rrClaim(); expect(reused).toMatchObject({order_id:first.order_id,was_reused:true});
      await db.query(`UPDATE orders_v2 SET meta=meta||'{"rr":{"upstream_outcome":"unknown","upstream_call_state":"started","reconciliation_status":"pending"}}'::jsonb WHERE id=$1`,[first.order_id]);
      expect(await rrClaim()).toMatchObject({order_id:first.order_id,was_reused:true});
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:1}]);
    } finally { await db.close(); }
  },20000);

});
