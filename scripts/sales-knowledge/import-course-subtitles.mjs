#!/usr/bin/env node
// Run ONLY inside the canonical Lovable-managed environment after review.
// No AI/STT calls; dry-run is read-only, execute imports existing VTT/SRT.
import { readFile,writeFile } from 'node:fs/promises';
import { createManagedTransport,dryRunCourse,importCourseBatch,manifestSha256 } from './lib/course-provider-import.mjs';

let reportPath,latestReport;
try{
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(!args.includes('--managed-lovable')||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa')throw new Error('canonical_managed_environment_required');
  if(process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')throw new Error('canonical_database_required');
  const mode=get('--mode'),output=get('--report');if(!output)throw new Error('report_path_required');
  // Reserve a new owner-private report before any mutations. Never overwrite
  // an earlier report or expose source text/URLs in stdout.
  await writeFile(output,'',{flag:'wx',mode:0o600});
  reportPath=output;
  const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
  const actor=process.env.COURSE_KB_OWNER_ID;
  let report;
  if(mode==='dry-run'){
    report=await dryRunCourse(io,actor,{aliases:get('--aliases')?.split(','),onProgress:async progress=>{
      latestReport=progress;await writeFile(output,JSON.stringify(progress,null,2)+'\n',{mode:0o600});
    }});
  }else if(mode==='execute'){
    const path=get('--manifest'),approved=get('--approved-manifest-sha256');
    if(!path||!approved)throw new Error('approved_manifest_required');
    const raw=await readFile(path,'utf8');if(manifestSha256(raw)!==approved)throw new Error('manifest_hash_mismatch');
    const indices=(get('--indices')||'').split(',').map(x=>/^\d+$/.test(x)?Number(x):NaN);
    if(indices.some(x=>!Number.isSafeInteger(x)))throw new Error('batch_indices_invalid');
    report=await importCourseBatch(io,actor,JSON.parse(raw),indices,{onProgress:async progress=>{
      latestReport=progress;await writeFile(output,JSON.stringify(progress,null,2)+'\n',{mode:0o600});
    }});
  }else throw new Error('mode_required');
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify({ok:true,mode,stt_calls:0,count:report.results?.length??report.sources?.length})+'\n');
}catch(error){
  const message=error instanceof Error?error.message:'';
  const code=/^[a-z_]+(?:_http_\d{3})?$/.test(message)?message:'course_import_failed';
  if(reportPath)await writeFile(reportPath,JSON.stringify({...latestReport,status:'stopped',code},null,2)+'\n',{mode:0o600}).catch(()=>{});
  process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
