import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../../supabase/functions/',import.meta.url);
const source=await readFile(new URL('broadcast-audience-preview/webinarRegistration.ts',root));
for(const name of ['email-mass-broadcast','telegram-mass-broadcast','process-scheduled-broadcasts']){
 const destination=new URL(`${name}/webinarRegistration.ts`,root);
 if(process.argv.includes('--check')){
  if(!source.equals(await readFile(destination)))throw new Error(`Webinar helper package drift: ${name}`);
 }else await writeFile(destination,source);
}
console.log('Webinar helper: all isolated packages match the canonical source');
