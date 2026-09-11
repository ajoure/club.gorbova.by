import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function renderHistoryBatch(actions,mode){
 if(!['dry-run','execute'].includes(mode)||!Array.isArray(actions)||!actions.length||actions.length>20)throw new Error('Explicit mode and 1..20 facts required');
 for(const a of actions){
  for(const k of ['id','profile_id','product_id'])if(!uuid.test(a[k]))throw new Error('Invalid ID');
  for(const k of ['user_id','tariff_id','flow_id'])if(a[k]!==null&&!uuid.test(a[k]))throw new Error('Invalid nullable ID');
  if(!a.refs?.length||a.refs.some(r=>!/^(17|18):\d+$/.test(r)))throw new Error('Invalid source refs');
  if(a.idempotency_key!==`hist-cb17-18-20260911-v1:${a.cohort}:${a.profile_id}:${a.product_id}:${a.tariff_id||'module'}`)throw new Error('Wrong batch');
  if(![17,18].includes(a.cohort)||!['module_only_standalone','base_tariff_purchase'].includes(a.kind)||a.history_only!==true||a.owner_confirmed_paid!==true||a.create_payment!==false||a.grant_access!==false)throw new Error('Unapproved fact');
 }
 if(new Set(actions.map(a=>a.id)).size!==actions.length)throw new Error('Duplicate action');
 const allowed=['id','profile_id','user_id','product_id','tariff_id','flow_id','cohort','kind','refs','idempotency_key','history_only','owner_confirmed_paid','create_payment','grant_access'];
 const safe=actions.map(a=>Object.fromEntries(allowed.map(k=>[k,a[k]])));
 const escaped=JSON.stringify(safe).replaceAll("'","''");
 let sql=readFileSync(new URL('./batch.sql',import.meta.url),'utf8');
 for(const [marker,value] of [["/* PAYLOAD */ '[]'::jsonb",`'${escaped}'::jsonb`],['/* EXECUTE_FLAG */ false',mode==='execute'?'true':'false']]){
  if(sql.split(marker).length!==2)throw new Error('SQL marker changed');sql=sql.replace(marker,value);
 }
 return sql;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[,,file,mode,index,out]=process.argv;if(!out)throw new Error('Usage: render-batch.mjs plan.json dry-run|execute zero-based-batch output.sql');
 const plan=JSON.parse(readFileSync(file,'utf8'));const i=Number(index);if(!Number.isInteger(i)||i<0)throw new Error('Invalid batch index');
 const actions=plan.actions.slice(i*20,(i+1)*20),sql=renderHistoryBatch(actions,mode);
 writeFileSync(out,sql,{mode:0o600});console.log(JSON.stringify({batch:i,mode,facts:actions.length,sha256:createHash('sha256').update(sql).digest('hex')}));
}
