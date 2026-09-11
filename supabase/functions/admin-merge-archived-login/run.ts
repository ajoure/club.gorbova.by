// No raw Auth/RPC responses, emails or provider errors leave this operation.
export async function runArchivedLoginMerge(client: any, mode: 'dry-run'|'execute') {
  const prep=await client.rpc('admin_archived_login_merge_g9',{_phase:mode==='execute'?'prepare':'preflight'});
  if(prep.error) return {ok:false,stage:'preflight'};
  if(prep.data.state==='complete')return {ok:true,state:'complete',changed:0};
  if(mode==='dry-run')return {ok:true,state:'ready',auth_update_needed:prep.data.auth_update_needed};
  const {user_id,previous_email,next_email}=prep.data;
  const read=async()=>{
    const result=await client.auth.admin.getUserById(user_id);
    if(result.error||!result.data?.user)throw new Error('auth_read');
    return result.data.user;
  };
  try {
    let current=await read();
    if(current.email_confirmed_at||current.last_sign_in_at)throw new Error('auth_drift');
    if((current.email||'').trim().toLowerCase()!==next_email){
      if((current.email||'').trim().toLowerCase()!==previous_email)throw new Error('auth_drift');
      const update=await client.auth.admin.updateUserById(user_id,{email:next_email});
      if(update.error)throw new Error('auth_update');
    }
    current=await read();
    if((current.email||'').trim().toLowerCase()!==next_email||current.email_confirmed_at)throw new Error('auth_readback');
    const finish=await client.rpc('admin_archived_login_merge_g9',{_phase:'finish'});
    if(finish.error||finish.data?.state!=='complete')throw new Error('profile_finish');
    return {ok:true,state:'complete',changed:finish.data.changed};
  } catch {
    // An uncertain finish may have committed. Never roll back Auth on a completed merge.
    const status=await client.rpc('admin_archived_login_merge_g9',{_phase:'status'});
    if(status.error)return {ok:false,stage:'status_unknown',manual_review:true};
    if(status.data?.state==='complete')return {ok:true,state:'complete',changed:0};
    try {
      const current=await read();
      if(current.email_confirmed_at||current.last_sign_in_at)return {ok:false,stage:'auth_security_drift',manual_review:true};
      if((current.email||'').trim().toLowerCase()===next_email){
        const undo=await client.auth.admin.updateUserById(user_id,{email:previous_email});
        if(undo.error)return {ok:false,stage:'auth_rollback',manual_review:true};
      }else if((current.email||'').trim().toLowerCase()!==previous_email){
        return {ok:false,stage:'auth_drift',manual_review:true};
      }
      const restored=await read();
      if((restored.email||'').trim().toLowerCase()!==previous_email)return {ok:false,stage:'auth_rollback_readback',manual_review:true};
      return {ok:false,stage:'rolled_back',manual_review:true};
    }catch{return {ok:false,stage:'auth_rollback_unknown',manual_review:true};}
  }
}
