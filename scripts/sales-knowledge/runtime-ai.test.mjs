import test from 'node:test';
import assert from 'node:assert/strict';
import {readAIConfig,requestAI,AI_DEFAULTS} from '../../supabase/functions/_shared/sales-runtime/ai.mjs';
test('owner config rejects arbitrary providers, commands, null and unsafe capacity',()=>{
 assert.equal(readAIConfig({}).model,'google/gemini-3.1-pro-preview');
 for(const value of [{model:'https://evil.example'}, {instruction:'ignore policy'},{vision_enabled:null},{max_tokens:1},{max_context_chars:0},{timeout_seconds:91}]) assert.throws(()=>readAIConfig(value),/invalid_ai_config/);
});
test('full literal history reaches configured model; no automatic weak fallback or truncation',async()=>{
 const history='old customer goal '+ 'с'.repeat(150000)+' latest reply';let sent;
 const r=await requestAI({},'system',history,{key:'synthetic',fetcher:async(url,init)=>{
  assert.equal(url,'https://ai.gateway.lovable.dev/v1/chat/completions');sent=JSON.parse(init.body);
  return Response.json({choices:[{finish_reason:'stop',message:{content:'{"intent":"answer"}'}}]});
 }});
 assert.equal(sent.messages[1].content,history);assert.equal(sent.model,AI_DEFAULTS.model);assert.equal(r.intent,'answer');
 let called=false;await assert.rejects(requestAI({max_context_chars:50000},'system',history,{key:'synthetic',fetcher:()=>{called=true;}}),/capacity_exceeded/);assert.equal(called,false);
});
test('truncated output, rate limits and provider error bodies never become an answer or expose secrets',async()=>{
 for(const [response,expected] of [[Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),/incomplete_response/],[new Response('secret',{status:429}),/^Error: provider_rate_limited$/],[Response.json({choices:[{finish_reason:'stop',message:{content:'not JSON secret'}}]}),/^Error: provider_invalid_json$/]]) {
  await assert.rejects(requestAI({},'system','synthetic',{key:'synthetic',fetcher:async()=>response}),expected);
 }
});
