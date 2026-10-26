import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { pendingPurchaseContext, pendingPurchaseMonth } from '../../supabase/functions/_shared/pending-purchase';

const originalTest = readFileSync('tests/edge/pendingPurchaseMigration.test.ts', 'utf8');
const bootstrap = originalTest.match(/const bootstrap = `([\s\S]*?)`;/)![1];
const migrations = ['20260913112356_crm_pending_purchase_claim.sql',
  '20260913115920_crm_empty_deal_archive.sql', '20260913153500_crm_payment_status_compatibility.sql',
  '20261026064402_renewal_checkout_cycle_month.sql'];
const base = {user_id:'00000000-0000-4000-8000-000000000001',
  product_id:'00000000-0000-4000-8000-000000000002',tariff_id:'00000000-0000-4000-8000-000000000003',
  status:'pending',base_price:250,final_price:250,paid_amount:0,currency:'BYN',
  deal_date:'2026-09-18T06:00:16Z',meta:{payment_flow:'renewal_one_time'}};

describe('renewal purchase periods', () => {
  it('separates reminder periods but keeps same-month retries and explicit service months', () => {
    expect(pendingPurchaseMonth(base)).toBe('2026-09');
    expect(pendingPurchaseMonth({...base,deal_date:'2026-09-30T21:00:00Z'})).toBe('2026-10');
    expect(pendingPurchaseMonth({...base,deal_date:'2026-09-30T20:59:59Z'})).toBe('2026-09');
    expect(pendingPurchaseMonth({...base,meta:{...base.meta,deal_month:'2026-08'}})).toBe('2026-08');
    expect(pendingPurchaseMonth({...base,meta:{flow:'rr_installment'}})).toBeNull();
    expect(pendingPurchaseMonth({...base,meta:{payment_flow:'admin_one_time'}})).toBeNull();
    expect(()=>pendingPurchaseMonth({...base,deal_date:null})).toThrow('renewal_purchase_period_missing');
  });

  it('keeps SQL and runtime normalization identical, including legacy dates', async () => {
    const db=new PGlite();
    try {
      await db.exec(bootstrap);
      for(const f of migrations) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
      for(const proposal of [base,{...base,deal_date:'2026-09-30T21:00:00Z'},
        {...base,meta:{payment_flow:'renewal_subscription'}},
        {...base,deal_date:null,created_at:'2026-10-18T06:00:00Z'},
        {...base,meta:{...base.meta,deal_month:'2026-08'}},
        {...base,meta:{flow:'rr_installment'}}]) {
        const r=await db.query<{c:unknown}>(`SELECT crm_checkout_context_from_order($1,'one_time') c`,[JSON.stringify(proposal)]);
        expect(r.rows[0].c).toEqual(pendingPurchaseContext(proposal,'one_time'));
      }
      // DDL-only migration is safe to replay and never rewrites historic rows.
      await db.exec(readFileSync('supabase/migrations/'+migrations.at(-1),'utf8'));
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:0}]);
    } finally {await db.close();}
  },20000);

  it('does not adopt September for October; blocks unknown charge before creating another period',async()=>{
    const db=new PGlite();
    try {
      await db.exec(bootstrap);
      for(const f of migrations.slice(0,-1)) await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
      const claim=async(p:typeof base,provider='bepaid')=>(await db.query<{r:any}>(
        `SELECT crm_claim_pending_purchase($1,$2,$3) r`,[JSON.stringify(p),JSON.stringify(pendingPurchaseContext(p,'one_time')),provider])).rows[0].r;
      // Exact old contract: a September reminder persisted a null context month.
      const september=(await db.query<{r:any}>(`SELECT crm_claim_pending_purchase($1,$2,'bepaid') r`,
        [JSON.stringify(base),JSON.stringify({...pendingPurchaseContext(base,'one_time'),month:null})])).rows[0].r;
      expect(september.order.meta.checkout_purchase_identity.context.month).toBeNull();
      await db.query(`SELECT crm_finish_checkout_attempt($1,'ready','{"success":true,"redirect_url":"https://checkout.example.test/september"}')`,[september.attempt_id]);
      await db.query(`UPDATE crm_checkout_attempts SET expires_at=now()-interval '1 second'`);
      await db.exec(readFileSync('supabase/migrations/'+migrations.at(-1),'utf8'));
      const octoberProposal={...base,deal_date:'2026-10-23T10:24:20Z'};
      const october=await claim(octoberProposal);
      expect(october.order.id).not.toBe(september.order.id);
      await db.query(`SELECT crm_finish_checkout_attempt($1,'ready','{"success":true,"redirect_url":"https://checkout.example.test/october"}')`,[october.attempt_id]);
      expect((await claim({...octoberProposal,deal_date:'2026-10-24T11:00:00Z'})).order.id).toBe(october.order.id);
      // Switching provider within October remains one purchase.
      const stripe=await claim(octoberProposal,'stripe');
      expect(stripe.order.id).toBe(october.order.id);
      await db.query(`SELECT crm_finish_checkout_attempt($1,'unknown','{"success":false}')`,[stripe.attempt_id]);
      const november=await claim({...base,deal_date:'2026-11-01T09:00:00Z'});
      expect(november.state).toBe('in_progress');
      expect(november.order.id).toBe(october.order.id);
      expect((await db.query(`SELECT count(*)::int n FROM orders_v2`)).rows).toEqual([{n:2}]);
      await db.exec('SET ROLE authenticated');
      await expect(claim(base)).rejects.toMatchObject({code:'42501'});
    } finally {await db.close();}
  },20000);
});
