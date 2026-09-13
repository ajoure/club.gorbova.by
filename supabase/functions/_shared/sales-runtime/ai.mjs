// Provider settings are owner-editable on the existing sales campaign.
export const AI_MODELS = ['google/gemini-3.1-pro-preview','google/gemini-3.8-flash','google/gemini-2.5-flash'];
export const AI_DEFAULTS = {model:AI_MODELS[0],max_tokens:8000,timeout_seconds:60,max_context_chars:750000,vision_enabled:true,max_image_bytes:8388608};
export function readAIConfig(value) {
  const c={...AI_DEFAULTS,...(value??{})};
  if (Object.keys(c).some(k=>!Object.hasOwn(AI_DEFAULTS,k)) || !AI_MODELS.includes(c.model)
    || !Number.isInteger(c.max_tokens)||c.max_tokens<2000||c.max_tokens>16000
    || !Number.isInteger(c.timeout_seconds)||c.timeout_seconds<15||c.timeout_seconds>90
    || !Number.isInteger(c.max_context_chars)||c.max_context_chars<50000||c.max_context_chars>1500000
    || typeof c.vision_enabled!=='boolean'||!Number.isInteger(c.max_image_bytes)||c.max_image_bytes<1024||c.max_image_bytes>8388608) throw Error('invalid_ai_config');
  return c;
}

/** No silent truncation or weaker-model fallback. An incomplete provider response
 * can never advance a sales stage or create a payment link. */
export async function requestAI(config, system, content, {key='',fetcher=fetch}={}) {
  const c=readAIConfig(config);
  if (!key) throw Error('provider_not_configured');
  if(typeof content==='string' && system.length+content.length>c.max_context_chars) throw Error('history_model_capacity_exceeded');
  let response;
  try {
    response=await fetcher('https://ai.gateway.lovable.dev/v1/chat/completions',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      signal:AbortSignal.timeout(c.timeout_seconds*1000),
      body:JSON.stringify({model:c.model,temperature:0.2,max_tokens:c.max_tokens,response_format:{type:'json_object'},
        messages:[{role:'system',content:system},{role:'user',content}]}),
    });
  } catch { throw Error('provider_transport_failed'); }
  if(!response.ok) throw Error(response.status===429?'provider_rate_limited':'provider_failed');
  let result;
  try {result=await response.json();} catch {throw Error('provider_invalid_json');}
  if(result.choices?.[0]?.finish_reason!=='stop') throw Error('provider_incomplete_response');
  try {return JSON.parse(result.choices[0].message.content);} catch {throw Error('provider_invalid_json');}
}
