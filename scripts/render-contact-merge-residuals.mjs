import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function renderResidual(operation,mode) {
  if (!['G1','G10'].includes(operation) || !['dry-run','rollback','execute'].includes(mode)) throw new Error('Reviewed operation and explicit mode required');
  let sql=readFileSync(new URL('./contact-merge-residuals.sql',import.meta.url),'utf8');
  for(const [marker,value] of [["/* OPERATION */ 'G1'",`'${operation}'`],['/* EXECUTE_FLAG */ false',mode!=='dry-run'?'true':'false']]) {
    if(sql.split(marker).length!==2)throw new Error('Execution marker changed');
    sql=sql.replace(marker,value);
  }
  return mode==='rollback'?sql.replace(/COMMIT;\s*$/,'ROLLBACK;\n'):sql;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const[,,operation,mode,out]=process.argv;
  if(!out)throw new Error('Usage: node render-contact-merge-residuals.mjs G1|G10 dry-run|rollback|execute output.sql');
  const sql=renderResidual(operation,mode);writeFileSync(out,sql,{mode:0o600});
  console.log(JSON.stringify({operation,mode,sha256:createHash('sha256').update(sql).digest('hex')}));
}
