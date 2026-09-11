export async function retireMergedLogin(client:any,mode:'dry-run'|'execute'){
 const prep=await client.rpc('admin_retire_merged_login_g10',{_phase:mode==='execute'?'prepare':'preflight'});
 if(prep.error)return{ok:false,stage:'preflight'};
 if(prep.data.state==='complete')return{ok:true,state:'complete',changed:0};
 if(mode==='dry-run')return{ok:true,state:'ready',ban_needed:prep.data.ban_needed};
 try{
  if(prep.data.ban_needed){
   // Standard Supabase Admin API retirement. No email/password/delete operation.
   const update=await client.auth.admin.updateUserById(prep.data.user_id,{ban_duration:'876000h'});
   if(update.error)throw new Error('retire');
  }
  const read=await client.auth.admin.getUserById(prep.data.user_id);
  if(read.error||!(Date.parse(read.data?.user?.banned_until)>Date.now()))throw new Error('readback');
  const finish=await client.rpc('admin_retire_merged_login_g10',{_phase:'finish'});
  if(finish.error||finish.data?.state!=='complete')throw new Error('finish');
  return{ok:true,state:'complete',changed:finish.data.changed};
 }catch{
  const status=await client.rpc('admin_retire_merged_login_g10',{_phase:'status'});
  if(!status.error&&status.data?.state==='complete')return{ok:true,state:'complete',changed:0};
  // Never reactivate a retired merged login merely because audit completion failed.
  // Journal and desired disabled state remain resumable after inspection.
  return{ok:false,stage:'retirement_needs_readback',manual_review:true};
 }
}
