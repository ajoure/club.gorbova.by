#!/usr/bin/env node
// Canonical managed runtime only. Public captions are read without credentials.
import {readFile,writeFile} from 'node:fs/promises';
import {createManagedTransport,manifestSha256} from './lib/course-provider-import.mjs';
import {createPublicCaptionTransport,dryRunReviewedCaptions,importReviewedCaptionBatch} from './lib/reviewed-captions.mjs';

let reportPath,progress;
try{
  const args=process.argv.slice(2),get=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
  if(!args.includes('--managed-lovable')||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa')throw new Error('canonical_managed_environment_required');
  if(process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')throw new Error('canonical_database_required');
  const output=get('--report');if(!output)throw new Error('report_path_required');
  await writeFile(output,'',{flag:'wx',mode:0o600});reportPath=output;
  const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
  const publicIo=createPublicCaptionTransport(),actor=process.env.COURSE_KB_OWNER_ID;
  const onProgress=async value=>{progress=value;await writeFile(output,JSON.stringify(value,null,2)+'\n',{mode:0o600});};
  const mode=get('--mode');let result;
  if(mode==='dry-run'){
    result=await dryRunReviewedCaptions(io,publicIo,actor,{aliases:get('--aliases')?.split(','),
      allowCueOrderReview:args.includes('--review-cue-order'),onProgress});
  }else if(mode==='execute'){
    const path=get('--manifest'),approved=get('--approved-manifest-sha256');
    if(!path||!/^[a-f0-9]{64}$/.test(approved||''))throw new Error('approved_manifest_required');
    const raw=await readFile(path,'utf8');if(manifestSha256(raw)!==approved)throw new Error('manifest_hash_mismatch');
    const indices=(get('--indices')||'').split(',').map(x=>/^\d+$/.test(x)?Number(x):NaN);
    result=await importReviewedCaptionBatch(io,publicIo,actor,JSON.parse(raw),indices,{onProgress});
  }else throw new Error('mode_required');
  await onProgress(result);
  process.stdout.write(JSON.stringify({ok:true,mode,stt_calls:0,count:result.results?.length??result.sources?.length})+'\n');
}catch(error){
  const message=error instanceof Error?error.message:'';
  const code=/^[a-z_]+(?:_http_\d{3})?$/.test(message)?message:'reviewed_caption_import_failed';
  if(reportPath)await writeFile(reportPath,JSON.stringify({...progress,status:'stopped',code},null,2)+'\n',{mode:0o600}).catch(()=>{});
  process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
