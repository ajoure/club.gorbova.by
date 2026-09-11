#!/usr/bin/env node
// Managed-only, one active course source <=30min. Never run against production locally.
import {readFile,writeFile} from 'node:fs/promises';
import {createManagedTransport} from './lib/course-provider-import.mjs';
import {prepareStt,executeStt,createSttGateway,sha} from './lib/course-stt.mjs';
import {createCourseMedia} from './lib/course-audio.mjs';
let reportPath,progress;
try{
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(!args.includes('--managed-lovable')||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa'
    ||process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')throw Error('canonical_managed_environment_required');
  const mode=get('--mode'),output=get('--report');
  if(!['dry-run','execute'].includes(mode)||!output)throw Error('mode_and_report_required');
  await writeFile(output,'',{flag:'wx',mode:0o600});reportPath=output;
  const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
  const actor=process.env.COURSE_KB_OWNER_ID,media=createCourseMedia();let report;
  if(mode==='dry-run'){
    const alias=get('--alias');if(!/^[a-zA-Z0-9-]+$/.test(alias||''))throw Error('alias_required');
    report=(await prepareStt(io,actor,alias,media)).manifest;
  }else{
    const path=get('--manifest'),approvedHash=get('--approved-manifest-sha256');
    if(!path||!approvedHash)throw Error('approved_manifest_required');
    const raw=await readFile(path);if(sha(raw)!==approvedHash)throw Error('manifest_hash_mismatch');
    const approved=JSON.parse(raw.toString('utf8'));
    const transcribe=createSttGateway(process.env.LOVABLE_API_KEY);
    const captured=await prepareStt(io,actor,approved.source?.alias,media);
    report=await executeStt(io,actor,approved,captured,transcribe,async next=>{
      progress=next;await writeFile(output,JSON.stringify(next,null,2)+'\n',{mode:0o600});
    });
  }
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify({ok:true,mode,stt_calls:report.stt_calls,parts:report.parts?.length,
    chars:report.chars,cached:report.cached})+'\n');
}catch(error){
  const code=/^[a-z_]+$/.test(error?.message||'')?error.message:'course_stt_stopped';
  if(reportPath)await writeFile(reportPath,JSON.stringify({...progress,status:'stopped',code},null,2)+'\n',{mode:0o600}).catch(()=>{});
  process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
