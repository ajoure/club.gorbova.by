import {readFileSync} from 'node:fs';
const hashPattern=/^[a-f0-9]{64}$/;
const modes="_mode IS NULL OR _mode NOT IN ('dry-run','rollback','execute')";
/** Wrap the reviewed operation bodies; no payload, identity, or SQL is accepted from end users. */
export function renderManagedHistoryMigration(historyHashes,scopeHash){
 if(!Array.isArray(historyHashes)||historyHashes.length<1||historyHashes.length>15||historyHashes.some(h=>!hashPattern.test(h))||!hashPattern.test(scopeHash))throw Error('Expected approved payload hashes');
 const history=readFileSync(new URL('./batch.sql',import.meta.url),'utf8');
 const scope=readFileSync(new URL('./repair-course-scope.sql',import.meta.url),'utf8');
 const wrap=(sql,tag,name,hashes,result)=>{
  const start=sql.indexOf(`DO $${tag}$\nDECLARE\n`),end=sql.indexOf(`\nEND;\n$${tag}$;`);
  if(start<0||end<0)throw Error('Reviewed operation structure changed');
  let body=sql.slice(start+`DO $${tag}$\nDECLARE\n`.length,end);
  const split=body.indexOf('\nBEGIN\n');let declarations=body.slice(0,split),statements=body.slice(split+7);
  declarations=declarations.replace(/do_execute boolean\s*:=\s*\/\* EXECUTE_FLAG \*\/ false;/,"do_execute boolean := _mode <> 'dry-run';")
   .replace(/payload jsonb\s*:=\s*\/\* PAYLOAD \*\/ '\[\]'::jsonb;/,'payload jsonb := _payload;');
  if(declarations.includes('/*'))throw Error('Operation inputs changed');
  if(tag==='history'){
   statements=statements.replace('IF NOT do_execute THEN RETURN; END IF;',"IF NOT do_execute THEN RETURN jsonb_build_object('total',jsonb_array_length(payload),'missing',new_count,'already_covered',covered,'inserted',0); END IF;")
    .replace('IF new_count=0 THEN RETURN; END IF;',"IF new_count=0 THEN RETURN jsonb_build_object('total',jsonb_array_length(payload),'missing',0,'already_covered',covered,'inserted',0,'replay',true); END IF;");
  }
  if(/\bRETURN;/.test(statements))throw Error('Unconverted void return');
  return `CREATE OR REPLACE FUNCTION public.${name}(_payload jsonb, _mode text DEFAULT 'dry-run')\nRETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET lock_timeout='5s' AS $managed$\nDECLARE\n${declarations}\n operation_result jsonb; rollback_message text;\nBEGIN\n IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE='42501'; END IF;\n IF ${modes} OR _payload IS NULL THEN RAISE EXCEPTION 'Explicit supported operation mode and payload required'; END IF;\n IF encode(sha256(convert_to(_payload::text,'UTF8')),'hex') <> ALL(ARRAY[${hashes.map(h=>`'${h}'`).join(',')}]::text[])\n THEN RAISE EXCEPTION 'Payload is not one of the owner-approved fixed batches'; END IF;\n BEGIN\n${statements}\n operation_result := ${result};\n IF _mode='rollback' THEN RAISE EXCEPTION USING ERRCODE='ZHB01',MESSAGE=operation_result::text; END IF;\n RETURN operation_result;\n EXCEPTION WHEN SQLSTATE 'ZHB01' THEN\n  GET STACKED DIAGNOSTICS rollback_message=MESSAGE_TEXT;\n  RETURN rollback_message::jsonb || jsonb_build_object('rolled_back',true);\n END;\nEND;\n$managed$;\nREVOKE ALL ON FUNCTION public.${name}(jsonb,text) FROM PUBLIC,anon,authenticated;\nGRANT EXECUTE ON FUNCTION public.${name}(jsonb,text) TO service_role;\n`;
 };
 return '-- Fixed owner-approved historical batches only. No sandbox grants, arbitrary SQL or Auth mutations.\n'
  +wrap(history,'history','admin_import_historical_cb_17_18',historyHashes,"jsonb_build_object('total',jsonb_array_length(payload),'missing',new_count,'already_covered',covered,'inserted',new_count)")
  +'\n'+wrap(scope,'scope','admin_repair_historical_cb_scope',[scopeHash],"jsonb_build_object('total',jsonb_array_length(payload),'changed',changed,'executed',do_execute)");
}
