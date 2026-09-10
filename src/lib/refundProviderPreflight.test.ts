import { describe,it,expect,vi } from 'vitest';
import { readRefundProviderProof } from '../../supabase/functions/_shared/refund-provider-preflight';
const payment={uid:'tx-synthetic',amount:663,currency:'BYN'};
describe('provider preflight is read-only and fail-closed',()=>{
 it('reads only GET and strips all customer/card data',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({transaction:{uid:payment.uid,amount:66300,currency:'BYN',status:'successful',customer:{email:'private'},credit_card:{token:'secret'}}})))
   .mockResolvedValueOnce(new Response(JSON.stringify({subscription:{id:'sbs_one',state:'completed',plan:{billing_cycles:2},customer:{email:'private'}}})));
  const proof=await readRefundProviderProof('Basic synthetic',payment,['sbs_one'],fetcher);
  expect(proof.transaction.matches_payment).toBe(true);expect(proof.all_subscriptions_terminal).toBe(true);
  expect(proof.transaction.refund_history_verified).toBe(false);
  expect(JSON.stringify(proof)).not.toMatch(/private|secret|Basic|customer|credit_card/);
  for(const [,init] of fetcher.mock.calls){ expect(init.method).toBe('GET');expect(init.body).toBeUndefined();expect(init.headers['Content-Type']).toBeUndefined(); }
 });
 it.each([{id:'sbs_one',state:'active'},{id:'wrong',state:'completed'},{id:'sbs_one',state:'expired'},{id:'sbs_one',state:'unknown'}])('does not call %j terminal',async subscription=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({subscription})));
  // Return separate responses because each body is consumed once.
  fetcher.mockImplementation(async()=>new Response(JSON.stringify({subscription})));
  const proof=await readRefundProviderProof('Basic synthetic',payment,['sbs_one'],fetcher);
  expect(proof.all_subscriptions_terminal).toBe(false);
 });
 it('never interprets an HTTP error or absent subscriptions as proof',async()=>{
  const fetcher=vi.fn().mockImplementation(async()=>new Response('unavailable',{status:503}));
  expect((await readRefundProviderProof('Basic synthetic',payment,['sbs_one'],fetcher)).all_subscriptions_terminal).toBe(false);
  expect((await readRefundProviderProof('Basic synthetic',payment,[],fetcher)).all_subscriptions_terminal).toBe(false);
 });
});
