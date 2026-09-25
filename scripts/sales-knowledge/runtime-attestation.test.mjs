import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const functions=join(root,'supabase/functions');
const folders=['_shared','sales-runtime-worker','sales-runtime-control','telegram-webhook','telegram-media-worker'];

async function files(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await files(path));
    else if(entry.isFile()&&path!==join(functions,'_shared/cb21-release.ts'))out.push(path);
  }
  return out;
}

test('the deployed CB21 release marker fingerprints all four functions and shared code',async()=>{
  const marker=await readFile(join(functions,'_shared/cb21-release.ts'),'utf8');
  const expected=marker.match(/CB21_RELEASE_DIGEST\s*=\s*"([a-f0-9]{64})"/)?.[1];
  assert.ok(expected,'release digest must be a SHA-256 hex value');
  const all=(await Promise.all(folders.map(folder=>files(join(functions,folder))))).flat()
    .sort((a,b)=>a.localeCompare(b,'en'));
  const hash=createHash('sha256');
  for(const file of all){
    hash.update(relative(functions,file).replaceAll('\\','/')).update('\0');
    hash.update(await readFile(file)).update('\0');
  }
  assert.equal(expected,hash.digest('hex'),'update release digest after any function/shared edit');
});

test('private worker probes stay behind existing credentials and before side effects',async()=>{
  const webhook=await readFile(join(functions,'telegram-webhook/index.ts'),'utf8');
  const media=await readFile(join(functions,'telegram-media-worker/index.ts'),'utf8');
  const control=await readFile(join(functions,'sales-runtime-control/index.ts'),'utf8');
  assert.ok(webhook.indexOf("suppliedWebhookSecret !== webhookSecret") <
    webhook.indexOf("searchParams.get('health') === 'cb21'"));
  assert.ok(webhook.indexOf("searchParams.get('health') === 'cb21'") <
    webhook.indexOf("const realSupabase = createClient"));
  assert.ok(media.indexOf("token !== WORKER_TOKEN") <
    media.indexOf('searchParams.get("health") === "cb21"'));
  assert.ok(media.indexOf('searchParams.get("health") === "cb21"') <
    media.indexOf('unlock_stuck_media_jobs'));
  assert.ok(control.indexOf('"has_role_v2"') <
    control.indexOf('release_digest: CB21_RELEASE_DIGEST'));
});
