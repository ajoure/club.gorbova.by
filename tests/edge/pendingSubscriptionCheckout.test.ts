import { describe,it,expect,vi,beforeEach } from 'vitest';
vi.mock('../../supabase/functions/_shared/acquiring/vault.ts',()=>({readAcquiringSecret:vi.fn().mockResolvedValue('test-only-placeholder')}));
vi.mock('../../supabase/functions/_shared/acquiring/stripe-client.ts',()=>({stripeGetCheckoutSession:vi.fn()}));
import { stripeGetCheckoutSession } from '../../supabase/functions/_shared/acquiring/stripe-client';
import { reusePendingSubscriptionCheckout,samePendingSubscriptionPurchase } from '../../supabase/functions/_shared/pending-subscription-checkout';
const proposal={user_id:'user',product_id:'product',tariff_id:'tariff',offer_id:'offer',currency:'BYN',final_price:250,purchase_snapshot:{access_days:30,is_trial:false}};
const order={...proposal,id:'order',order_number:'order-number',status:'pending',paid_amount:0,meta:{payment_type:'subscription'}};
function dbFixture(money:any[]=[], extraProviders:any[]=[]) {
 const rows:any={subscriptions_v2:[{id:'sub',order_id:'order',status:'pending',tariff_id:'tariff',meta:{}}],provider_subscriptions:[{id:'provider-row',provider:'stripe',subscription_v2_id:'sub',provider_subscription_id:'pending:sub',order_id:'order',state:'pending',meta:{stripe:{account_code:'account',checkout_session_id:'cs_test'}}},...extraProviders],orders_v2:order,payments_v2:money};
 const db:any={rpc:vi.fn().mockResolvedValue({data:true,error:null}),from:vi.fn((table:string)=>{
  let orphanQuery=false;const q:any={is:vi.fn(()=>{orphanQuery=true;return q;})};for(const op of ['select','eq','in','gt','limit','maybeSingle','insert']) q[op]=vi.fn(()=>q);
  q.then=(resolve:any)=>Promise.resolve({data:orphanQuery ? [] : rows[table] ?? null,error:null}).then(resolve);return q;
 })};return db;
}
describe('provider-confirmed subscription checkout reuse',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('requires exact price, currency, contract and recipient and excludes paid orders',()=>{
  expect(samePendingSubscriptionPurchase(order,proposal)).toBe(true);
  for(const changed of [{user_id:'other'},{final_price:251},{currency:'USD'},{purchase_snapshot:{access_days:60}},{status:'paid'},{paid_amount:1},{is_deleted:true}])
   expect(samePendingSubscriptionPurchase({...order,...changed},proposal)).toBe(false);
 });
 it('returns the same legacy purchase only for a verified open unexpired Stripe session',async()=>{
  vi.mocked(stripeGetCheckoutSession).mockResolvedValue({ok:true,status:200,data:{id:'cs_test',status:'open',expires_at:Math.floor(Date.now()/1000)+3600,payment_status:'unpaid',url:'https://checkout.example.test/live'}});
  const db=dbFixture();const result=await reusePendingSubscriptionCheckout(db,proposal,'stripe','account');
  expect(result).toMatchObject({order_id:'order',subscription_v2_id:'sub',redirect_url:'https://checkout.example.test/live'});
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it('does not return a pending link alongside another live mandate, even at a different provider',async()=>{
  const db=dbFixture([],[{id:'other',provider:'bepaid',state:'active',subscription_v2_id:'other-sub'}]);
  await expect(reusePendingSubscriptionCheckout(db,proposal,'stripe','account')).rejects.toThrow('multiple_live_provider');
  expect(stripeGetCheckoutSession).not.toHaveBeenCalled();
 });
 it('syncs only an already expired checkout and never retries a complete or unknown provider session',async()=>{
  const db=dbFixture();vi.mocked(stripeGetCheckoutSession).mockResolvedValue({ok:true,status:200,data:{id:'cs_test',status:'expired'}});
  expect(await reusePendingSubscriptionCheckout(db,proposal,'stripe','account')).toBeNull();
  expect(db.rpc).toHaveBeenCalledWith('crm_sync_expired_pending_checkout',{p_provider_row_id:'provider-row',p_provider_subscription_id:'pending:sub',p_terminal_state:'expired'});
  db.rpc.mockClear();vi.mocked(stripeGetCheckoutSession).mockResolvedValue({ok:true,status:200,data:{id:'cs_test',status:'complete',payment_status:'paid'}});
  await expect(reusePendingSubscriptionCheckout(db,proposal,'stripe','account')).rejects.toThrow('payment_requires_reconciliation');
  expect(db.rpc).not.toHaveBeenCalled();
  await expect(reusePendingSubscriptionCheckout(dbFixture([{id:'receipt'}]),proposal,'stripe','account')).rejects.toThrow('payment_requires_reconciliation');
 });
});
