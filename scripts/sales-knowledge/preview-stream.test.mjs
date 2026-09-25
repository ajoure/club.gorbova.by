import test from 'node:test';
import assert from 'node:assert/strict';
import {streamSyntheticPreview} from '../../supabase/functions/_shared/sales-runtime/preview-stream.mjs';

test('slow synthetic preview emits whitespace before the final valid JSON', async()=>{
 let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 const response=streamSyntheticPreview(()=>pending,5);
 const reader=response.body.getReader();
 const first=await reader.read();
 assert.equal(new TextDecoder().decode(first.value),' \n');
 const second=await reader.read();
 assert.equal(new TextDecoder().decode(second.value),' \n');
 finish({ok:true,mode:'synthetic_preview_no_send',steps:[{pass:true}]});
 let raw=' \n \n';
 for (;;) {
  const part=await reader.read();
  if(part.done) break;
  raw+=new TextDecoder().decode(part.value);
 }
 assert.deepEqual(JSON.parse(raw),{ok:true,mode:'synthetic_preview_no_send',steps:[{pass:true}]});
 assert.equal(response.headers.get('cache-control'),'no-store');
});

test('provider errors cannot put their text into the synthetic response',async()=>{
 const response=streamSyntheticPreview(()=>{throw Error('secret provider body');});
 const raw=await response.text();
 assert.deepEqual(JSON.parse(raw),{ok:false,error:'runtime_failed',stage:'model'});
 assert.doesNotMatch(raw,/secret provider body/);
});
