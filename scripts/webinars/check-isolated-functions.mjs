import {mkdtemp,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const source=new URL('../../supabase/functions/',import.meta.url);
const temp=await mkdtemp(join(tmpdir(),'webinar-function-package-'));
try{
 await cp(new URL('_shared/',source),join(temp,'_shared'),{recursive:true});
 for(const name of ['email-mass-broadcast','telegram-mass-broadcast','process-scheduled-broadcasts']){
  await cp(new URL(`${name}/`,source),join(temp,name),{recursive:true});
  // Sibling function folders are absent, exactly as in managed per-function packaging.
  execFileSync('deno',['check','--no-lock','--no-config','--node-modules-dir=none',join(temp,name,'index.ts')],{stdio:'inherit'});
  await rm(join(temp,name),{recursive:true,force:true});
 }
}finally{await rm(temp,{recursive:true,force:true});}
