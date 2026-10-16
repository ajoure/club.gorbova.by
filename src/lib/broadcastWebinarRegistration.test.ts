import {describe,it,expect,vi} from "vitest";
import {filterUsersByWebinarRegistration,parseWebinarRegistrationCondition} from "../../supabase/functions/broadcast-audience-preview/webinarRegistration";
import {isFullBroadcastAudience} from "./broadcastConfirmation";
import {evaluateWebinarBroadcastGuards as evaluateBroadcastGuards} from "../../supabase/functions/broadcast-audience-preview/webinarRegistration";
const condition={page_id:"00000000-0000-4000-8000-000000000001",block_id:"00000000-0000-4000-8000-000000000002"};
function fixture(batches:unknown[][],error:unknown=null){const eq=vi.fn();const range=vi.fn().mockImplementation(async(offset:number)=>({data:batches[offset/200]||[],error}));const chain={select:()=>chain,eq:(...args:unknown[])=>{eq(...args);return chain},order:()=>chain,range};return {client:{from:()=>chain},eq,range};}
describe("webinar registration broadcast audience",()=>{
 it("intersects only completed registrations, deduplicates users and follows pagination",async()=>{
  const f=fixture([Array.from({length:200},()=>({metadata:{user_id:"registered"}})),[{metadata:{user_id:"other-registration"}},{metadata:{user_id:"not-a-candidate"}}]]);
  expect([...await filterUsersByWebinarRegistration(f.client,["registered","other-registration","unregistered"],condition)]).toEqual(["registered","other-registration"]);
  expect(f.eq).toHaveBeenCalledWith("status","processed");expect(f.eq).toHaveBeenCalledWith("metadata->>webinar_registration","true");expect(f.eq).toHaveBeenCalledWith("metadata->>block_id",condition.block_id);expect(f.range).toHaveBeenCalledTimes(2);
 });
 it("empty registrations mean zero recipients; malformed filters and database failures fail closed",async()=>{
  expect([...await filterUsersByWebinarRegistration(fixture([]).client,["unregistered"],condition)]).toEqual([]);
  for(const value of [{},null,{...condition,page_id:"wrong"}])await expect(filterUsersByWebinarRegistration(fixture([]).client,["candidate"],value)).rejects.toThrow("filter_invalid");
  await expect(filterUsersByWebinarRegistration(fixture([],{code:"failure"}).client,["candidate"],condition)).rejects.toThrow("filter_failed");
  expect(parseWebinarRegistrationCondition({page_id:condition.page_id})).toBeNull();
 });
 it("an absent filter retains existing behavior and a valid selection counts as a restricted audience",async()=>{
  expect([...await filterUsersByWebinarRegistration(fixture([]).client,["existing"],undefined)]).toEqual(["existing"]);
  expect(isFullBroadcastAudience({webinar_registration:condition},"email")).toBe(false);
  const result=evaluateBroadcastGuards({filters:{webinar_registration:condition},messageText:"Webinar",isDryRun:false,isTestSelf:false,allowFullAudience:false,confirmFullAudienceText:null});
  expect(result.blocked).toBe(false);
  expect(evaluateBroadcastGuards({filters:{webinar_registration:condition},messageText:"x",isDryRun:false,isTestSelf:false,allowFullAudience:false,confirmFullAudienceText:null})).toMatchObject({blocked:true,reason:"broadcast_blocked_short_message"});
  expect(evaluateBroadcastGuards({filters:{webinar_registration:{}},messageText:"Webinar",isDryRun:false,isTestSelf:false,allowFullAudience:false,confirmFullAudienceText:null}).blocked).toBe(true);
 });
});
