import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import ts from "typescript";
import {resolveWebinarBroadcastCounts} from "../../supabase/functions/broadcast-audience-preview/webinarRegistration";
const source=readFileSync("supabase/functions/process-scheduled-broadcasts/index.ts","utf8");
const start=source.indexOf("  for (const tpl of list) {");
const end=source.indexOf("    // ===== Atomic lock:",start);
const segment=source.slice(start,end);
const run=new Function("resolveWebinarBroadcastCounts","supabase","list","isDryRun",ts.transpileModule(`return (async()=>{let totalFailed=0;const perTemplateLog=[];const processed=[];${segment}processed.push(tpl.id);}return {totalFailed,perTemplateLog,processed};})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
describe("scheduled webinar audience errors",()=>{
 for(const failure of ["malformed","database"]){
  it(`${failure} is isolated before claiming and the following template continues`,async()=>{
   const updates:unknown[]=[];
   const update=vi.fn((value:unknown)=>{updates.push(value);const chain={eq:()=>chain,then:(resolve:(v:unknown)=>void)=>resolve({error:null})};return chain;});
   const client={from:(table:string)=>table==="broadcast_templates"?{update}:{},rpc:async(name:string)=>name==="resolve_broadcast_audience"?{data:{total_count:1,telegram_count:1,email_count:0},error:null}:{data:null,error:{message:"database failure"}}};
   const condition=failure==="malformed"?{}:{page_id:"00000000-0000-4000-8000-000000000001",block_id:"00000000-0000-4000-8000-000000000002"};
   const bad={id:"bad",channels:["email"],audience_filters:{webinar_registration:condition},next_run_at:"2026-10-16T10:00:00Z"};
   const good={id:"good",channels:["telegram"],audience_filters:{}};
   const result=await run(resolveWebinarBroadcastCounts,client,[bad,good],false);
   expect(result.totalFailed).toBe(1);expect(result.processed).toEqual(["good"]);
   expect(updates).toEqual([{status:"draft",send_mode:"manual",next_run_at:null}]);
   expect(result.perTemplateLog[0].error).toContain("audience_failed");
   update.mockClear();await run(resolveWebinarBroadcastCounts,client,[bad],true);expect(update).not.toHaveBeenCalled();
  });
 }
});
