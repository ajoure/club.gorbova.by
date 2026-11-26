import { describe,it,expect,vi } from 'vitest';
import { paymentReallocationReplay } from '../../supabase/functions/_shared/payment-reallocation-replay';
const request='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('corrected receipt grant replay',()=>{
  it('ordinary purchases never touch the new table',async()=>{
    const read=vi.fn();expect(await paymentReallocationReplay('order',undefined,read)).toBe('ordinary');expect(read).not.toHaveBeenCalled();
  });
  it('a committed exact order retains its frozen paid period',async()=>{
    expect(await paymentReallocationReplay('order',request,async()=>({result:{order_id:'order',applied:true}}))).toBe('retained');
  });
  it('a marker cannot borrow another purchase or an uncommitted correction',async()=>{
    expect(await paymentReallocationReplay('order',request,async()=>({result:{order_id:'other',applied:true}}))).toBe('blocked');
    expect(await paymentReallocationReplay('order',request,async()=>({result:{order_id:'order',applied:false}}))).toBe('blocked');
  });
  it('missing proof, invalid marker and read failures fail closed',async()=>{
    expect(await paymentReallocationReplay('order',request,async()=>({result:null}))).toBe('blocked');
    expect(await paymentReallocationReplay('order','bad',vi.fn())).toBe('blocked');
    expect(await paymentReallocationReplay('order',request,async()=>{throw Error('unavailable')})).toBe('blocked');
  });
});
