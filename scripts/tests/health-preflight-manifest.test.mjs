import test from 'node:test';
import assert from 'node:assert/strict';
import { hasEarlyPreflight } from '../health-preflight-manifest.mjs';

test('only an unconditional early OPTIONS Response before business code is a preflight contract', () => {
  const prefix = `Deno.serve(async(req)=>{`;
  const guard = `if(req.method==='OPTIONS') return new Response(null,{headers:corsHeaders});`;
  assert.equal(hasEarlyPreflight(`${prefix}${guard}await charge();});`), true);
  assert.equal(hasEarlyPreflight(`const handler=async(req)=>{${guard}await send();};serve(handler);`), true);
  assert.equal(hasEarlyPreflight(`${prefix}const headers={};console.log('START');${guard}await send();});`), true);
  for (const source of [
    `${prefix}/* req.method === 'OPTIONS' */ await charge();});`,
    `${prefix}const text="req.method === 'OPTIONS'";await charge();});`,
    `${prefix}await charge();${guard}});`,
    `${prefix}const result=charge();${guard}});`,
    `${prefix}const result=++counter;${guard}});`,
    `${prefix}if(false){${guard}}await charge();});`,
    `${prefix}if(req.method==='OPTIONS') return new Response(charge());});`,
    `${prefix}if(req.method==='OPTIONS') {charge();return new Response(null);} });`,
    `${prefix}if(req.method==='OPTIONS') return runBusiness();});`,
    `Deno.serve(createUnknownHandler());`,
    `function dead(){${prefix}${guard}});}Deno.serve(async(req)=>{await charge();});`,
    `let handler=async(req)=>{${guard}};handler=async(req)=>{await charge();};serve(handler);`,
    `${prefix}${guard}});Deno.serve(async(req)=>{await charge();});`,
  ]) assert.equal(hasEarlyPreflight(source), false);
});
