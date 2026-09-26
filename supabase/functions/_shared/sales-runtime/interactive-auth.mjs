// Interactive diagnostics never authorize operational worker actions.
export async function authorizeInteractiveAction({action,actor,isSuperAdmin,loadOwnerScope}) {
  if(!['preview_scenario','health'].includes(action))return {allowed:false,status:401,error:'unauthorized'};
  if(!actor||!await isSuperAdmin(actor.id))return {allowed:false,status:403,error:'forbidden'};
  if(action==='health'){
    const scope=await loadOwnerScope();
    if(!scope?.campaign||scope.campaign.test_user_id!==actor.id)return {allowed:false,status:403,error:'forbidden'};
    if(scope.campaign.mode!=='off'||scope.conversation?.human_hold!==true)return {allowed:false,status:409,error:'pause_and_disable_required'};
  }
  return {allowed:true};
}
