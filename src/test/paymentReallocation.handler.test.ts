import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {describe,it,expect,vi} from 'vitest';
import {paymentReallocationReplay} from '../../supabase/functions/_shared/payment-reallocation-replay';
const raw=readFileSync('supabase/functions/grant-access-for-order/index.ts','utf8');
const parsed=ts.createSourceFile('handler.ts',raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const clean=ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,parsed.statements.filter(s=>!ts.isImportDeclaration(s))));
const javascript=ts.transpileModule(clean,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const marker='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function invoke(body:Record<string,unknown>,proof=true){
  let handler!:(r:Request)=>Promise<Response>;
  const tables:string[]=[];
  const from=vi.fn((table:string)=>{
    tables.push(table);
    if(!['orders_v2','payment_reallocations'].includes(table)) throw Error('unexpected business read/write: '+table);
    const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:table==='orders_v2'
      ?{meta:{payment_reallocation_request_id:marker}}:proof?{result:{order_id:'order',applied:true}}:null,error:null})};
    return query;
  });
  const env={env:{get:()=>''},serve:(f:typeof handler)=>{handler=f}};
  new Function('Deno','createClient','resolveGrantAccessCaller','detectBranch','enforceBranchPolicy','parseExactAccessTarget','paymentReallocationReplay',javascript)(
    env,()=>({from}),async()=>({ok:true,caller:{actorType:'service_role',type:'service_role'}}),()=> 'standard',()=>null,()=>undefined,paymentReallocationReplay);
  const response=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({orderId:'order',...body})}));
  return {response,json:await response.json(),tables};
}
describe('corrected purchase replay through actual grant handler',()=>{
  it.each([
    ['admin-reconcile-processing-payments',{}],
    ['admin-retry-manual-payment-downstream',{source:'admin-retry-manual-payment-downstream'}],
    ['bepaid-webhook',{}],
    ['bepaid-webhook 3DS',{context:'3ds_finalize'}],
    ['admin manual-date override',{adminManualAccessEdit:true,customAccessEndAt:'2030-01-01T00:00:00Z'}],
  ])('%s cannot reapply primary or secondary rights',async(_source,body)=>{
    for(let attempt=0;attempt<2;attempt++){
      const result=await invoke(body);
      expect(result.response.status).toBe(200);
      expect(result.json).toMatchObject({success:true,skipped:true,reason:'payment_reallocation_period_retained'});
      expect(result.tables).toEqual(['orders_v2','payment_reallocations']);
    }
  });
  it('missing committed ledger fails closed before every access writer',async()=>{
    const result=await invoke({customAccessDays:30},false);
    expect(result.response.status).toBe(409);
    expect(result.json.error).toBe('payment_reallocation_guard_failed');
    expect(result.tables).toEqual(['orders_v2','payment_reallocations']);
  });
});
