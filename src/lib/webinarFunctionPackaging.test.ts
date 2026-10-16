import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
describe('isolated managed function packages',()=>{
 const canonical=readFileSync('supabase/functions/broadcast-audience-preview/webinarRegistration.ts','utf8');
 for(const name of ['email-mass-broadcast','telegram-mass-broadcast','process-scheduled-broadcasts']){
  it(`${name} includes the canonical helper within its own deployment boundary`,()=>{
   const path=`supabase/functions/${name}`;
   expect(readFileSync(`${path}/webinarRegistration.ts`,'utf8')).toBe(canonical);
   expect(readFileSync(`${path}/index.ts`,'utf8')).toContain('"./webinarRegistration.ts"');
   expect(readFileSync(`${path}/index.ts`,'utf8')).not.toContain('../broadcast-audience-preview/');
  });
 }
});
