import { describe,it,expect,vi,beforeEach } from 'vitest';
vi.mock('../../supabase/functions/_shared/acquiring/vault.ts',()=>({readAcquiringSecret:vi.fn().mockResolvedValue('test-only-placeholder')}));
vi.mock('../../supabase/functions/_shared/acquiring/stripe-client.ts',()=>({stripeGetCheckoutSession:vi.fn()}));
vi.mock('../../supabase/functions/_shared/bepaid-credentials.ts',()=>({
 getBepaidCredsStrict:vi.fn().mockResolvedValue({shop_id:'33524',secret_key:'test-secret',test_mode:true}),
 isBepaidCredsError:vi.fn().mockReturnValue(false),
 createBepaidAuthHeader:vi.fn().mockReturnValue('Basic test'),
}));
import { stripeGetCheckoutSession } from '../../supabase/functions/_shared/acquiring/stripe-client';
import { reusePendingSubscriptionCheckout,samePendingSubscriptionPurchase } from '../../supabase/functions/_shared/pending-subscription-checkout';
const proposal={user_id:'user',product_id:'product',tariff_id:'tariff',offer_id:'offer',currency:'BYN',final_price:250,purchase_snapshot:{access_days:30,is_trial:false}};
const order={...proposal,id:'order',order_number:'order-number',status:'pending',paid_amount:0,meta:{payment_type:'subscription'}};
function dbFixture(money:any[]=[], extraProviders:any[]=[], baseOrder:any=order, baseProvider:any={id:'provider-row',provider:'stripe',subscription_v2_id:'sub',provider_subscription_id:'pending:sub',order_id:'order',state:'pending',meta:{stripe:{account_code:'account',checkout_session_id:'cs_test'}}}, baseSubscription:any={id:'sub',order_id:'order',status:'pending',tariff_id:'tariff',meta:{}}) {
 const rows:any={subscriptions_v2:[baseSubscription],provider_subscriptions:[baseProvider,...extraProviders],orders_v2:baseOrder,payments_v2:money};
 const db:any={rpc:vi.fn().mockResolvedValue({data:true,error:null}),from:vi.fn((table:string)=>{
  let orphanQuery=false;const q:any={is:vi.fn(()=>{orphanQuery=true;return q;})};for(const op of ['select','eq','in','gt','limit','maybeSingle','insert']) q[op]=vi.fn(()=>q);
  q.then=(resolve:any)=>Promise.resolve({data:orphanQuery ? [] : rows[table] ?? null,error:null}).then(resolve);return q;
 })};return db;
}
function orphanDbFixture(orphan:any, linkedOrder:any) {
 const db:any={rpc:vi.fn().mockResolvedValue({data:true,error:null}),from:vi.fn((table:string)=>{
  let orphanQuery=false;let requestedId:string|undefined;
  const q:any={is:vi.fn(()=>{orphanQuery=true;return q;})};
  q.select=vi.fn(()=>q);q.in=vi.fn(()=>q);q.gt=vi.fn(()=>q);q.limit=vi.fn(()=>q);q.insert=vi.fn(()=>q);
  q.eq=vi.fn((column:string,value:any)=>{if(table==='orders_v2' && column==='id') requestedId=value;return q;});
  q.maybeSingle=vi.fn(()=>Promise.resolve({data:requestedId && linkedOrder?.id===requestedId ? linkedOrder : null,error:null}));
  q.then=(resolve:any)=>Promise.resolve({data:table==='subscriptions_v2' ? [] : table==='provider_subscriptions' && orphanQuery ? [orphan] : [],error:null}).then(resolve);
  return q;
 })};return db;
}
describe('provider-confirmed subscription checkout reuse',()=>{
 beforeEach(()=>vi.clearAllMocks());
 it('requires exact price, currency, contract and recipient and excludes paid orders',()=>{
  expect(samePendingSubscriptionPurchase(order,proposal)).toBe(true);
  for(const changed of [{user_id:'other'},{final_price:251},{currency:'USD'},{purchase_snapshot:{access_days:60}},{status:'paid'},{paid_amount:1},{is_deleted:true}])
   expect(samePendingSubscriptionPurchase({...order,...changed},proposal)).toBe(false);
 });
 it('reuses an offer-less system renewal for the same public tariff checkout only',()=>{
  const renewal={...order,offer_id:null,meta:{payment_type:'subscription',payment_flow:'renewal_subscription'}};
  expect(samePendingSubscriptionPurchase(renewal,proposal)).toBe(true);
  expect(samePendingSubscriptionPurchase({...renewal,meta:{payment_type:'subscription',payment_flow:'admin_subscription'}},proposal)).toBe(false);
  expect(samePendingSubscriptionPurchase({...renewal,tariff_id:'other'},proposal)).toBe(false);
  expect(samePendingSubscriptionPurchase({...renewal,final_price:251},proposal)).toBe(false);
 });
 it('returns the same legacy purchase only for a verified open unexpired Stripe session',async()=>{
  vi.mocked(stripeGetCheckoutSession).mockResolvedValue({ok:true,status:200,data:{id:'cs_test',status:'open',expires_at:Math.floor(Date.now()/1000)+3600,payment_status:'unpaid',url:'https://checkout.example.test/live'}});
  const db=dbFixture();const result=await reusePendingSubscriptionCheckout(db,proposal,'stripe','account');
  expect(result).toMatchObject({order_id:'order',subscription_v2_id:'sub',redirect_url:'https://checkout.example.test/live'});
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it('reopens the same provider-confirmed bePaid renewal checkout when its legacy order has no offer id',async()=>{
  const renewal={...order,offer_id:null,meta:{payment_type:'subscription',payment_flow:'renewal_subscription'}};
  const provider={id:'provider-row',provider:'bepaid',subscription_v2_id:'sub',provider_subscription_id:'sbs_test',order_id:'order',state:'pending',meta:{checkout_url:'https://checkout.example.test/legacy'}};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:vi.fn().mockResolvedValue({subscription:{id:'sbs_test',state:'pending',checkout_url:'https://checkout.example.test/live',last_transaction:{status:'pending'}}})}));
  const db=dbFixture([],[],renewal,provider);
  await expect(reusePendingSubscriptionCheckout(db,proposal,'bepaid')).resolves.toMatchObject({order_id:'order',redirect_url:'https://checkout.example.test/live',bepaid_subscription_id:'sbs_test'});
  expect(db.rpc).not.toHaveBeenCalled();
 });
 it('ignores stale orphan provider rows that have no surviving order',async()=>{
  const orphan={id:'orphan',order_id:null,meta:{order_id:'missing-order'}};
  await expect(reusePendingSubscriptionCheckout(orphanDbFixture(orphan,null),proposal,'bepaid')).resolves.toBeNull();
 });
 it('ignores orphan provider rows without an order id or with a terminal local order',async()=>{
  await expect(reusePendingSubscriptionCheckout(orphanDbFixture({id:'orphan',order_id:null,meta:{}},null),proposal,'bepaid')).resolves.toBeNull();
  const paid={id:'paid-order',product_id:'product',status:'paid',paid_amount:250,is_deleted:false};
  await expect(reusePendingSubscriptionCheckout(orphanDbFixture({id:'orphan',order_id:'paid-order',meta:{}},paid),proposal,'bepaid')).resolves.toBeNull();
 });
 it('still blocks an orphan tied to a real unpaid pending order for the same product',async()=>{
  const pending={id:'pending-order',product_id:'product',status:'pending',paid_amount:0,is_deleted:false};
  await expect(reusePendingSubscriptionCheckout(orphanDbFixture({id:'orphan',order_id:'pending-order',meta:{}},pending),proposal,'bepaid'))
    .rejects.toThrow('orphan_provider_subscription_requires_reconciliation');
 });
 it('does not let a provider row on a superseded local subscription block a fresh checkout',async()=>{
  const provider={id:'provider-row',provider:'bepaid',subscription_v2_id:'sub',provider_subscription_id:'sbs_old',order_id:'order',state:'redirecting',meta:{}};
  const superseded={id:'sub',order_id:'order',status:'superseded',tariff_id:'tariff',meta:{}};
  await expect(reusePendingSubscriptionCheckout(dbFixture([],[],order,provider,superseded),proposal,'bepaid')).resolves.toBeNull();
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
