import { describe,it,expect,vi } from 'vitest';
import { chargeAttemptState,chargeRequest } from '../../supabase/functions/_shared/pending-charge';
describe('bank outcome safety',()=>{
 it('distinguishes a declined transaction from transport and ambiguous HTTP errors',()=>{
   expect(chargeAttemptState(200,{uid:'uid',status:'successful'})).toBe('ready');
   expect(chargeAttemptState(200,{uid:'uid',status:'incomplete'})).toBe('ready');
   expect(chargeAttemptState(200,{uid:'uid',status:'declined'})).toBe('failed');
   expect(chargeAttemptState(422,undefined)).toBe('failed');
   for(const code of [200,409,429,500,502,503]) expect(chargeAttemptState(code,undefined)).toBe('unknown');
   expect(chargeAttemptState(500,{uid:'uid',status:'successful'})).toBe('ready');
 });
 it('persists unknown outcome before propagating a network or JSON error',async()=>{
   const db={rpc:vi.fn().mockResolvedValue({data:true,error:null})};
   await expect(chargeRequest(db,'attempt',()=>Promise.reject(new Error('connection_lost')))).rejects.toThrow('connection_lost');
   expect(db.rpc).toHaveBeenCalledWith('crm_finish_checkout_attempt',{
     p_attempt_id:'attempt',p_state:'unknown',p_result:{success:false,error:'charge_outcome_unknown'},
   });
 });
});
