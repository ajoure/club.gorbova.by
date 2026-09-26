import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeInteractiveAction} from '../../supabase/functions/_shared/sales-runtime/interactive-auth.mjs';
const base={action:'health',actor:{id:'owner'},isSuperAdmin:async()=>true,loadOwnerScope:async()=>({campaign:{test_user_id:'owner',mode:'off'},conversation:{human_hold:true}})};
test('owner can read health only while campaign is off and conversation held',async()=>{
 assert.equal((await authorizeInteractiveAction(base)).allowed,true);
 for(const scope of [{campaign:{test_user_id:'other',mode:'off'},conversation:{human_hold:true}},{campaign:{test_user_id:'owner',mode:'owner_test'},conversation:{human_hold:true}},{campaign:{test_user_id:'owner',mode:'off'},conversation:{human_hold:false}},null]){
  assert.equal((await authorizeInteractiveAction({...base,loadOwnerScope:async()=>scope})).allowed,false);
 }
});
test('anonymous and ordinary operators never read owner scope',async()=>{
 for(const patch of [{actor:null},{isSuperAdmin:async()=>false}]){
  const result=await authorizeInteractiveAction({...base,...patch,loadOwnerScope:async()=>{throw Error('must not read scope')}});
  assert.equal(result.allowed,false);assert.equal(result.status,403);
 }
});
test('interactive credentials cannot authorize worker operations',async()=>{
 for(const action of [undefined,'run','claim','send','preview_context','preview_image','preview']){
  const result=await authorizeInteractiveAction({...base,action,isSuperAdmin:async()=>{throw Error('must not check role')}});
  assert.equal(result.allowed,false);assert.equal(result.status,401);
 }
});
test('existing super-admin synthetic preview remains available without reading owner scope',async()=>{
 assert.equal((await authorizeInteractiveAction({...base,action:'preview_scenario',loadOwnerScope:async()=>{throw Error('unexpected scope')}})).allowed,true);
});
