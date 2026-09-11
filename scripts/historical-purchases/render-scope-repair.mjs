import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function renderScopeRepair(items,mode){
 const keys=['entitlement_id','order_id','user_id','profile_id'];
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 if(!['dry-run','execute','rollback'].includes(mode)||!Array.isArray(items)||!items.length||items.length>20)throw new Error('Explicit mode and reviewed items required');
 if(new Set(items.map(i=>i.entitlement_id)).size!==items.length)throw new Error('Duplicate entitlement');
 const safe=items.map(i=>Object.fromEntries(keys.map(k=>{if(!uuid.test(i[k]))throw new Error('Invalid UUID');return[k,i[k]]})));
 let sql=readFileSync(new URL('./repair-course-scope.sql',import.meta.url),'utf8');
 for(const[m,v]of[["/* PAYLOAD */ '[]'::jsonb",`'${JSON.stringify(safe)}'::jsonb`],['/* EXECUTE_FLAG */ false',mode==='dry-run'?'false':'true']]){
  if(sql.split(m).length!==2)throw new Error('SQL marker changed');sql=sql.replace(m,v);
 }
 return mode==='rollback'?sql.replace(/COMMIT;\s*$/,'ROLLBACK;\n'):sql;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const[,,file,mode,out]=process.argv;if(!out)throw new Error('Usage: render-scope-repair.mjs reviewed-items.json dry-run|rollback|execute output.sql');
 const sql=renderScopeRepair(JSON.parse(readFileSync(file,'utf8')),mode);writeFileSync(out,sql,{mode:0o600});console.log(JSON.stringify({mode,sha256:createHash('sha256').update(sql).digest('hex')}));
}
