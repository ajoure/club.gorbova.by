#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {createManagedTransport} from './lib/course-provider-import.mjs';
import {createPublicCaptionTransport} from './lib/reviewed-captions.mjs';
import {createGapMedia} from './lib/gap-media.mjs';
import {sha} from './lib/course-stt.mjs';
import {prepareSilencePublication,publishSilence} from './lib/silence-publication.mjs';
let reportPath;
try{
 const args=process.argv.slice(2),get=n=>{const i=args.indexOf(n);return i<0?undefined:args[i+1];};
 if(!args.includes('--managed-lovable')||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa'
  ||process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')throw Error('canonical_managed_environment_required');
 const mode=get('--mode'),output=get('--report'),path=get('--manifest'),hash=get('--approved-manifest-sha256'),selection=get('--parts');
 if(!['dry-run','execute'].includes(mode)||!output||!path||!hash||!/^\d+(,\d+)*$/.test(selection??''))throw Error('approved_manifest_and_parts_required');
 await writeFile(output,'',{flag:'wx',mode:0o600});reportPath=output;
 const raw=await readFile(path);if(raw.length>2000000||sha(raw)!==hash)throw Error('manifest_hash_mismatch');
 const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY}),actor=process.env.COURSE_KB_OWNER_ID;
 const prepared=await prepareSilencePublication(io,createPublicCaptionTransport(),createGapMedia(),actor,JSON.parse(raw.toString('utf8')),selection.split(',').map(Number));
 let report=prepared.manifest;
 if(mode==='execute'){
  const approval=get('--approved-dry-run'),approvalHash=get('--approved-dry-run-sha256');
  if(!approval||!approvalHash)throw Error('silence_approval_required');
  const data=await readFile(approval);if(data.length>2000000||sha(data)!==approvalHash)throw Error('silence_approval_changed');
  report=await publishSilence(io,actor,JSON.parse(data.toString('utf8')),prepared);
 }
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({ok:true,mode,status:report.status,parts:report.parts??report.proofs?.length,stt_calls:0})+'\n');
}catch(error){
 const code=/^[a-z_]+$/.test(error?.message??'')?error.message:'silence_publication_stopped';
 if(reportPath)await writeFile(reportPath,JSON.stringify({status:'stopped',code,stt_calls:0})+'\n',{mode:0o600}).catch(()=>{});
 process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
