#!/usr/bin/env node
// Managed-only: explicit active lesson selection, sequential bounded HLS windows.
import {readFile,writeFile} from 'node:fs/promises';
import {createManagedTransport} from './lib/course-provider-import.mjs';
import {createPublicCaptionTransport} from './lib/reviewed-captions.mjs';
import {createGapMedia} from './lib/gap-media.mjs';
import {createSttGateway,sha} from './lib/course-stt.mjs';
import {prepareLongStt,executeLongBatch} from './lib/long-course-stt.mjs';
let reportPath,progress;
try {
 const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 if(!args.includes('--managed-lovable')||process.env.COURSE_KB_MANAGED_PROJECT_ID!=='796a93b9-74cc-403c-8ec5-cafdb2a5beaa'
  ||process.env.SUPABASE_URL!=='https://hdjgkjceownmmnrqqtuz.supabase.co')throw Error('canonical_managed_environment_required');
 const mode=get('--mode'),output=get('--report');
 if(!['dry-run','execute'].includes(mode)||!output)throw Error('mode_and_report_required');
 await writeFile(output,'',{flag:'wx',mode:0o600});reportPath=output;
 const io=createManagedTransport({supabaseUrl:process.env.SUPABASE_URL,serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
 const publicIo=createPublicCaptionTransport(),media=createGapMedia(),actor=process.env.COURSE_KB_OWNER_ID;
 let report;
 if(mode==='dry-run')report=await prepareLongStt(io,publicIo,actor,get('--alias'),get('--block-ids')?.split(','),media);
 else {
  const path=get('--manifest'),hash=get('--approved-manifest-sha256'),selection=get('--parts');
  if(!path||!hash||!/^\d+(,\d+)*$/.test(selection??''))throw Error('approved_manifest_and_parts_required');
  const raw=await readFile(path);if(sha(raw)!==hash)throw Error('manifest_hash_mismatch');
  report=await executeLongBatch(io,publicIo,actor,JSON.parse(raw.toString('utf8')),selection.split(',').map(Number),media,
   createSttGateway(process.env.LOVABLE_API_KEY),async next=>{progress=next;await writeFile(output,JSON.stringify(next,null,2)+'\n',{mode:0o600});});
 }
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({ok:true,mode,status:report.status,stt_calls:report.stt_calls,parts:report.parts?.length,ready_parts:report.ready_parts})+'\n');
} catch(error) {
 const code=/^[a-z_]+$/.test(error?.message??'')?error.message:'long_course_stt_stopped';
 if(reportPath)await writeFile(reportPath,JSON.stringify({...progress,status:'stopped',code},null,2)+'\n',{mode:0o600}).catch(()=>{});
 process.stderr.write(JSON.stringify({ok:false,code})+'\n');process.exitCode=1;
}
