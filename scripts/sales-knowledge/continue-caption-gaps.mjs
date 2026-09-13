#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createManagedTransport} from './lib/course-provider-import.mjs';
import {createPublicCaptionTransport} from './lib/reviewed-captions.mjs';
import {createGapMedia} from './lib/gap-media.mjs';
import {prepareGapContinuation,executeGapContinuation} from './lib/gap-continuation.mjs';
import {createSttGateway,sha} from './lib/course-stt.mjs';
let reportPath,progress;
try{
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(!args.includes('--managed-lovable')||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa'
    ||process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')throw Error('canonical_managed_environment_required');
  const mode=get('--mode'),output=get('--report');if(!['dry-run','execute'].includes(mode)||!output)throw Error('mode_and_report_required');
  await writeFile(output,'',{flag:'wx',mode:0o600});reportPath=output;
  const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
  const pub=createPublicCaptionTransport(),media=createGapMedia(),actor=process.env.COURSE_KB_OWNER_ID;let report;
  if(mode==='dry-run'){
    const path=get('--original-manifest');if(!path)throw Error('original_manifest_required');const raw=await readFile(path);
    report=(await prepareGapContinuation(io,pub,actor,JSON.parse(raw.toString('utf8')),sha(raw),get('--audit-id'),get('--held-text-sha256'),media)).manifest;
  }else{
    const path=get('--manifest'),approvedHash=get('--approved-manifest-sha256');if(!path||!approvedHash)throw Error('approved_manifest_required');
    const raw=await readFile(path);if(sha(raw)!==approvedHash)throw Error('manifest_hash_mismatch');const m=JSON.parse(raw.toString('utf8'));
    const captured=await prepareGapContinuation(io,pub,actor,m.original_manifest,m.original_file_sha256,m.audit_id,m.held_text_sha256,media);
    report=await executeGapContinuation(io,pub,actor,m,captured,createSttGateway(process.env.LOVABLE_API_KEY),async next=>{
      progress=next;await writeFile(output,JSON.stringify(next,null,2)+'\n',{mode:0o600});
    });
  }
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify({ok:true,mode,stt_calls:report.stt_calls,cached:report.cached,not_quality_approval:true})+'\n');
}catch(error){
  const code=/^[a-z_]+$/.test(error?.message||'')?error.message:'gap_continuation_stopped';
  if(reportPath)await writeFile(reportPath,JSON.stringify({...progress,status:'stopped',code},null,2)+'\n',{mode:0o600}).catch(()=>{});
  process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
