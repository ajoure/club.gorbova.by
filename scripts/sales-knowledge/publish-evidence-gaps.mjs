#!/usr/bin/env node
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createManagedTransport} from './lib/course-provider-import.mjs';
import {createPublicCaptionTransport} from './lib/reviewed-captions.mjs';
import {prepareEvidenceGapPublication,publishEvidenceGap} from './lib/evidence-gap-publication.mjs';
import {sha} from './lib/course-stt.mjs';

let reportPath;
try{
  const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(!args.includes('--managed-lovable')
    ||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa'
    ||process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')
    throw Error('canonical_managed_environment_required');
  const mode=get('--mode'),output=get('--report'),originalPath=get('--original-manifest'),reviewPath=get('--review-file');
  if(!['dry-run','execute'].includes(mode)||!output||!originalPath||!reviewPath)throw Error('review_arguments_required');
  await writeFile(output,'',{flag:'wx',mode:0o600});reportPath=output;
  const readPrivate=async path=>{
    const info=await stat(path);if(!info.isFile()||(info.mode&0o077)!==0||info.size>1000000)throw Error('private_input_required');
    return readFile(path);
  };
  const original=JSON.parse((await readPrivate(originalPath)).toString('utf8'));
  const reviewBytes=await readPrivate(reviewPath),review=JSON.parse(reviewBytes.toString('utf8'));
  const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
  const prepared=await prepareEvidenceGapPublication(io,createPublicCaptionTransport(),
    process.env.COURSE_KB_OWNER_ID,original,review,sha(reviewBytes));
  let report;
  if(mode==='dry-run')report=prepared.manifest;
  else{
    const path=get('--manifest'),approvedHash=get('--approved-manifest-sha256');
    if(!path||!approvedHash)throw Error('approved_manifest_required');
    const bytes=await readPrivate(path);
    if(sha(bytes)!==approvedHash)throw Error('review_manifest_hash_mismatch');
    const approved=JSON.parse(bytes.toString('utf8'));
    report=await publishEvidenceGap(io,process.env.COURSE_KB_OWNER_ID,approved,prepared,review,approvedHash);
  }
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
  process.stdout.write(JSON.stringify({ok:true,mode,stt_calls:0,paid_private:true})+'\n');
}catch(error){
  const code=/^[a-z_]+$/.test(error?.message||'')?error.message:'review_publication_stopped';
  if(reportPath)await writeFile(reportPath,JSON.stringify({status:'stopped',code},null,2)+'\n',{mode:0o600}).catch(()=>{});
  process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
